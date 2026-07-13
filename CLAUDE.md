# CLAUDE.md

Guidance for Claude Code working in the **bob-the-intendant** repo.

## What this is

**Bob the Intendant** is the product front for governed background agents — and
the home for the *governed judgment* layer (in progress, intent-eval-lab
`108-AT-ARCH` / `109-AT-DECR`). It composes
[`agent-governance-plane`](https://github.com/jeremylongshore/agent-governance-plane)
(AGP) as a **pinned dependency** (`agp` in `package.json`) and **owns the
agent/composition layer**:

- `src/triggers/github-watcher/` — the trigger-woken GitHub watcher agent.
- `src/cli/commands/watch.ts` — the `bob watch run/status/enable` operator surface.
- `templates/<name>/` — per-agent template test packs.
- `scripts/install.sh` — the one-command installer.

The `bob` CLI (`src/index.ts`) dispatches `init/keygen/doctor/verify` to AGP and
drives the local watcher through AGP's daemon (`runMediated`).

The governance runtime lives in AGP, not here: policy gate → Slack HITL → Docker
sandbox → signed hash-chained audit journal. **Do not fork or vendor AGP's
kernel** — import it (`agp/src/...`). The six frozen contracts + `trigger-source`
belong to AGP; a change to any is a Bead + ADR **in AGP**, not here. Bob is a leaf
on the kernel; the dependency edge points one way (Bob → AGP), never the reverse.

- **Bun toolchain** — `bun install`, `bun run typecheck`, `bun test`. Not Node/npm.
- **PRIVATE v0.** No public surface until the **Public-Flip Gate** is green
  (intent-eval-lab `109-AT-DECR` §7: frozen cross-chain contract signed-in,
  runnable slice + bundled public-benchmark brain, PII/secret scrub gate, in-repo
  claim-control, signing/npm provisioned, trademark clearance + fallback,
  supersession recorded, honest THREAT-MODEL). Extraction: AGP `000-docs/059-AT-ADR`.
- **Claim discipline (109 Q6, CISO veto).** Public surfaces carry only the allowed
  mechanism claims registered in `MARKETING_CLAIMS.md` — at v0, "signed audit log of
  every tool call" and the "governed judgment" category descriptor. The judgment-layer
  assurance terms (plus all inherited AGP bans) are **banned**; the exact denylist
  regex is the machine-readable block in `MARKETING_CLAIMS.md` (the single source of
  truth), enforced by `scripts/claim-scan.sh` as a HARD gate. This file is itself
  claim-scanned, so **describe the rule rather than quoting the banned words**; read
  the registry before writing any security/judgment copy, and register each claim in
  the same PR that ships its enforcing primitive.
- **Zero real GSB / personal data on any public surface** — public-benchmark
  (HotpotQA/BEIR) or synthetic fixtures only; no real partner/client name without
  prior written consent (109 Q9 GC bind).
- **Beads:** Slice-0 extraction under AGP epic `agp-eva.1` (`agp-eva.1.9`); the
  governed-judgment build under intent-eval-lab epic `iel-25a`. Mirror to GitHub
  issues per the three-layer rule.

## Build & test

```bash
bun install          # fetches the pinned AGP kernel
bun run typecheck    # strict tsc --noEmit
bun test             # watcher tests + template packs run against the pinned AGP dependency
```

## Conventions

- Commits `<type>(<scope>): <subject>` + a body carrying WHAT / WHY (+ one-line
  "chose X over Y because Z") / HOW-verified. Branches `feature/`, `fix/`, `docs/`.
- To bump the AGP dependency: change the `agp` pin in `package.json`, `bun install`,
  re-run typecheck + test, note the bump in the commit.
