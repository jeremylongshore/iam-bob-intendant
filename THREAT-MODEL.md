# THREAT-MODEL.md — Bob the Intendant

> **Honest posture, scrubbed of exploit detail.** This document names the real
> attack surfaces so operators reason about them; it deliberately omits
> step-by-step exploitation of any unpatched gap (intent-eval-lab `109-AT-DECR`
> §7 #8). Bob is a **single-operator, local-first** tool at v0. It is **not** a
> multi-party, externally-verifiable, or compliance product — see
> `MARKETING_CLAIMS.md` for the exact claims Bob does and does not make.

## What Bob is (trust boundaries)

Bob is a background agent that runs on a trigger and composes
[`agent-governance-plane`](https://github.com/jeremylongshore/agent-governance-plane)
(AGP) as a pinned dependency. **The governance runtime is AGP's**, not Bob's:
the policy gate, Docker sandbox, Slack human-in-the-loop (HITL) approval, and the
Ed25519-signed, hash-chained journal all live in AGP. Bob owns the trigger-woken
agent, the `bob watch` loop, and (as it ships) the *governed judgment* layer.

The load-bearing boundary is **"the model proposes; the deterministic system
decides and records."** Bob's cognition is untrusted; AGP's gate + journal are the
trusted deciders. Bob's threat model is therefore mostly about **what feeds the
model** and **what the model's output can influence**.

## Primary attack surface — the event → retrieval → judge → journal → golden-set chain

A trigger fires on an **external, attacker-influenceable event** (e.g. a GitHub
release body, an issue title). As the judgment layer ships, that event drives
retrieval over a knowledge brain, and a judge produces a cited rationale that is
journaled and (via the Circle-of-Life loop) can inform a golden set. The honest
risk, named in full (`109-AT-DECR` Q8, CISO):

> prompt-injection into an event can poison retrieval → poison the cited rationale
> → poison the journal record → and, without a commit gate, poison the golden set
> that trains future judgment.

**Standing mitigations (in place today):**

- **Nothing consequential happens un-gated.** Every tool call the agent attempts
  passes AGP's policy gate; a consequential action is `require` + Slack HITL, and
  is default-denied when no human answers (fail-closed).
- **Human commit gate on specs.** A watcher spec without an explicit human commit
  refuses to load; a model may propose, only a human commit is loadable.
- **Reads are governed too.** A failed or unparseable read is a recorded failure
  with zero actions — never a guess.
- **Signed, append-only record.** Every tool call lands in the Ed25519-signed,
  hash-chained journal; the cross-chain causal pointer ties "what it knew" to
  "what it did," reconstructable offline.

**Not-yet-shipped mitigations (gated, by design — the judgment layer is in
progress):**

- **Golden-set promotion requires a human/deterministic commit gate** — no
  production judgment auto-promotes into the trusted golden set from an
  attacker-controllable event (`109` Q4). Until the loop ships, there is no golden
  set to poison.
- The knowledge brain at v0 is a **public benchmark** (HotpotQA/BEIR) or synthetic
  fixtures — **no real personal / Governed-Second-Brain data** (enforced by
  `scripts/scrub-scan.sh`), so the retrieval corpus is not a private-data surface.

## Provider-egress surface

The judgment layer will call one or more **LLM judge providers**. Treat provider
egress as **untrusted**: the retrieved context (and thus any injected content in
it) is sent to a third party, and the provider's response re-enters the pipeline.
Mitigations: pin provider/model versions in provenance; keep the judge panel
free/key-optional so no standing secret is required; screen credentials out of the
signed journal (AGP `credentials.ts` resolves secrets only in the post-gate argv).
No EU-AI-Act or compliance claim is made; Bob *produces* lineage/provenance, it
does not certify it.

## Sandbox & isolation limits (inherited from AGP)

The agent's tool calls execute in AGP's Docker sandbox — **namespace isolation,
not VM-grade**. It reduces blast radius; it is not a hard multi-tenant boundary.
Network egress is off by default and enabled explicitly only for the reads a
watcher needs. See AGP `000-docs/020-AT-THRT` for the sandbox isolation limits.

## Secrets

Secrets (GitHub token, Slack webhook) are injected **post-gate** into the argv and
screened out of the signed journal by construction; an unset required secret fails
closed before the trigger fires. Real secrets never belong in the repo — the
`scrub-scan` pre-commit + CI gate blocks known secret shapes and a denylist of
real brain-data markers.

## Explicitly out of scope at v0

- Multi-tenant isolation (single-operator v0; AGP's tenant gate is present-but-single).
- A hardened public/network transport (AGP's gateway is a Unix domain socket only).
- Any externally-verifiable or compliance-audited assurance — Bob keeps a local
  signed log; it does not offer third-party attestation.

## Reporting

Security reports: **jeremy@intentsolutions.io** (see `SECURITY.md`). Please do not
file public issues for suspected vulnerabilities.
