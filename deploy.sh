#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

REMOTE_USER="${DEPLOY_USER:-root}"
REMOTE_HOST="${DEPLOY_HOST:?Missing DEPLOY_HOST environment variable}"
REMOTE_DIR="${DEPLOY_DIR:-~/workspace/mole}"
IMAGE_NAME="mole:latest"

echo "Building Docker image..."
docker build -t "$IMAGE_NAME" .

echo "Saving and transferring image..."
docker save "$IMAGE_NAME" | gzip | ssh "${REMOTE_USER}@${REMOTE_HOST}" "gunzip | docker load"

echo "Syncing config files..."
ssh "${REMOTE_USER}@${REMOTE_HOST}" "mkdir -p ${REMOTE_DIR}"
rsync -avz \
  docker-compose.yml \
  .env \
  certs \
  "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/"

echo "Restarting container..."
ssh "${REMOTE_USER}@${REMOTE_HOST}" "cd ${REMOTE_DIR} && docker compose down && docker compose up -d && docker compose ps"

echo "Done."
echo "Logs: ssh ${REMOTE_USER}@${REMOTE_HOST} 'cd ${REMOTE_DIR} && docker compose logs -f'"
