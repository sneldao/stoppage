#!/usr/bin/env bash
#
# Pre-commit hook: secret detection + build verification.
#
# Installed by: scripts/install-hooks.sh
#
# Checks:
#   1. No secrets in staged files (private keys, JWTs, API tokens, .env files)
#   2. No .txline-credentials.json or .env files staged
#   3. npm run check:ids passes (program-ID discipline)
#
# The build check (npm run build) is intentionally NOT run here — it's
# too slow for a pre-commit hook. It runs in scripts/pre-push.sh
# instead, which gates the remote after the small checks have passed.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# ── 1. Secret detection ─────────────────────────────────────────────

# Patterns that indicate secrets in source files
SECRET_PATTERNS=(
  'eyJ[A-Za-z0-9_-]{20,}'          # JWT tokens
  'sk_[A-Za-z0-9]{20,}'            # OpenAI-style API keys
  '[A-Za-z0-9_-]{40,}\.pem'        # PEM file references
  "BEGIN ""RSA PRIVATE KEY"     # PEM private key header
  "BEGIN ""EC PRIVATE KEY"      # PEM private key header
  'private_key.*[=:]\s*["\x27][A-Za-z0-9]{30,}'
  'mnemonic.*[=:]\s*["\x27][a-z ]{30,}'
)

# Files that should never be committed
FORBIDDEN_FILES=(
  '.txline-credentials.json'
  '.env'
  '.env.local'
  '.env.production'
  '.env.development'
)

# Get staged files (added, modified, not deleted)
STAGED=$(git diff --cached --name-only --diff-filter=ACM)

if [ -z "$STAGED" ]; then
  exit 0
fi

# Check for forbidden files
for file in $STAGED; do
  for forbidden in "${FORBIDDEN_FILES[@]}"; do
    if [[ "$(basename "$file")" == "$forbidden" ]]; then
      echo "ERROR: Forbidden file staged: $file"
      echo "  This file may contain secrets. Add it to .gitignore."
      exit 1
    fi
  done
done

# Check staged file contents for secret patterns
# (only check text files, skip binary)
for file in $STAGED; do
  # Skip binary files and deleted files
  [ ! -f "$file" ] && continue

  # Only check text-like files
  case "$file" in
    *.ts|*.tsx|*.js|*.jsx|*.rs|*.json|*.toml|*.md|*.sh|*.env*)
      ;;
    *)
      continue
      ;;
  esac

  # Skip keys/ directory (devnet program keypairs are intentionally committed)
  case "$file" in
    keys/*)
      continue
      ;;
  esac

  # Skip package-lock.json (too large, false positives)
  case "$file" in
    package-lock.json)
      continue
      ;;
  esac

  # Check each pattern
  for pattern in "${SECRET_PATTERNS[@]}"; do
    if grep -qE "$pattern" "$file" 2>/dev/null; then
      echo "ERROR: Potential secret detected in $file"
      echo "  Pattern: $pattern"
      echo "  If this is a false positive, bypass with: git commit --no-verify"
      exit 1
    fi
  done
done

# ── 2. Program-ID discipline ────────────────────────────────────────

# Only run check:ids if program-related files are staged
if echo "$STAGED" | grep -qE '(keys/|programs/|packages/sdk/src/programIds|Anchor\.toml)'; then
  echo "Checking program IDs..."
  if ! npm run check:ids --silent 2>/dev/null; then
    echo "ERROR: npm run check:ids failed."
    echo "  Program IDs are out of sync. Run: npm run sync:ids"
    exit 1
  fi
fi

echo "Pre-commit checks passed."
