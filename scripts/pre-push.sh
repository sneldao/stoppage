#!/usr/bin/env bash
#
# Pre-push hook: gate the remote with heavier checks.
#
# Installed by: scripts/install-hooks.sh
#
# Checks (run in order):
#   1. npm run check:ids   — always (program-ID discipline; fast)
#   2. npm run typecheck   — always (fast, catches TS errors before build noise)
#   3. npm run anchor:build — only if the push diff touches programs/,
#                              keys/, packages/sdk/src/programIds, or
#                              Anchor.toml
#   4. npm run build       — only if the push diff touches apps/,
#                              packages/, package.json, or
#                              package-lock.json
#
# Edge cases:
#   - First push of a new branch (no upstream): runs ALL checks
#     unconditionally.
#   - Force-push / shallow clone where the diff base is missing locally:
#     runs ALL checks (safe fallback).
#   - Branch deletion: skipped (no SHA to diff).
#
# Bypass: git push --no-verify
#

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

echo "pre-push: deciding which checks to run based on push diff..."
echo "  (bypass with: git push --no-verify)"

# If GNU 'timeout' isn't on PATH (stock macOS), timed checks
# (typecheck, build) will run without their 10-min cap. Surface this
# once at the top so the operator knows rather than discovering it
# after a hung build.
if ! command -v timeout >/dev/null 2>&1; then
  echo "  (note: GNU 'timeout' not on PATH \u2014 timed checks run uncapped."
  echo "   install with 'brew install coreutils' to enable the 10-min safety net.)"
fi

# ── 1. Compute the push diff from git's stdin ──────────────────────
#
# git invokes pre-push with one line per ref being pushed:
#   <local_ref> <local_sha> <remote_ref> <remote_sha>
#
# For a deletion, local_sha is 0000...; for a new branch, remote_sha
# is 0000....

RUN_ALL=false
CHANGED_FILES=""

while read -r local_ref local_sha remote_ref remote_sha; do
  # Branch deletion — nothing to check.
  if [ "$local_sha" = "0000000000000000000000000000000000000000" ]; then
    continue
  fi

  # New branch (first push) — no upstream to diff against.
  if [ "$remote_sha" = "0000000000000000000000000000000000000000" ]; then
    RUN_ALL=true
    break
  fi

  # Force-push / shallow clone: remote_sha may not exist locally.
  # Verify before diffing; fall back to RUN_ALL if it's missing.
  if ! git cat-file -e "$remote_sha" 2>/dev/null; then
    RUN_ALL=true
    break
  fi

  DIFF=$(git diff --name-only "$remote_sha" "$local_sha" 2>/dev/null || true)
  if [ -z "$DIFF" ]; then
    continue
  fi
  CHANGED_FILES="${CHANGED_FILES}${DIFF}"$'\n'
done

# ── 2. Decide which conditional checks to run ─────────────────────

run_anchor=false
run_build=false

if [ "$RUN_ALL" = true ]; then
  run_anchor=true
  run_build=true
  echo "  - new branch / unverifiable base → running ALL checks"
elif [ -n "$CHANGED_FILES" ]; then
  if printf '%s' "$CHANGED_FILES" | grep -qE '^(programs/|keys/|packages/sdk/src/programIds|Anchor\.toml)'; then
    run_anchor=true
  fi
  if printf '%s' "$CHANGED_FILES" | grep -qE '^(apps/|packages/|package\.json|package-lock\.json)'; then
    run_build=true
  fi
fi

echo "  - check:ids:        YES (always)"
echo "  - typecheck:        YES (always)"
echo "  - anchor:build:     $([ "$run_anchor" = true ] && echo YES || echo 'no (no program changes in push)')"
echo "  - build:            $([ "$run_build" = true ] && echo YES || echo 'no (no app/package changes in push)')"

# ── 3. Helper ──────────────────────────────────────────────────────

run_npm_script() {
  local script=$1
  local timeout_secs=${2:-}
  local start cmd
  start=$(date +%s)
  echo ""

  if [ -n "$timeout_secs" ] && command -v timeout >/dev/null 2>&1; then
    echo "▶ timeout ${timeout_secs}s npm run ${script}"
    cmd=(timeout "$timeout_secs" npm run "$script")
  else
    echo "▶ npm run ${script}"
    cmd=(npm run "$script")
  fi

  if ! "${cmd[@]}"; then
    local rc=$?
    echo ""
    # GNU timeout exits 124 when it kills the process for exceeding the
    # time limit. Surface that distinctly so the user can tell apart a
    # genuine build failure from a hung build.
    if [ "${cmd[0]}" = "timeout" ] && [ "$rc" -eq 124 ]; then
      echo "✖ pre-push FAILED: npm run ${script} exceeded ${timeout_secs}s timeout"
    else
      echo "✖ pre-push FAILED on: npm run ${script}"
    fi
    echo "  Bypass this hook with: git push --no-verify"
    exit 1
  fi
  local elapsed=$(( $(date +%s) - start ))
  echo "  ✓ npm run ${script} (${elapsed}s)"
}

# ── 4. Fast checks (always) ────────────────────────────────────────

run_npm_script "check:ids"
run_npm_script "typecheck" 600

# ── 5. Slow checks (conditional) ───────────────────────────────────

if [ "$run_anchor" = true ]; then
  # anchor:build legitimately takes minutes (cold IDL + program
  # rebuilds); deliberately left un-timed.
  run_npm_script "anchor:build"
fi

if [ "$run_build" = true ]; then
  run_npm_script "build" 600
fi

echo ""
echo "✓ pre-push checks passed."
