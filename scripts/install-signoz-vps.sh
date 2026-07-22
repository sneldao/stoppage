#!/usr/bin/env bash
# Install Docker + SigNoz (Foundry) on the agent VPS (one-time).
#
# SigNoz OTLP HTTP: http://127.0.0.1:4318
# SigNoz UI:        http://127.0.0.1:9090  (8080 is used by coolify-proxy)
#
# After install, ensure .env.agent on the VPS includes:
#   OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
#   OTEL_SERVICE_NAME=stoppage-agent
#
# Usage:
#   ./scripts/install-signoz-vps.sh
#   ./scripts/install-signoz-vps.sh --check

set -euo pipefail

SSH_HOST="${SSH_HOST:-nuncio-vultr}"
SIGNOZ_DIR="${SIGNOZ_DIR:-/home/linuxuser/signoz-stack}"
CHECK_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=true ;;
    -h|--help)
      echo "Usage: $0 [--check]"
      exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

if $CHECK_ONLY; then
  ssh "$SSH_HOST" "curl -sf http://127.0.0.1:9090/api/v1/health >/dev/null && echo 'SigNoz UI :9090: ok' || echo 'SigNoz UI :9090: down'"
  ssh "$SSH_HOST" "curl -sf http://127.0.0.1:4318/ >/dev/null 2>&1; echo 'OTLP :4318: listening (ingester up)'"
  ssh "$SSH_HOST" "sudo docker ps --format '{{.Names}} {{.Status}}' | grep signoz || true"
  exit 0
fi

echo "── installing Docker + SigNoz (Foundry) on $SSH_HOST"

ssh "$SSH_HOST" "set -euo pipefail
  if ! command -v docker >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker \"\$USER\"
  fi

  if ! command -v foundryctl >/dev/null 2>&1; then
    curl -fsSL https://signoz.io/foundry.sh | bash
  fi
  export PATH=\"\$HOME/.local/bin:\$HOME/.foundry/bin:\$PATH\"
  command -v foundryctl >/dev/null

  mkdir -p '$SIGNOZ_DIR'
  cat > '$SIGNOZ_DIR/casting.yaml' <<'CASTING_EOF'
apiVersion: v1alpha1
kind: Installation
metadata:
  name: signoz
spec:
  deployment:
    flavor: compose
    mode: docker
  patches:
    - target: deployment/compose.yaml
      operations:
        - op: replace
          path: /services/signoz-signoz-0/ports/0
          value: \"9090:8080\"
CASTING_EOF
  cd '$SIGNOZ_DIR'

  if docker ps >/dev/null 2>&1; then
    foundryctl cast -f casting.yaml
  else
    sudo env \"PATH=\$PATH\" foundryctl cast -f casting.yaml
  fi

  echo 'Waiting for SigNoz (up to 180s)...'
  for i in \$(seq 1 36); do
    if curl -sf http://127.0.0.1:9090/api/v1/health >/dev/null 2>&1; then
      echo 'SigNoz is up at http://127.0.0.1:9090'
      exit 0
    fi
    sleep 5
  done
  echo 'SigNoz UI did not become healthy — OTLP may still work on :4318'
  if docker ps >/dev/null 2>&1; then docker ps -a | grep signoz; else sudo docker ps -a | grep signoz; fi
  exit 1
"

echo "── done. UI tunnel: ssh -L 9090:127.0.0.1:9090 $SSH_HOST"
