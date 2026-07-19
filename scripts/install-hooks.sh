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

# Discover the target hooks directory. Respect git config
# core.hooksPath if set (absolute or repo-relative); otherwise default
# to .git/hooks. Resolving to an absolute path here means the rest of
# the script can pass $HOOKS_DIR to cp/mkdir without ambiguity.
HOOKS_DIR=$(git config --get core.hooksPath 2>/dev/null || true)
if [ -z "$HOOKS_DIR" ]; then
  HOOKS_DIR=".git/hooks"
fi
case "$HOOKS_DIR" in
  /*) ;;  # already absolute
  *)  HOOKS_DIR="$(git rev-parse --show-toplevel)/$HOOKS_DIR" ;;
esac

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
echo "  pre-push   — check:ids + typecheck always; build on relevant diff; anchor:build un-timed"
echo "                (typecheck + build: 10-min cap if GNU 'timeout' is installed — brew install coreutils on macOS)"
echo ""
echo "Hooks target: $HOOKS_DIR"
echo "(override per-repo with: git config core.hooksPath <path>)"
echo ""
echo "Bypass: git commit --no-verify / git push --no-verify"
