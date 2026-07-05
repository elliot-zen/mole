# GitHub 项目评审工作流

## 概述

mole 是一个运行在 GitHub 仓库中的 GitHub App 服务，用于协助维护者管理从 Issue 到规格、实现和维护者评审的协作流程。首版不提供独立 Web UI，所有用户可见交互都发生在 GitHub 的 Issue、Pull Request、Label、Review 和 Comment 中。

用户提出 Issue 后，维护者通过标签将 Issue 标记为需要规格设计。贡献者在同一个 Pull Request 中先提交规格文档，mole 审核通过后将 Issue 推进到可实现状态；贡献者继续在同一个 Pull Request 中提交实现代码，mole 完成第一轮代码评审后再交接给维护者评审。

## 行为

### Issue 进入规格阶段

用户在 GitHub 仓库中提出 Issue。维护者认为该 Issue 可以进入规格设计阶段时，为 Issue 添加 `need-to-spec` label。

带有 `need-to-spec` label 的开放 Issue 表示当前等待贡献者提交规格文档。mole 不主动为普通 Issue 发起审核，也不处理没有进入该状态的 Issue。

### 贡献者提交规格 PR

贡献者为带有 `need-to-spec` label 的 Issue 创建 Pull Request。该 Pull Request 必须在描述中包含 `Linked Issue #<issue-number>`，例如 `Linked Issue #123`。

mole 只接受一个 Pull Request 关联一个 Issue。若 Pull Request 没有 `Linked Issue #<issue-number>`、关联多个 Issue、关联的 Issue 不存在、关联的 Issue 已关闭，或关联的 Issue 没有 `need-to-spec` label，mole 在 Pull Request 中评论说明原因，并且不批准该 Pull Request。

规格文档必须位于对应 Issue 的固定目录中：

- `specs/GH-<issue-number>/PRODUCT.md`
- `specs/GH-<issue-number>/TECH.md`

例如，关联 `#123` 的 Pull Request 必须包含 `specs/GH-123/PRODUCT.md` 和 `specs/GH-123/TECH.md`。缺少任一文件、路径不匹配、或同一个 Pull Request 中提交了多个 Issue 的规格目录时，mole 在 Pull Request 中提交需要修改的反馈。

### Spec Review

当 Pull Request 关联的 Issue 处于 `need-to-spec` 状态时，mole 对该 Pull Request 执行 Spec Review。

Spec Review 关注 `PRODUCT.md`、`TECH.md` 与关联 Issue 的对齐情况。mole 检查规格是否覆盖 Issue 中描述的问题、目标、用户可见行为和关键约束；若文档遗漏、扩大范围、偏离 Issue 诉求，或 `PRODUCT.md` 与 `TECH.md` 之间存在明显冲突，mole 在 Pull Request 上提交 `Request changes` review。

`Request changes` review 应逐条列出不对齐点、缺失点和需要修改的文档位置。此时 mole 不添加 `ready-to-implement` label，也不移除 `need-to-spec` label。

贡献者更新 Pull Request 后，mole 会基于最新提交重新进行 Spec Review。贡献者也可以评论 `/mole-review` 请求重新评审；当关联 Issue 仍处于 `need-to-spec` 状态时，该命令触发 Spec Review。

当 Spec Review 通过时，mole 在 Pull Request 上提交 `Approve` review，在关联 Issue 上添加 `ready-to-implement` label，并移除 `need-to-spec` label。mole 不自动合并 Pull Request，Pull Request 是否合并由维护者或仓库规则决定。

### 同一个 PR 进入实现阶段

Spec Review 通过后，贡献者继续在同一个 Pull Request 中提交实现代码。mole 以关联 Issue 的 label 判断当前阶段；当关联 Issue 已有 `ready-to-implement` label 时，后续评审进入 Code Review 阶段。

`ready-to-implement` 表示规格已被 mole 接受，贡献者可以基于该 Pull Request 中的 `specs/GH-<issue-number>/PRODUCT.md` 和 `specs/GH-<issue-number>/TECH.md` 进行实现。

如果关联 Issue 还没有 `ready-to-implement` label，mole 不执行 Code Review，并在 Pull Request 中说明规格阶段尚未完成。

### Code Review

当关联 Issue 处于 `ready-to-implement` 状态且 Pull Request 收到新的提交时，mole 对最新提交执行 Code Review。

Code Review 是维护者评审前的第一轮自动评审，主要关注实现是否与关联 Issue、`PRODUCT.md` 和 `TECH.md` 对齐，以及代码风格是否符合仓库期望。若实现偏离规格、遗漏关键行为、引入明显不相关变更，或存在需要贡献者先处理的代码风格问题，mole 在 Pull Request 上提交 `Request changes` review。

`Request changes` review 应清楚说明需要修改的问题、影响范围和期望调整方向。mole 不为失败状态添加额外 label，贡献者和维护者通过 GitHub review 状态和评论判断当前是否需要修改。

贡献者根据反馈 push 新提交后，可以在 Pull Request 中评论 `/mole-review` 请求重新评审。当关联 Issue 已有 `ready-to-implement` label 时，该命令触发 Code Review。

当 Code Review 通过时，mole 在 Pull Request 上提交 `Approve` review，并为 Pull Request 添加 `ready-for-maintainer-review` label。mole 随后请求维护者评审，表示该 Pull Request 已完成自动评审并等待人工最终确认。关联 Issue 保持 `ready-to-implement` label。

### `/mole-review` 命令

`/mole-review` 是贡献者和维护者手动请求 mole 重新评审的 Pull Request 评论命令。

只有 Pull Request 作者和 Maintainer 可以使用 `/mole-review`。其他用户评论该命令时，mole 回复其没有触发权限，并且不执行评审。

mole 根据关联 Issue 的当前 label 决定执行哪一种评审：

- Issue 带有 `need-to-spec` label 时，执行 Spec Review。
- Issue 带有 `ready-to-implement` label 时，执行 Code Review。

如果 Pull Request 无法关联到唯一的开放 Issue，或关联 Issue 不处于 mole 支持的阶段，mole 评论说明无法评审的原因。

### 关闭和异常状态

首版中，mole 不自动清理 Issue 或 Pull Request 上的 label。

当关联 Issue 已关闭，或 Pull Request 已关闭、已合并时，mole 不再对新的相关事件发起审核。若用户在已关闭对象上触发 `/mole-review`，mole 回复该 Issue 或 Pull Request 已关闭，不再处理。

如果 GitHub 事件缺少 mole 判断阶段所需的信息，例如 Pull Request 描述为空、关联 Issue 无法读取、权限不足或 label 状态不明确，mole 在 Pull Request 中给出可操作的错误说明，并保持现有 Issue 和 Pull Request 状态不变。
