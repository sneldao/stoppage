#!/usr/bin/env bash
#
# Install git hooks for the Stoppage repo.
#
# Usage: ./scripts/install-hooks.sh
#
# Installs:
#   - pre-commit: secret detection + program-ID check

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

HOOKS_DIR=".git/hooks"
SCRIPT_DIR="scripts"

mkdir -p "$HOOKS_DIR"

# pre-commit
cp "$SCRIPT_DIR/pre-commit.sh" "$HOOKS_DIR/pre-commit"
chmod +x "$HOOKS_DIR/pre-commit"
echo "Installed pre-commit hook."

echo ""
echo "Git hooks installed. To bypass on a specific commit: git commit --no-verify"
