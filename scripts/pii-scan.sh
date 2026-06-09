#!/usr/bin/env bash
# Paranoid pre-commit PII / secret guard. Scans only files git can actually commit
# (respects .gitignore). Exits non-zero if anything suspicious is found.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

# Generic catches only (nothing personal lives in this committed file): absolute
# /Users/<name> home paths (leak the username + a local layout) and private-key/token
# markers. Case-insensitive.
GENERIC='/Users/[a-z]|sk-ant-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY|VITE_RELAY_TOKEN=[A-Za-z0-9]'

# The PERSONAL patterns (real names, account-number fragments, real ISIN prefixes/tickers
# from the user's statements, email) live in a GITIGNORED denylist — one regex per line,
# '#' comments allowed — so the guard itself never ships the PII it exists to protect.
# The scan refuses to run without it: a missing denylist must fail loudly, never pass.
DENYLIST="scripts/.pii-denylist"
if [ ! -f "$DENYLIST" ]; then
  echo "✗ $DENYLIST is missing — create it (gitignored; one personal-pattern regex per line)."
  echo "  The PII scan will not run without the personal denylist."
  exit 1
fi
PERSONAL=$(grep -v '^[[:space:]]*#' "$DENYLIST" | grep -v '^[[:space:]]*$' | paste -sd'|' -)
if [ -z "$PERSONAL" ]; then
  echo "✗ $DENYLIST has no patterns — refusing to run a weakened scan."
  exit 1
fi
PATTERNS="$GENERIC|$PERSONAL"

# Known-safe occurrences that are NOT financial PII: the public GitHub handle "miteshs" in
# repo/tap URLs (it's in the remote URL + commit author already), and the commit-author email.
# These are allowed only in those exact contexts so a real "<name> <account>" leak still trips.
ALLOW='miteshs/|github\.com/miteshs|homebrew-sampatti|miteshs <|users\.noreply\.github\.com'

# Candidate files = everything git tracks + untracked-not-ignored, minus this scanner and lockfiles.
FILES=$(git ls-files; git ls-files --others --exclude-standard)
FILES=$(echo "$FILES" | sort -u | grep -vE 'scripts/pii-scan\.sh|package-lock\.json|\.lock$')

HITS=$(echo "$FILES" | while IFS= read -r f; do
  [ -f "$f" ] || continue
  # File NAMES can leak too (e.g. a statement saved as "<name>-portfolio.csv").
  echo "$f" | grep -iE "$PATTERNS" 2>/dev/null | grep -vE "$ALLOW" | sed "s|^|FILENAME: |"
  grep -IniE "$PATTERNS" "$f" 2>/dev/null | grep -vE "$ALLOW" | sed "s|^|$f:|"
done)

if [ -n "$HITS" ]; then
  echo "✗ PII/secret scan FAILED — do NOT commit. Matches:"
  echo "$HITS"
  exit 1
fi
echo "✓ PII/secret scan clean ($(echo "$FILES" | grep -c . ) committable files checked)"
