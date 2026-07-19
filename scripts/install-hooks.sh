#!/usr/bin/env bash
#
# Install git hooks for the Stoppage repo.
#
# Usage: ./scripts/install-hooks.sh
#
# Installs:
#   - pre-commit: secret detection + program-ID check
#   - pre-push: heavier gates (check:ids, typecheck, anchor:build, build)

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

HOOKS_DIR=".git/hooks"
SCRIPT_DIR="scripts"

mkdir -p "$HOOKS_DIR"

# pre-commit
cp "$SCRIPT_DIR/pre-commit.sh" "$HOOKS_DIR/pre-commit"
chmod +x "$HOOKS_DIR/pre-commit"
echo "Installed pre-commit hook."

# pre-push
cp "$SCRIPT_DIR/pre-push.sh" "$HOOKS_DIR/pre-push"
chmod +x "$HOOKS_DIR/pre-push"
echo "Installed pre-push hook."

echo ""
echo "Installed:"
echo "  pre-commit — secret detection + program-ID discipline"
echo "  pre-push   — check:ids + typecheck always; anchor:build + build on relevant diff"
echo ""
echo "Bypass: git commit --no-verify / git push --no-verify"
