# mole

[中文文档](docs/README.zh-CN.md)

A GitHub App webhook server built with [@octokit/app](https://github.com/octokit/app.js) (TypeScript).

## Features

- Receives and verifies GitHub webhooks at `/api/github/webhooks`
- Auto-replies when the app is @mentioned in issues or comments
- Built-in event handlers: `ping`, `installation.created`, `issues.opened`, `issue_comment.created`
- Health check endpoint: `GET /healthz`
- Dockerized deployment

## Environment Variables

Copy `.env.example` to `.env` and fill in:

```bash
GITHUB_APP_ID=1234567
GITHUB_WEBHOOK_SECRET=your-webhook-secret
GITHUB_PRIVATE_KEY_PATH=./certs/github-app.private-key.pem
PORT=3000

DEPLOY_HOST=your-server-ip
DEPLOY_USER=root
DEPLOY_DIR=~/workspace/mole
```

Place the GitHub App private key (`*.private-key.pem`) in the `certs/` directory.

Configure the webhook URL in your GitHub App settings:

```
https://<your-domain>/api/github/webhooks
```

## Development

```bash
npm install
npm run dev        # run with tsx, TypeScript supported
npm run typecheck  # type check
```

Use [smee.io](https://smee.io) to forward webhooks for local debugging.

## Deployment

Docker-based deployment via `deploy.sh`:

```bash
./deploy.sh
```

The script will:

1. Build the Docker image locally
2. Transfer the image to the remote server via `docker save | ssh docker load`
3. Sync `docker-compose.yml`, `.env`, and `certs/` via rsync
4. Restart the container with `docker compose up -d`

Server operations:

```bash
cd ~/workspace/mole
docker compose up -d      # start
docker compose down       # stop
docker compose logs -f    # logs
docker compose restart    # restart
```

## Project Structure

```
src/index.ts         # App entry: env, event handlers, HTTP server
Dockerfile           # Multi-stage build
docker-compose.yml   # Container orchestration
deploy.sh            # One-click deployment script
certs/               # GitHub App private keys (not committed)
.env                 # Environment variables (not committed)
docs/                # Documentation in other languages
```
