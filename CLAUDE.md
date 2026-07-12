# CLAUDE.md

Guidance for Claude Code working in the **intendants** repo.

## What this is

Intendants is the **product front** for governed background agents. It composes
[`agent-governance-plane`](https://github.com/jeremylongshore/agent-governance-plane)
(AGP) as a **pinned git dependency** (`agp` in `package.json`, `#v0.1.x`) and owns
the operator surface: the `intendants` CLI (`src/index.ts`, a thin dispatch to
AGP's command functions), the agent `templates/`, and `scripts/install.sh`.

The governance runtime lives in AGP, not here: policy gate → Slack HITL → Docker
sandbox → signed hash-chained audit journal. **Do not fork or vendor AGP's
kernel** — import it (`agp/src/...`). The six frozen contracts + `trigger-source`
belong to AGP; a change to any is a Bead + ADR **in AGP**, not here.

- **Bun toolchain** — `bun install`, `bun run typecheck`, `bun test`. Not Node/npm.
- **PRIVATE v0.** No public surface, no npm publish, no marketing claims until
  Jeremy opens those doors (intent-os `030-AT-DECR`; the extraction plan is AGP
  `000-docs/057-AT-ADR`). Public surfaces may make exactly one security claim:
  "signed audit log of every tool call" — no stronger assurance terms.
- **Beads prefix:** work is tracked under the AGP epic `agp-eva` (bead
  `agp-eva.1.8` = this extraction). Mirror to GitHub issues per the three-layer rule.

## Build & test

```bash
bun install          # fetches the pinned AGP kernel
bun run typecheck    # strict tsc --noEmit
bun test             # template packs run against the pinned AGP dependency
```

## Conventions

- Commits `<type>(<scope>): <subject>` + a body carrying WHAT / WHY (+ one-line
  "chose X over Y because Z") / HOW-verified. Branches `feat/`, `fix/`, `docs/`.
- To bump the AGP dependency: change the `#v0.1.x` tag pin, `bun install`,
  re-run typecheck + test, note the bump in the commit.
