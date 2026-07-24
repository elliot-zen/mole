# mole

[English](../README.md)

一个基于 [@octokit/app](https://github.com/octokit/app.js) 的 GitHub App Webhook 服务（TypeScript）。

## 功能

- 接收并校验 GitHub Webhook（`/api/github/webhooks`）
- 当 App 在 issue 或评论中被 @ 时自动回复
- 内置事件处理：`ping`、`installation.created`、`issues.opened`、`issue_comment.created`
- 健康检查接口：`GET /healthz`
- Docker 化部署

## 环境变量

复制 `.env.example` 为 `.env` 并填写：

```bash
GITHUB_APP_ID=1234567
GITHUB_WEBHOOK_SECRET=你的WebhookSecret
GITHUB_PRIVATE_KEY_PATH=./certs/github-app.private-key.pem
PORT=3000

DEPLOY_HOST=服务器IP
DEPLOY_USER=root
DEPLOY_DIR=~/workspace/mole
```

把 GitHub App 的私钥文件（`*.private-key.pem`）放到 `certs/` 目录。

GitHub App 后台的 Webhook URL 配置为：

```
https://<你的域名>/api/github/webhooks
```

## 本地开发

```bash
npm install
npm run dev        # tsx 直接运行，支持 TypeScript
npm run typecheck  # 类型检查
```

本地调试 Webhook 可使用 [smee.io](https://smee.io) 转发。

## 部署

基于 Docker 的一键部署：

```bash
./deploy.sh
```

脚本执行流程：

1. 本地构建 Docker 镜像
2. 通过 `docker save | ssh docker load` 传输镜像到远程服务器
3. 通过 rsync 同步 `docker-compose.yml`、`.env` 和 `certs/`
4. 远程执行 `docker compose up -d` 重启容器

服务器操作：

```bash
cd ~/workspace/mole
docker compose up -d      # 启动
docker compose down       # 停止
docker compose logs -f    # 日志
docker compose restart    # 重启
```

## 项目结构

```
src/index.ts         # App 入口：环境变量、事件注册、HTTP 服务
Dockerfile           # 多阶段构建
docker-compose.yml   # 容器编排
deploy.sh            # 一键部署脚本
certs/               # GitHub App 私钥（不提交）
.env                 # 环境变量（不提交）
docs/                # 其他语言文档
```
