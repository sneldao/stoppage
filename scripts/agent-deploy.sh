#!/usr/bin/env bash
# One-command agent redeploy on the VPS (nuncio-vultr).
#
# Pulls latest main, reinstalls deps, and restarts the PM2 process.
# Run from your laptop:
#
#   ./scripts/agent-deploy.sh
#
# Or with options:
#   ./scripts/agent-deploy.sh --no-pull   # skip git pull (you already did it)
#   ./scripts/agent-deploy.sh --logs      # tail pm2 logs after restart
#
# The VPS layout (per docs/DEVELOPMENT.md):
#   /home/linuxuser/stoppage       — repo clone
#   .env.agent                     — TXLINE creds + keypair path (mode 600)
#   PM2 process: stoppage-agent    — managed by deploy/ecosystem.agent.config.cjs
#
# This script is the agent-side counterpart to Vercel's auto-deploy of
# apps/web. The web app deploys on git push; the agent does not, so this
# script exists to make the VPS redeploy equally one-command.

set -euo pipefail

SSH_HOST="${SSH_HOST:-nuncio-vultr}"
REMOTE_DIR="${REMOTE_DIR:-/home/linuxuser/stoppage}"
PM2_NAME="${PM2_NAME:-stoppage-agent}"
TAIL_LOGS=false
DO_PULL=true

for arg in "$@"; do
  case "$arg" in
    --no-pull) DO_PULL=false ;;
    --logs)    TAIL_LOGS=true ;;
    -h|--help)
      echo "Usage: $0 [--no-pull] [--logs]"
      echo "  --no-pull  Skip git pull on the VPS (use if you already pulled)"
      echo "  --logs     Tail PM2 logs after restart (Ctrl-C to exit)"
      exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

echo "── redeploying $PM2_NAME on $SSH_HOST:$REMOTE_DIR"

PULL_CMD=""
if $DO_PULL; then
  PULL_CMD="git fetch origin main && git reset --hard origin/main &&"
fi

ssh "$SSH_HOST" "set -euo pipefail; cd $REMOTE_DIR && \
  $PULL_CMD \
  npm ci --omit=dev && \
  set -a && source .env.agent && set +a && \
  pm2 restart $PM2_NAME --update-env && \
  pm2 save && \
  sleep 2 && \
  curl -s --max-time 5 http://localhost:\${AGENT_HTTP_PORT:-18766}/health && \
  echo"

echo "── agent restarted. Health check above should show {\"ok\":true,...}"

if $TAIL_LOGS; then
  echo "── tailing logs (Ctrl-C to exit)"
  ssh "$SSH_HOST" "cd $REMOTE_DIR && pm2 logs $PM2_NAME --lines 50"
fi
