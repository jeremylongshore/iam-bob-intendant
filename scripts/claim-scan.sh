#!/usr/bin/env bash
# scripts/claim-scan.sh — banned-claim hygiene check for Bob-public surfaces.
#
# Part of Epic 11 ("AGP claim-control enforcement"). The banned-term regex is NOT
# defined here — it is sourced from the MARKETING_CLAIMS.md registry (council Q4:
# claims-as-code, single source of truth). This script is the enforcement; the
# registry is the policy.
#
# What it does:
#   Greps the Bob-public surfaces (README, AGENTS, CLAUDE, CONTRIBUTING, SECURITY,
#   SUPPORT, .github/) for security claims that are NOT allowed at the current
#   version, using the banned-term regex read from MARKETING_CLAIMS.md.
#
#   `--commits <range>` instead scans the SUBJECT lines of commits in a git range.
#   The CHANGELOG / release notes are auto-generated from commit subjects, so this
#   catches a banned claim at its source before it can reach the release notes
#   (which are otherwise out of scope here as a generated artifact).
#
# What it deliberately DOES NOT scan:
#   - 000-docs/ — these are internal planning + audit + review docs. They legitimately
#     DISCUSS what claims are banned (e.g. "we will NOT claim tamper-evident") which
#     would false-positive on a naive scan. Epic 11's MARKETING_CLAIMS.md will handle
#     internal-doc tagging once it lands.
#   - Foundation council docs (006/007/008/009 or their AGP-renumbered 001-004
#     versions) — same reason.
#
# Allowed at v0: "signed audit log of every tool call" (and equivalents).
# Banned at v0: tamper-evident, tamper-proof, nonrepudiable, forensic-grade,
#               audit-grade, compliance-grade.
#
# Exit codes:
#   0 = no banned claims found in scanned surfaces
#   1 = banned claim(s) detected — PR blocked

set -euo pipefail

# Optional commit-subject mode: scan the release-notes source (commit subjects)
# rather than the public-surface files.
MODE="files"
RANGE=""
if [[ "${1:-}" == "--commits" ]]; then
  MODE="commits"
  RANGE="${2:-}"
  if [[ -z "$RANGE" ]]; then
    echo "[claim-scan] --commits requires a git range (e.g. origin/main...HEAD)"
    exit 1
  fi
fi

# Source the banned-term regex from the registry — the single source of truth.
# Fail closed: a missing/malformed registry must NOT let banned claims through.
REGISTRY="MARKETING_CLAIMS.md"
if [[ ! -f "$REGISTRY" ]]; then
  echo "[claim-scan] BLOCKED: $REGISTRY not found — the banned-claim registry is the source of truth."
  exit 1
fi
BANNED_PATTERNS=$(sed -n '/CLAIM-SCAN:BANNED-REGEX:V0:START/,/CLAIM-SCAN:BANNED-REGEX:V0:END/p' "$REGISTRY" \
  | sed -nE 's/^<!-- regex: (.*) -->$/\1/p')
if [[ -z "$BANNED_PATTERNS" ]]; then
  echo "[claim-scan] BLOCKED: could not read the banned-claim regex from $REGISTRY"
  echo "[claim-scan] Expected a '<!-- regex: ... -->' line between the CLAIM-SCAN:BANNED-REGEX:V0 markers."
  exit 1
fi

# Commit-subject mode: the release-notes source. Fail closed on a banned claim.
if [[ "$MODE" == "commits" ]]; then
  echo "[claim-scan] Scanning commit subjects in '$RANGE' for v0-banned claims..."
  echo "[claim-scan] Banned patterns: $BANNED_PATTERNS"
  subjects=$(git log "$RANGE" --no-merges --format='%s' 2>/dev/null || true)
  if [[ -n "$subjects" ]] && hits=$(echo "$subjects" | grep -nE "$BANNED_PATTERNS" 2>/dev/null); then
    echo "[claim-scan] BLOCKED: commit subject(s) contain v0-banned claims (would reach the release notes):"
    echo "$hits" | sed 's/^/  /'
    exit 1
  fi
  echo "[claim-scan] PASS: no v0-banned claims in commit subjects."
  exit 0
fi

SURFACES=(
  README.md
  AGENTS.md
  CLAUDE.md
  CONTRIBUTING.md
  SECURITY.md
  SUPPORT.md
  CODE_OF_CONDUCT.md
)

# Also scan top-level .github/ files (PR template, issue templates, FUNDING, etc.)
mapfile -t GH_FILES < <(find .github -type f \( -name '*.md' -o -name '*.yml' \) 2>/dev/null || true)

ALL_FILES=("${SURFACES[@]}" "${GH_FILES[@]}")

violations=0
echo "[claim-scan] Scanning ${#ALL_FILES[@]} public-surface files for v0-banned claims..."
echo "[claim-scan] Banned patterns: $BANNED_PATTERNS"
echo "[claim-scan] Scope: Bob-public surfaces (README/AGENTS/CLAUDE/etc. + .github/)"
echo "[claim-scan] Out of scope: 000-docs/ (internal planning); CHANGELOG (auto-generated)"
echo

for f in "${ALL_FILES[@]}"; do
  if [[ -f "$f" ]]; then
    if matches=$(grep -nE "$BANNED_PATTERNS" "$f" 2>/dev/null); then
      echo "FAIL: $f"
      echo "$matches" | sed 's/^/  /'
      echo
      violations=$((violations + 1))
    fi
  fi
done

if [[ $violations -gt 0 ]]; then
  echo "[claim-scan] BLOCKED: $violations file(s) contain v0-banned claims."
  echo "[claim-scan] Allowed v0 claim: \"signed audit log of every tool call\""
  echo "[claim-scan] See intent-eval-lab 109-AT-DECR Q6 for the full claim-control rationale."
  exit 1
fi

echo "[claim-scan] PASS: no v0-banned claims found on public surfaces."
exit 0
