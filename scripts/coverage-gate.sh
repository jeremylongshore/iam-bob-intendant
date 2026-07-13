#!/usr/bin/env bash
# Aggregate coverage gate (added per /audit-tests 2026-06-03 — TEST_AUDIT.md).
#
# Runs the suite with coverage and fails if the PROJECT-TOTAL line/function
# coverage drops below the floor. We gate the aggregate (the "All files" row),
# not per-file: Bun's built-in `coverageThreshold` is per-file, which trips on
# the deliberately gated real-environment paths (runner.ts / bun-claude-process
# live spawn) that can't run in CI by design.
#
# Floors sit just under the CI-measured numbers (~93% lines / ~92% funcs on Bob (watcher + template packs); measured at
# the composition). Raise them as gated paths gain in-CI coverage; never lower them to
# dodge a regression.
set -uo pipefail

LINES_FLOOR=${LINES_FLOOR:-90}
FUNCS_FLOOR=${FUNCS_FLOOR:-88}

out=$(bun test --coverage 2>&1)
rc=$?
echo "$out"
if [ "$rc" -ne 0 ]; then
  echo "[coverage-gate] test run failed (exit $rc) — gate not evaluated."
  exit "$rc"
fi

allfiles=$(echo "$out" | grep -E '^ ?All files' | tail -1)
if [ -z "$allfiles" ]; then
  echo "[coverage-gate] could not find the 'All files' summary row — failing closed."
  exit 1
fi

funcs=$(echo "$allfiles" | awk -F'|' '{gsub(/ /,"",$2); print $2}')
lines=$(echo "$allfiles" | awk -F'|' '{gsub(/ /,"",$3); print $3}')

echo "[coverage-gate] aggregate: functions=${funcs}% (floor ${FUNCS_FLOOR}%), lines=${lines}% (floor ${LINES_FLOOR}%)"

awk -v f="$funcs" -v fl="$FUNCS_FLOOR" -v l="$lines" -v ll="$LINES_FLOOR" 'BEGIN{
  bad=0
  if (f+0 < fl+0) { print "[coverage-gate] FAIL: function coverage " f "% < floor " fl "%"; bad=1 }
  if (l+0 < ll+0) { print "[coverage-gate] FAIL: line coverage " l "% < floor " ll "%"; bad=1 }
  if (bad) exit 1
  print "[coverage-gate] PASS"
}'
