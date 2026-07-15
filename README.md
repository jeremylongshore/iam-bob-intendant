# iam-bob-intendant — governed operational worker (Intent Agent Model)

> **Intent Agent Model (IAM)** — *not* Identity and Access Management.  
> Bob is the **reference implementation family** for IAM. These repos are different **runtimes** of the same model, not separate products.
>
> | Repo | Runtime | Status |
> |------|---------|--------|
> | [`iam-bob-adk`](https://github.com/jeremylongshore/iam-bob-adk) | Google ADK | Historical V1 |
> | [`iam-bob-pydantic`](https://github.com/jeremylongshore/iam-bob-pydantic) | Pydantic AI + LiteLLM (BYOK, MCP) | Historical V2 |
> | [`iam-bob-langgraph`](https://github.com/jeremylongshore/iam-bob-langgraph) | LangGraph | Reserved (not built) |
> | [`iam-bob-intendant`](https://github.com/jeremylongshore/iam-bob-intendant) | Operational worker (AGP-composed) | Live automation |
>
> **Formerly** `jeremylongshore/bob-the-intendant` (GitHub redirects).

---

## Bob the Intendant — governed judgment for the agent you already run

> **Public v0 — built in public.** The Public-Flip Gate closed (intent-eval-lab
> `109-AT-DECR` §7) and this repo went public with the governed watcher slice + the
> category thesis; the *governed judgment* layer builds here in the open. No npm
> publish yet. This repo is the product front for the
> [`agent-governance-plane`](https://github.com/jeremylongshore/agent-governance-plane)
> (AGP) runtime — it composes AGP as a pinned dependency and owns the
> agent/composition layer.

Bob is a background agent that runs on a trigger, keeps state so it isn't noisy,
and — crucially — **only acts through a policy gate, with human approval on
anything risky, and a signed audit log of every tool call.** Local-first,
one-command install.

## What ships today

Describe an agent in a committed spec; it runs on a schedule or event; every tool
call it attempts passes AGP's governance loop before anything happens:

```text
trigger → policy gate → (if risky) human approval → sandboxed exec → signed journal
```

The governance itself lives in **AGP** (the kernel: policy engine, Docker sandbox,
Slack HITL, Ed25519-signed hash-chained journal). Bob owns the trigger-woken
GitHub watcher, the `watch` loop, the agent templates, and the installer, and
drives them through AGP's daemon. That boundary is deliberate — *the model
proposes; the deterministic system decides and records.*

**Direction (not yet shipped):** the *governed judgment* layer — judgment
grounded in a knowledge brain, cited to the context it used, and measured against
a labeled set — is in progress (Layers 1+2, intent-eval-lab `108-AT-ARCH` /
`109-AT-DECR`, built Layer-1-first). This README describes only what runs today;
the judgment layer is labeled experimental until it ships.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/jeremylongshore/iam-bob-intendant/main/scripts/install.sh | bash
```

(While private, clone + `bun install` instead — see `scripts/install.sh`.)

## Use

```bash
bob doctor                   # fail-closed prerequisite check
bob init && bob keygen       # scaffold ~/.agp + mint the signing key
# author a spec (templates/github-watcher/), add a humanCommit block, enable it
bob watch run    --spec <spec>   # one governed tick
bob watch status --spec <spec>   # liveness dead-man's-switch (exit 1 = stale)
bob verify                   # offline-verify the signed audit journal
```

### Delivery modes (a human-committed choice)

- **`issue`** — files a GitHub issue, gated by a `require` verdict + Slack human approval.
- **`notify`** — posts a batched summary to a webhook; no GitHub write, no approval needed (cron-safe).

Reference agent + its test pack: [`templates/github-watcher/`](templates/github-watcher/).

## The deploy rule

```text
Prompt → Spec → Tests → Policy → Deploy
```

A spec refuses to load without a human commit; every template ships its own test
pack (unit · **policy** · **state** · acceptance), run in CI against the pinned
AGP kernel; the policy gate stands between a proposal and any consequential action.

## Architecture

Bob → **AGP** (pinned dependency). Leaf-on-kernel; never the reverse. The six
frozen AGP contracts + `trigger-source` are imported, not forked; Bob owns
`src/triggers/` + `src/cli/commands/watch.ts`. See AGP `000-docs/059-AT-ADR`
(the extraction) and `057-AT-ADR` (the plan).

## License

Apache-2.0. Composes AGP (Apache-2.0) — see `NOTICE`.
