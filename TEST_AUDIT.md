# TEST_AUDIT.md — bob-the-intendant

> Diagnostic produced by `/audit-tests` (7-layer + gate sweep). Date: 2026-07-13.
> Scope: the composition product front for AGP — the `bob` CLI + the governed
> watcher + the Layer-1 governed-judgment loop (`bob judge`). Composes
> `agent-governance-plane` as a pinned dependency (Bun/TS).

## Grade: A− (90/100)

Strong, gated posture: 59 colocated tests green, aggregate coverage above the
policy floor, and the full hard-gate chain enforced in CI **and** a local
pre-commit mirror. Held below A by two structural nice-to-haves (a formal
`tests/RTM.md` traceability doc and a `.dependency-cruiser` layering config), both
low-value for a small composition repo whose layering invariant is already
Greptile-enforced (leaf → AGP dep, never fork).

## Classification

**CLI + composition-library.** Bob owns the agent/composition layer (the GitHub
watcher, `bob watch`, the judgment loop `bob judge`, templates) and composes AGP
(the governance kernel) as a pinned dependency. Governance (policy gate → HITL →
signed journal) lives in AGP; only retrieval/eval cross the boundary.

## 7-layer presence / config / enforcement

| Layer | State | Evidence |
|---|---|---|
| L1 — git hooks & CI | ✅ HARD | `.githooks/pre-commit` (activate: `git config core.hooksPath .githooks`) + 7 CI jobs (`.github/workflows/ci.yml`) |
| L2 — static / lint / types | ✅ HARD | strict `tsc --noEmit`, Biome (`biome.json`), `claim-scan` (MARKETING_CLAIMS denylist), `scrub-scan` (PII/secrets), `bun audit --production` |
| L3 — unit & function | ✅ HARD | 59 colocated `*.test.ts` across 12 files; aggregate coverage gate (`scripts/coverage-gate.sh`, floors lines≥90 / funcs≥88) |
| L4 — integration | ✅ | the watcher + judgment loop exercised against the real pinned AGP daemon/journal; the injectable-source loop tests are hermetic integration of the governance path |
| L5 — system quality | ◑ off-CI by design | the live Docker sandbox (`AGP_SANDBOX=docker`) + Slack HITL (`AGP_CHANNEL=slack`) legs are env-gated out of CI (honest, non-VM boundary noted in THREAT-MODEL) |
| L6 — E2E / acceptance packs | ✅ | `templates/github-watcher/tests/{unit,policy,state,acceptance}.test.ts` run under the default `bun test` |
| L7 — acceptance / business | ✅ | the 108 §12 governed-judgment acceptance proven end-to-end (reproducible in `scratchpad/phase3-bench-demo/`); the `bob judge` hermetic tests assert grounded+cited, cross-chain pointer, dedup, separate columns |

## Deterministic gates

| Gate | Result |
|---|---|
| coverage (aggregate) | PASS — funcs 93.30% (floor 88), lines 94.05% (floor 90) |
| Biome lint | PASS (clean over `src/`) |
| claim-scan (public surfaces) | PASS (only the allowed mechanism claims) |
| scrub-scan (PII / secrets) | PASS |
| audit-harness verify (hash-pin) | OK |
| escape-scan (staged diff) | REFUSE=0 CHALLENGE=0 FLAG=0 |
| markdownlint | 0 errors |
| audit-harness `arch` | not-configured (0 violations — no `.dependency-cruiser` in this small composition repo) |
| audit-harness `bias` | n/a — Bob uses colocated `*.test.ts`, not a `tests/` dir (bias-count expects a test directory) |
| audit-harness `crap` | PASS |

## Gaps

**P0:** none. **P1:** none.

**P2 (logged only):**
- No `tests/RTM.md` / `PERSONAS.md` / `JOURNEYS.md` traceability docs (the parent
  AGP repo carries the shared trace surface; Bob's requirements are the composition
  invariants, enforced by tests + Greptile rules).
- No `.dependency-cruiser.cjs` layering config; the leaf-must-not-fork-AGP invariant
  is enforced by the `.greptile/` rules + review, not a deterministic arch gate.

## Handoff

**None needed** — no P0/P1 gaps; the hard-gate chain is fully enforced.
