#!/usr/bin/env bash
# One-command agent redeploy on the VPS (nuncio-vultr).
#
# Pulls latest main, reinstalls deps, and restarts the PM2 process.
# Includes pre-flight health check and automatic rollback on failure.
#
# Run from your laptop:
#
#   ./scripts/agent-deploy.sh
#
# Or with options:
#   ./scripts/agent-deploy.sh --no-pull          # skip git pull
#   ./scripts/agent-deploy.sh --logs             # tail pm2 logs after restart
#   ./scripts/agent-deploy.sh --no-pull --logs   # restart current code, then tail logs
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
AGENT_PORT="${AGENT_PORT:-18766}"
TAIL_LOGS=false
DO_PULL=true
REQUIRE_HEALTHY=false

for arg in "$@"; do
  case "$arg" in
    --no-pull)          DO_PULL=false ;;
    --logs)             TAIL_LOGS=true ;;
    --require-healthy)  REQUIRE_HEALTHY=true ;;
    -h|--help)
      cat <<EOF
Usage: $0 [options]

Options:
  --no-pull          Skip git pull on the VPS (use if you already pulled)
  --logs             Tail PM2 logs after restart (Ctrl-C to exit)
  --require-healthy  Abort before deploy if the agent is not currently healthy
  -h, --help         Show this help message

Environment overrides:
  SSH_HOST     default: nuncio-vultr
  REMOTE_DIR   default: /home/linuxuser/stoppage
  PM2_NAME     default: stoppage-agent
  AGENT_PORT   default: 18766
EOF
      exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

echo "── redeploying $PM2_NAME on $SSH_HOST:$REMOTE_DIR"

# Run the deployment inside a single SSH session so that rollback can happen
# in the same environment if the post-deploy health check fails. Environment
# values are forwarded explicitly so the remote shell sees them.
ssh "$SSH_HOST" \
  REMOTE_DIR="$REMOTE_DIR" \
  PM2_NAME="$PM2_NAME" \
  AGENT_PORT="$AGENT_PORT" \
  DO_PULL="$DO_PULL" \
  REQUIRE_HEALTHY="$REQUIRE_HEALTHY" \
  bash -s <<'REMOTE_EOF'
set -euo pipefail

cd "$REMOTE_DIR"

# ── helper: check agent health ─────────────────────────────────────────────
check_health() {
  local label="$1"
  local max_attempts="${2:-1}"
  local delay="${3:-0}"
  local url="http://localhost:${AGENT_PORT}/health"
  local attempt
  local status

  for ((attempt = 1; attempt <= max_attempts; attempt++)); do
    if status=$(curl -s --max-time 10 "$url" 2>/dev/null) && \
       [[ "$status" == *'"ok":true'* ]]; then
      echo " $label healthy ($url)"
      return 0
    fi
    if ((attempt < max_attempts)); then
      echo "  $label health check attempt $attempt/$max_attempts failed, retrying in ${delay}s..."
      sleep "$delay"
    fi
  done

  echo " $label health check failed" >&2
  return 1
}

# ── pre-flight snapshot ──────────────────────────────────────────────────────
BEFORE_COMMIT=$(git rev-parse HEAD)
BEFORE_COMMIT_SHORT=$(git rev-parse --short HEAD)
echo "── pre-flight state: commit $BEFORE_COMMIT_SHORT"

if ! check_health "pre-flight" 1 0; then
  if $REQUIRE_HEALTHY; then
    echo "✗ Aborting: agent is not healthy and --require-healthy was passed" >&2
    exit 1
  fi
  echo "! pre-flight health check failed; continuing deploy anyway"
fi

# ── pull and install ─────────────────────────────────────────────────────────
if $DO_PULL; then
  echo "── pulling origin/main"
  git fetch origin main
  git reset --hard origin/main
fi

AFTER_COMMIT=$(git rev-parse HEAD)
AFTER_COMMIT_SHORT=$(git rev-parse --short HEAD)

echo "── installing dependencies"
npm ci

# ── restart PM2 with refreshed environment ──────────────────────────────────
echo "── restarting $PM2_NAME (port $AGENT_PORT)"
set -a
source .env.agent
set +a

pm2 restart "$PM2_NAME" --update-env
pm2 save

# ── post-deploy health check with retries ───────────────────────────────────
echo "── waiting for agent to become healthy"
if check_health "post-deploy" 12 5; then
  echo
  echo "=== deploy succeeded ==="
  echo "  before: $BEFORE_COMMIT_SHORT"
  echo "  after:  $AFTER_COMMIT_SHORT"
  echo "  health: http://localhost:${AGENT_PORT}/health -> ok"
  exit 0
fi

# ── rollback on failure ──────────────────────────────────────────────────────
echo "! post-deploy health check failed; rolling back to $BEFORE_COMMIT_SHORT" >&2
git reset --hard "$BEFORE_COMMIT"
pm2 restart "$PM2_NAME" --update-env
pm2 save

if check_health "rollback" 12 5; then
  echo
  echo "=== deploy failed; rollback succeeded ==="
  echo "  rolled back to: $BEFORE_COMMIT_SHORT"
  exit 1
else
  echo "✗ CRITICAL: deploy failed AND rollback health check failed" >&2
  echo "   current commit: $(git rev-parse --short HEAD)" >&2
  exit 2
fi
REMOTE_EOF

DEPLOY_EXIT=$?

if $TAIL_LOGS; then
  echo ""
  echo "── tailing logs (Ctrl-C to exit)"
  ssh "$SSH_HOST" "cd $REMOTE_DIR && pm2 logs $PM2_NAME --lines 50"
fi

exit $DEPLOY_EXIT
