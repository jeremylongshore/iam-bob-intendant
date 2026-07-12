# Intendants — governed background agents

> **PRIVATE v0.** No public surface until the extraction gate's remaining doors are opened deliberately (intent-os `030-AT-DECR`). This repo is the product front for the [`agent-governance-plane`](https://github.com/jeremylongshore/agent-governance-plane) (AGP) runtime — it composes AGP as a pinned dependency and owns the operator surface.

A background agent that runs on a trigger, keeps state so it isn't noisy, and — crucially — **only acts through a policy gate, with human approval on anything risky, and a signed audit log of every tool call.** Local-first, one-command install.

## What it is

Describe an agent in a committed spec; it runs on a schedule or event; every tool call it attempts passes AGP's governance loop before anything happens:

```text
trigger → policy gate → (if risky) human approval → sandboxed exec → signed journal
```

The governance itself lives in **AGP** (the kernel: policy engine, Docker sandbox, Slack HITL, Ed25519-signed hash-chained journal). Intendants adds the `watch` loop, the agent templates, and the installer. That boundary is deliberate — *the model proposes; the deterministic system decides and records.*

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/jeremylongshore/intendants/main/scripts/install.sh | bash
```

(While private, clone + `bun install` instead — see `scripts/install.sh`.)

## Use

```bash
intendants doctor                      # fail-closed prerequisite check
intendants init && intendants keygen   # scaffold ~/.agp + mint the signing key
# author a spec (templates/github-watcher/), add a humanCommit block, enable it
intendants watch run    --spec <spec>  # one governed tick
intendants watch status --spec <spec>  # liveness dead-man's-switch (exit 1 = stale)
intendants verify                      # offline-verify the signed audit journal
```

### Delivery modes (a human-committed choice)

- **`issue`** — files a GitHub issue, gated by a `require` verdict + Slack human approval.
- **`notify`** — posts a batched summary to a webhook; no GitHub write, no approval needed (cron-safe).

Reference agent + its test pack: [`templates/github-watcher/`](templates/github-watcher/).

## The deploy rule

```text
Prompt → Spec → Tests → Policy → Deploy
```

A spec refuses to load without a human commit; every template ships its own test pack (unit · **policy** · **state** · acceptance), run in CI against the pinned AGP kernel; the policy gate stands between a proposal and any consequential action.

## Architecture

Intendants → **AGP** (pinned git dependency, `#v0.1.97`). Leaf-on-kernel; never the reverse. The six frozen AGP contracts + `trigger-source` are imported, not forked. See AGP `000-docs/057-AT-ADR`.

## License

Apache-2.0. Composes AGP (Apache-2.0) — see `NOTICE`.
