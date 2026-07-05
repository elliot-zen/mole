# GitHub 项目评审工作流技术规格

## 上下文

本项目要构建一个名为 mole 的 GitHub App 服务。服务接收 GitHub webhook，根据 Issue label 判断 Pull Request 当前处于 Spec Review 还是 Code Review 阶段，调用 LLM reviewer 生成评审结论，并通过 GitHub Review、Comment、Label 和 Request Reviewers API 将结果写回 GitHub。

当前仓库尚未包含 Go module 或服务代码，现有相关文件只有产品规格：

- specs/project-review-workflow/PRODUCT.md:1 — 定义首版用户可见行为、标签流转、`Linked Issue #123` 关联规则、同一 PR 的规格与实现阶段、`/mole-review` 权限和关闭态处理。

因此本规格将定义首版工程结构、主要类型、数据流、数据库边界和验证方式。实现时应保持 GitHub 为用户可见状态源，同时使用 PostgreSQL 保存 webhook 去重、评审任务和已评审 head SHA，保证后台任务可恢复。

## 建议的更改

### 工程结构

初始化 Go module，并使用 Go + Gin 构建 HTTP 服务。建议新增以下主要文件和目录：

- `cmd/mole/main.go`：进程入口，加载配置，初始化数据库、GitHub App client、reviewer、job dispatcher、worker 和 Gin router。
- `internal/httpserver`：Gin router、webhook handler、健康检查、错误响应。
- `internal/github`：GitHub webhook 验签、事件解析、GitHub App installation token、GitHub API 适配层。
- `internal/workflow`：核心业务用例，包括阶段判断、PR 与 Issue 关联、任务入队、Spec Review 和 Code Review 编排。
- `internal/reviewer`：LLM review 抽象与 OpenAI 实现。
- `internal/store`：GORM models、repository、事务和任务领取逻辑。
- `internal/config`：环境变量配置和仓库级 `.mole.yml` 解析。
- `db/migrations`：PostgreSQL schema migration。
- `.mole.yml.example`：仓库级配置示例。

HTTP 层只负责接收事件、验签、解析和入队，不直接执行耗时评审。业务判断集中在 `internal/workflow`，GitHub API 细节封装在 `internal/github`，数据库访问集中在 `internal/store`。

### 配置

服务级配置来自环境变量：

- `MOLE_WEBHOOK_SECRET`
- `MOLE_GITHUB_APP_ID`
- `MOLE_GITHUB_PRIVATE_KEY`
- `MOLE_DATABASE_URL`
- `MOLE_OPENAI_API_KEY`
- `MOLE_OPENAI_MODEL`
- `MOLE_WORKER_CONCURRENCY`
- `MOLE_JOB_MAX_ATTEMPTS`

仓库级配置来自 PR head 或 base 仓库根目录的 `.mole.yml`。首版配置仓库流程相关内容：

```yaml
labels:
  need_to_spec: need-to-spec
  ready_to_implement: ready-to-implement
  ready_for_maintainer_review: ready-for-maintainer-review
maintainer_reviewers:
  - alice
maintainer_teams:
  - core-maintainers
```

若 `.mole.yml` 缺失，使用产品规格中的默认 label；若维护者 reviewer/team 未配置，Code Review 通过后只添加 `ready-for-maintainer-review` label 并评论提示维护者接手。

### GitHub Webhook

Gin 暴露 `POST /webhooks/github`。handler 必须：

1. 使用 `X-Hub-Signature-256` 和 `MOLE_WEBHOOK_SECRET` 验证 payload。
2. 读取 `X-GitHub-Event`、`X-GitHub-Delivery`。
3. 解析并筛选首版支持的事件。
4. 将可处理事件转换为内部 `ReviewTrigger` 并写入 `review_jobs`。
5. 快速返回 `2xx`，不等待 LLM review 完成。

首版订阅并处理以下 GitHub events：

- `pull_request`：处理 `opened`、`synchronize`、`edited`、`reopened`，并在 `closed` 时停止后续处理。
- `issue_comment`：仅处理 PR 评论中的 `/mole-review`。
- `issues`：处理 label 变化，用于维护 Issue 阶段认知和后续事件判断。

`pull_request_review` 不在首版范围内。

### 数据库模型

使用 PostgreSQL + GORM。建议核心表：

`github_deliveries`

- `delivery_id`：GitHub delivery id，唯一。
- `event_type`
- `repository_id`
- `received_at`
- `processed_at`
- `status`

用于 webhook delivery 去重。重复 delivery 直接返回成功，不重复入队。

`pull_request_states`

- `repository_id`
- `repository_full_name`
- `pull_request_number`
- `issue_number`
- `head_sha`
- `phase`：`spec_review`、`code_review`、`unsupported`。
- `last_spec_reviewed_sha`
- `last_code_reviewed_sha`
- `last_result`：`approved`、`changes_requested`、`failed`。
- `updated_at`

用于记录 mole 已处理到哪个 head SHA，避免同一 PR、同一阶段、同一 SHA 被重复评审。

`review_jobs`

- `id`
- `repository_id`
- `repository_full_name`
- `installation_id`
- `pull_request_number`
- `issue_number`
- `head_sha`
- `phase`
- `trigger`：`pull_request`、`issue_comment`、`issues`。
- `delivery_id`
- `status`：`queued`、`leased`、`succeeded`、`retryable`、`failed`、`canceled`。
- `attempts`
- `lease_until`
- `last_error`
- `created_at`
- `updated_at`

`review_jobs` 使用唯一约束防止重复任务，例如 `(repository_id, pull_request_number, head_sha, phase)`。`/mole-review` 若针对同一 SHA 和阶段已有已完成评审，可以重新入队，但应记录新的 trigger；实现时可通过额外 `force` 标记或允许手动触发创建新 job。推荐首版允许 `/mole-review` 对同一 SHA 重新排队，自动事件保持唯一去重。

### 后台任务

worker 从 `review_jobs` 表轮询 `queued` 或 lease 过期的 `retryable` 任务，用事务领取任务并设置 `leased`、`lease_until` 和 `attempts`。执行完成后：

- 成功写回 GitHub 后标记 `succeeded`。
- 可重试错误标记 `retryable`，保留 `last_error`。
- 非重试错误或超过最大次数标记 `failed`，并尽量在 PR 上评论可操作错误。

评审任务执行流程：

1. 读取最新 PR、Issue、label、head SHA 和仓库 `.mole.yml`。
2. 若 Issue 或 PR 已关闭，取消任务或评论“不再处理已关闭的 Issue/PR”。
3. 解析 PR 描述中的 `Linked Issue #<number>`，确保唯一关联。
4. 根据 Issue label 判断阶段：`need-to-spec` 为 Spec Review，`ready-to-implement` 为 Code Review。
5. 校验任务 phase 与当前 label 一致；不一致时取消旧任务或重新入队正确阶段任务。
6. 构建 reviewer 输入。
7. 调用 `Reviewer`。
8. 根据 reviewer 结论调用 GitHub API 写回 review、comment、label 和 maintainer review request。
9. 更新 `pull_request_states` 和 `review_jobs`。

### GitHub API 适配层

使用 `github.com/google/go-github/v66/github`。GitHub App 认证流程为：

1. 使用 `MOLE_GITHUB_APP_ID` 和 `MOLE_GITHUB_PRIVATE_KEY` 生成 App JWT。
2. 根据 webhook payload 中的 `installation_id` 获取 installation token。
3. 用 installation token 创建仓库级 GitHub client。

`internal/github` 对业务层暴露接口，而不是让业务层直接依赖 `go-github`：

- `GetPullRequest`
- `GetIssue`
- `ListPullRequestFiles`
- `GetFileContent`
- `CreatePullRequestReview`
- `CreateIssueComment`
- `AddIssueLabels`
- `RemoveIssueLabel`
- `AddPullRequestLabels`
- `RequestReviewers`
- `GetCollaboratorPermission`

权限判断中，`/mole-review` 只允许 PR 作者和 Maintainer。PR 作者从 PR payload 或 API 获取；Maintainer 通过 GitHub collaborator permission 判断，至少需要 `admin`、`maintain` 或 `write` 权限。

### Reviewer 抽象

定义统一 reviewer 接口：

```go
type ReviewPhase string

const (
    ReviewPhaseSpec ReviewPhase = "spec_review"
    ReviewPhaseCode ReviewPhase = "code_review"
)

type ReviewDecision string

const (
    ReviewDecisionApprove        ReviewDecision = "approve"
    ReviewDecisionRequestChanges ReviewDecision = "request_changes"
)

type ReviewRequest struct {
    Phase      ReviewPhase
    Repository string
    Issue      IssueContext
    PullRequest PullRequestContext
    ProductMD  string
    TechMD     string
    Diff       string
    Config     RepoConfig
}

type ReviewResult struct {
    Decision ReviewDecision
    Body     string
}
```

首版实现 `OpenAIReviewer`。workflow 只关心 `ReviewResult.Decision` 和 Markdown `Body`，不关心具体模型调用方式。

Spec Review 输入包含 Issue 标题/正文、PR 标题/正文、`specs/GH-<issue>/PRODUCT.md`、`specs/GH-<issue>/TECH.md` 和相关 diff。Code Review 输入包含 Issue 标题/正文、PR 标题/正文、changed files diff、上述规格文档和 `.mole.yml` 相关配置。

若 diff 或文件内容超过模型上下文限制，按文件截断并在 reviewer prompt 中明确“上下文被截断”。Review 结果也应提示维护者上下文不足，需要人工检查。

### Workflow 规则

PR 与 Issue 关联只接受 PR 描述中的 `Linked Issue #<number>`。解析结果必须唯一。

规格路径由关联 Issue 决定：

- `specs/GH-<issue-number>/PRODUCT.md`
- `specs/GH-<issue-number>/TECH.md`

Spec Review 通过后：

1. 在 PR 上提交 `Approve` review。
2. 在 Issue 上添加 `ready-to-implement` label。
3. 从 Issue 移除 `need-to-spec` label。
4. 不自动合并 PR。

Spec Review 不通过时：

1. 在 PR 上提交 `Request changes` review。
2. 不修改 Issue label。
3. 不添加失败 label。

Code Review 通过后：

1. 在 PR 上提交 `Approve` review。
2. 在 PR 上添加 `ready-for-maintainer-review` label。
3. 按 `.mole.yml` 请求维护者或团队评审。
4. 若未配置维护者评审目标，评论提示维护者接手。
5. Issue 保持 `ready-to-implement` label。

Code Review 不通过时：

1. 在 PR 上提交 `Request changes` review。
2. 不添加失败 label。
3. 不请求维护者评审。

### `/mole-review`

`issue_comment` handler 仅在评论正文去除首尾空白后等于 `/mole-review` 时处理。若评论所在 issue 不是 Pull Request，忽略或评论说明该命令只支持 PR。

权限判断：

- 评论者是 PR 作者：允许。
- 评论者是 Maintainer：允许。
- 其他用户：评论无权限，不入队。

允许后，重新读取 PR、Issue 和 label，根据当前 label 入队对应阶段任务。`need-to-spec` 触发 Spec Review；`ready-to-implement` 触发 Code Review；其他状态评论无法评审原因。

### 错误处理和可观测性

用户可修复的问题应写回 PR 评论或 review body，例如缺少 `Linked Issue`、路径错误、Issue label 不支持、权限不足、`.mole.yml` 格式错误。

服务内部错误记录 structured log，并在 job 中保存 `last_error`。外部 API 临时失败、OpenAI rate limit、GitHub secondary rate limit 应进入 `retryable`；配置缺失、权限不足、输入无效应进入 `failed` 并尽量给 PR 可操作反馈。

建议暴露：

- `GET /healthz`：进程存活。
- `GET /readyz`：数据库连接和必要配置可用。

## 测试与验证

### 单元测试

为 `internal/workflow` 覆盖以下行为：

- `Linked Issue #123` 能解析出唯一 Issue；缺失、多个引用、非法格式会返回明确错误。
- 根据 Issue label 正确判断 Spec Review、Code Review 和 unsupported 状态。
- Spec Review 阶段要求 `specs/GH-<issue>/PRODUCT.md` 与 `specs/GH-<issue>/TECH.md` 存在，路径不匹配时生成需要修改反馈。
- `/mole-review` 只允许 PR 作者和 Maintainer；其他用户不入队并生成无权限回复。
- `need-to-spec` 下 `/mole-review` 入队 Spec Review，`ready-to-implement` 下入队 Code Review。
- 已关闭 Issue、已关闭 PR、已合并 PR 不进入评审。

为 `internal/config` 覆盖：

- `.mole.yml` 缺失时使用默认 label。
- `.mole.yml` 能覆盖 label 和维护者 review target。
- YAML 格式错误会产生用户可操作错误。

为 `internal/reviewer` 覆盖：

- workflow 能根据 `approve` 调用 GitHub approve 和 label 更新。
- workflow 能根据 `request_changes` 调用 GitHub request changes，且不修改不应修改的 label。
- diff 截断时 reviewer 输入包含上下文不足提示。

GitHub API 使用 fake client，不访问真实 GitHub。

### 数据库集成测试

使用测试 PostgreSQL 覆盖 GORM models 和 repository：

- `github_deliveries.delivery_id` 唯一约束能阻止重复 delivery。
- 自动 webhook 对同一 repo、PR、head SHA、phase 不重复创建 job。
- `/mole-review` 可以对同一 SHA 和 phase 创建手动重评 job。
- worker 能用事务领取任务，多个 worker 不会领取同一 job。
- `retryable` job 在 lease 过期后可再次领取。
- 超过最大 attempts 后进入 `failed`。
- `pull_request_states` 能记录最后一次 Spec Review 和 Code Review 的 head SHA 与结果。

### HTTP 测试

使用 Gin test server 覆盖：

- 缺少或错误 webhook signature 返回非成功状态且不入队。
- 重复 `X-GitHub-Delivery` 返回成功但不重复入队。
- 支持的 `pull_request`、`issue_comment`、`issues` 事件会转换为预期 job。
- 不支持的 event 或 action 返回成功但不入队，避免 GitHub 反复重试。

### 手动验收

使用一个测试 GitHub 仓库安装 mole GitHub App，按 `PRODUCT.md` 中的完整流程验证：

1. 创建 Issue，添加 `need-to-spec`。
2. 创建 PR，描述包含 `Linked Issue #<number>`，提交 `specs/GH-<number>/PRODUCT.md` 和 `TECH.md`。
3. 验证 Spec Review 不通过时得到 `Request changes`，且 Issue label 不变。
4. 修复规格后触发重审，验证 mole `Approve`，Issue 添加 `ready-to-implement` 并移除 `need-to-spec`。
5. 在同一个 PR 提交实现代码，验证 Code Review 不通过时得到 `Request changes`，不添加失败 label。
6. 评论 `/mole-review`，验证 PR 作者和 Maintainer 可以触发，其他用户不能触发。
7. 修复实现后验证 Code Review 通过，PR 添加 `ready-for-maintainer-review`，并按 `.mole.yml` 请求维护者评审。
8. 关闭 Issue 或 PR 后再次触发 `/mole-review`，验证 mole 不再处理并给出对应提示。

### 回归边界

自动测试应直接覆盖 `PRODUCT.md` 中的重要行为不变量：

- GitHub 是唯一用户可见交互面。
- PR 必须通过 `Linked Issue #<number>` 关联唯一开放 Issue。
- Issue label 决定 Spec Review 或 Code Review 阶段。
- Spec Review 通过才会切换到 `ready-to-implement`。
- Code Review 通过才会添加 `ready-for-maintainer-review` 并请求维护者评审。
- 不通过时不添加失败 label。
- 首版不自动合并 PR，也不自动清理关闭对象上的 label。
