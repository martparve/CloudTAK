#!/bin/bash
# Pull-based continuous deployment for the TAARA CloudTAK server.
#
# Runs from a systemd timer every few minutes. If the deploy branch on GitHub has
# moved, it fast-forwards the checkout, rebuilds the images and restarts the stack.
# No inbound credentials are needed: the server only pulls from the public fork.
#
# Config: /etc/taara-deploy.env may override REPO_DIR, BRANCH, REMOTE.
set -euo pipefail

REPO_DIR=${REPO_DIR:-/home/ubuntu/CloudTAK}
BRANCH=${BRANCH:-taara}
REMOTE=${REMOTE:-origin}
LOG=${LOG:-/var/log/taara-deploy.log}
[ -f /etc/taara-deploy.env ] && source /etc/taara-deploy.env

exec >>"$LOG" 2>&1

cd "$REPO_DIR"
git fetch --quiet "$REMOTE" "$BRANCH"
local_rev=$(git rev-parse HEAD)
remote_rev=$(git rev-parse "$REMOTE/$BRANCH")

if [ "$local_rev" = "$remote_rev" ] && [ "${FORCE:-0}" != 1 ]; then
    exit 0
fi

echo "=== $(date -Is) deploying $BRANCH ${local_rev:0:8} -> ${remote_rev:0:8}"
git checkout --quiet "$BRANCH" 2>/dev/null || git checkout --quiet -b "$BRANCH" "$REMOTE/$BRANCH"
git reset --quiet --hard "$REMOTE/$BRANCH"

# Build first so a broken build never takes the running stack down.
docker compose build --quiet
docker compose up -d --remove-orphans
docker image prune -f --filter "until=168h" >/dev/null || true

echo "=== $(date -Is) deployed ${remote_rev:0:8}"
docker compose ps --format 'table {{.Name}}\t{{.Status}}'
