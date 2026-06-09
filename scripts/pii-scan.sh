#!/usr/bin/env bash
# Paranoid pre-commit PII / secret guard. Scans only files git can actually commit
# (respects .gitignore). Exits non-zero if anything suspicious is found.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

# Personal identifiers + real entities from the user's actual statements, real account
# numbers, real ISIN prefixes seen in samples, secrets. Case-insensitive.
PATTERNS='mitesh|shriya|shah family|\bashva\b|cache fund|calpers|roblox|\brblx\b|globalfoundries|\bgfs\b|credicorp|\bcopa\b|pelagos|butterfield|pagseguro|synopsys|\bsnps\b|218743745|229660187|216779394|031492|440942|INE742F|INE079A|INE067A|INE437A|INE263A|adaniports|ambujacem|apollohosp|bharatforg|godrejprop|torntpower|sk-ant-[A-Za-z0-9_-]{20,}|VITE_RELAY_TOKEN=[A-Za-z0-9]|mpshah@'

# Known-safe occurrences that are NOT financial PII: the public GitHub handle "miteshs" in
# repo/tap URLs (it's in the remote URL + commit author already), and the commit-author email.
# These are allowed only in those exact contexts so a real "Mitesh <account>" leak still trips.
ALLOW='miteshs/|github\.com/miteshs|homebrew-sampatti|miteshs <|users\.noreply\.github\.com'

# Candidate files = everything git tracks + untracked-not-ignored, minus this scanner and lockfiles.
FILES=$(git ls-files; git ls-files --others --exclude-standard)
FILES=$(echo "$FILES" | sort -u | grep -vE 'scripts/pii-scan\.sh|package-lock\.json|\.lock$')

HITS=$(echo "$FILES" | while IFS= read -r f; do
  [ -f "$f" ] || continue
  grep -IniE "$PATTERNS" "$f" 2>/dev/null | grep -vE "$ALLOW" | sed "s|^|$f:|"
done)

if [ -n "$HITS" ]; then
  echo "✗ PII/secret scan FAILED — do NOT commit. Matches:"
  echo "$HITS"
  exit 1
fi
echo "✓ PII/secret scan clean ($(echo "$FILES" | grep -c . ) committable files checked)"
