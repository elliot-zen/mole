# mole

一个基于 [@octokit/app](https://github.com/octokit/app.js) 的 GitHub App Webhook 服务（TypeScript）。

## 功能

- 接收并校验 GitHub Webhook（`/api/github/webhooks`）
- 内置事件示例：
  - `ping`
  - `installation.created`
  - `issues.opened`（自动回复评论）
- 健康检查接口：`GET /healthz`

## 环境变量

复制 `.env.example` 为 `.env` 并填写：

```bash
GITHUB_APP_ID=1234567
GITHUB_WEBHOOK_SECRET=你的WebhookSecret
GITHUB_PRIVATE_KEY_PATH=./github-app.private-key.pem
PORT=3000
```

把 GitHub App 的私钥文件（`*.private-key.pem`）放到 `GITHUB_PRIVATE_KEY_PATH` 指定的位置。

GitHub App 后台的 Webhook URL 配置为：

```
https://<你的域名>/api/github/webhooks
```

## 本地开发

```bash
npm install
npm run dev        # tsx 直接运行，支持 TypeScript
```

本地调试 Webhook 可使用 [smee.io](https://smee.io) 转发。

## 构建

```bash
npm run build      # 输出到 dist/
npm start          # 运行 dist/index.js
```

## 打包部署

在本地（或 CI）构建并裁剪依赖后打包：

```bash
npm ci
npm run build
npm prune --omit=dev

tar czf mole.tar.gz \
  dist node_modules package.json package-lock.json \
  .env github-app.private-key.pem
```

> 注意：`.env` 和私钥文件包含敏感信息，请确认目标服务器可信，或使用密钥管理服务替代。

上传到远程服务器后：

```bash
tar xzf mole.tar.gz
cd mole   # 按实际解压目录
node dist/index.js
```

### 使用 systemd 常驻运行（可选）

`/etc/systemd/system/mole.service`：

```ini
[Unit]
Description=mole GitHub App
After=network.target

[Service]
WorkingDirectory=/opt/mole
ExecStart=/usr/bin/node dist/index.js
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now mole
```

## 项目结构

```
src/index.ts    # App 入口：环境变量、事件注册、HTTP 服务
dist/           # 构建产物
.env            # 环境变量（不提交）
```
