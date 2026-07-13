#!/usr/bin/env bash
# scripts/scrub-scan.sh — PII / secret scrub gate for Bob the Intendant.
#
# Public-Flip Gate condition #3 (intent-eval-lab 109-AT-DECR §7): a pre-commit +
# CI scanner that blocks real secrets and real personal / Governed-Second-Brain
# (GSB) data before they reach public git history. The demo/eval brain is a public
# benchmark (HotpotQA/BEIR) or synthetic fixtures — NEVER real GSB nuggets — and no
# real partner/client name lands as an example/endorser without written consent.
#
# This is an HONEST heuristic scrubber, not a guarantee: it catches known secret
# shapes + a denylist of real names/paths. It fails CLOSED (any hit blocks) but a
# clean pass is not proof of absence — pair it with review + the claim discipline.
#
# Modes:
#   --staged   scan only the ADDED lines of the staged diff (pre-commit)
#   --all      scan all git-tracked files (CI / on demand)   [default]
#
# Exit: 0 = clean · 1 = a secret/PII pattern matched (blocked)
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

MODE="all"
[[ "${1:-}" == "--staged" ]] && MODE="staged"
[[ "${1:-}" == "--all" ]] && MODE="all"

# Paths excluded from the scan: the scrubber's own denylist + this script + the
# claim registry (they enumerate patterns); vendored harness (self-matching); the
# lockfile; VCS internals.
EXCLUDE_RE='^(scripts/scrub-scan\.sh|\.scrub-denylist|MARKETING_CLAIMS\.md|bun\.lock|\.audit-harness/|node_modules/|\.git/)'

# Real-secret shapes (NOT the synthetic test placeholders like `T/B/secret`).
declare -a SECRET_PATTERNS=(
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'                       # private key blocks
  'ghp_[A-Za-z0-9]{36}'                                       # GitHub PAT (classic)
  'github_pat_[A-Za-z0-9_]{40,}'                              # GitHub PAT (fine-grained)
  'gh[ousr]_[A-Za-z0-9]{36}'                                  # GitHub oauth/server/refresh
  'xox[baprs]-[A-Za-z0-9]{8,}-[A-Za-z0-9-]{8,}'               # Slack tokens
  'hooks\.slack\.com/services/T[A-Z0-9]{8,}/B[A-Z0-9]{7,}/[A-Za-z0-9]{20,}'  # real Slack webhook (not T/B/secret)
  'AKIA[0-9A-Z]{16}'                                          # AWS access key id
  'AIza[0-9A-Za-z_\-]{35}'                                    # Google API key
  'sk-ant-[A-Za-z0-9_\-]{24,}'                                # Anthropic key
  'sk-[A-Za-z0-9]{40,}'                                       # OpenAI-style key
  'glpat-[A-Za-z0-9_\-]{20,}'                                 # GitLab PAT
  'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'  # JWT
)

# A KEY/SECRET/TOKEN/PASSWORD assigned a long high-entropy value — excluding
# obvious placeholders (secret, example, changeme, your-…, <…>, {{…}}, env-var
# NAMES). The value must be 24+ chars of base64-ish entropy.
ASSIGN_PATTERN='(api[_-]?key|secret|token|password|passwd|private[_-]?key)["'"'"'` ]*[:=]["'"'"'` ]*[A-Za-z0-9+/]{24,}'
PLACEHOLDER_RE='(secret|example|changeme|your[_-]|placeholder|xxxx|redacted|dummy|sample|<[a-z]|\{\{)'

# Third-party emails (a real-person leak). Allowlist the operator + doc examples.
EMAIL_PATTERN='[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
EMAIL_ALLOW_RE='(intentsolutions\.io|example\.(com|org|net)|noreply|users\.noreply\.github\.com|anthropic\.com)'

# Operator-maintained denylist of real names/paths (GSB brain markers etc.).
DENYLIST_FILE=".scrub-denylist"

hits=0
report() { echo "[scrub-scan] BLOCKED: $1"; echo "$2" | sed 's/^/  /'; hits=$((hits+1)); }

# Build the corpus: added staged lines, or all tracked files' contents (with path
# prefixes so a hit is locatable). Both are filtered through EXCLUDE_RE.
corpus() {
  if [[ "$MODE" == "staged" ]]; then
    # Only ADDED lines (leading '+', not the +++ header), tagged with the file.
    git diff --cached --unified=0 --no-color 2>/dev/null | awk '
      /^\+\+\+ b\// { f=substr($0,7); next }
      /^\+/ && !/^\+\+\+/ { print f ":" substr($0,2) }'
  else
    while IFS= read -r f; do
      [[ -f "$f" ]] || continue
      grep -nH '' "$f" 2>/dev/null
    done < <(git ls-files | grep -vE "$EXCLUDE_RE")
  fi | grep -vE "$EXCLUDE_RE"
}

CORPUS="$(corpus)"

for pat in "${SECRET_PATTERNS[@]}"; do
  if m=$(printf '%s\n' "$CORPUS" | grep -nE "$pat" 2>/dev/null); then
    report "secret pattern /$pat/" "$m"
  fi
done

# High-entropy assignment, minus placeholders.
if m=$(printf '%s\n' "$CORPUS" | grep -niE "$ASSIGN_PATTERN" 2>/dev/null | grep -viE "$PLACEHOLDER_RE"); then
  [[ -n "$m" ]] && report "high-entropy credential assignment" "$m"
fi

# Third-party email addresses.
if m=$(printf '%s\n' "$CORPUS" | grep -noE "$EMAIL_PATTERN" 2>/dev/null | grep -viE "$EMAIL_ALLOW_RE"); then
  [[ -n "$m" ]] && report "third-party email address (possible real-person leak)" "$m"
fi

# Operator denylist (real names / brain-data paths).
if [[ -f "$DENYLIST_FILE" ]]; then
  while IFS= read -r term; do
    [[ -z "$term" || "$term" =~ ^# ]] && continue
    if m=$(printf '%s\n' "$CORPUS" | grep -niF "$term" 2>/dev/null); then
      report "denylisted term '$term' (real name / brain-data marker)" "$m"
    fi
  done < "$DENYLIST_FILE"
fi

if [[ "$hits" -gt 0 ]]; then
  echo "[scrub-scan] $hits pattern(s) matched — commit/CI blocked. Scrub real secrets/PII;"
  echo "[scrub-scan] use synthetic/public-benchmark fixtures. (bypass locally: git commit --no-verify)"
  exit 1
fi
echo "[scrub-scan] PASS ($MODE): no secret/PII patterns matched."
exit 0
