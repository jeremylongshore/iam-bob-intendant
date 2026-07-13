#!/usr/bin/env bash
# Bob the Intendant pre-commit gates (L1 — local mirror of the CI gates).
#
# Runs the same gates `.github/workflows/ci.yml` enforces, BEFORE the commit
# lands, so a failure surfaces locally instead of on the PR. Bun-native — no
# Node toolchain, no external deps beyond what CI already uses, and every gate
# is an in-repo command (never a ~/.claude path), so enforcement travels with
# the clone.
#
# Wired via a committed hook at `.githooks/pre-commit`. Activate on a fresh clone
# with `git config core.hooksPath .githooks`. Emergency bypass: `git commit
# --no-verify`.
set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 1

fail=0
run () {
  name="$1"; shift
  if out=$("$@" 2>&1); then
    echo "[pre-commit] ✓ $name"
  else
    echo "[pre-commit] ✗ $name"
    echo "$out" | tail -25
    fail=1
  fi
}

run "typecheck"       bun run typecheck
run "lint (biome)"    bunx biome lint src
run "coverage gate"   bash scripts/coverage-gate.sh
run "claim-scan"      bash scripts/claim-scan.sh
run "scrub-scan"      bash scripts/scrub-scan.sh --staged
run "markdownlint"    npx markdownlint-cli2 --config .markdownlint.json "**/*.md" "!node_modules/**" "!**/CHANGELOG.md"
# audit-harness (vendored): hash-pin verify + escape-scan on the staged diff.
# escape-scan excludes .audit-harness/ — the vendored scanner scripts contain the
# very pattern literals they hunt for, so scanning them self-matches (false pos).
run "harness verify"  scripts/audit-harness verify
run "escape-scan"     bash -c 'git diff --cached -- . ":(exclude).audit-harness/**" ":(exclude)tests/features/**" | scripts/audit-harness escape-scan -'

if [ "$fail" -ne 0 ]; then
  echo "[pre-commit] one or more gates failed — commit aborted. (override: git commit --no-verify)"
  exit 1
fi
echo "[pre-commit] all gates passed."
