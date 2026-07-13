---
title: "ADR — Rename Intendants → Bob the Intendant + public-flip timing override"
date: 2026-07-12
author: Jeremy Longshore
type: Architecture Decision Record (ADR)
stability: INTERNAL — unstable — no public RFC
status: Accepted
governed-by: intent-eval-lab 109-AT-DECR (ISEDC governed-judgment ruling — Q9 rename + the Public-Flip Gate §7)
amends-timing-of: intent-os 030-AT-DECR (D2 extraction gate, D3 dark-until-green) · AGP 001-AT-DECR (no public surface until defensible)
composes: AGP 000-docs/059-AT-ADR (the extraction) · 057-AT-ADR (the extraction plan)
---

# ADR — Rename Intendants → Bob the Intendant + public-flip timing override

> **Status: Accepted (2026-07-12).** This is the Bob-side record of two decisions
> ratified in intent-eval-lab `109-AT-DECR`: (1) the product rename, and (2)
> bringing the public-flip *timing* forward. It is the "record equals artifact"
> instrument the council's GC required — filed so a future reader who meets both
> `030-AT-DECR` (dark) and this repo (public) inherits a coherent supersession
> chain, not a self-contradicting record. **This ADR does not itself flip the
> repo public** — the flip is the one-way door, gated on §"Public-Flip Gate" below.

## Context

This repo was reserved as **private `jeremylongshore/intendants`** — the extraction
target for the composition plane (intent-os `030-AT-DECR` D2), to flip public only
at the five-condition extraction gate, and to stay "dark until green" (D3). Two of
Jeremy's course-corrections, ratified by the 7-seat ISEDC council in
`109-AT-DECR`, change that:

1. **Rename (Q9).** Intendants → **Bob the Intendant**; repo `intendants` →
   `bob-the-intendant`. Bob is the flagship hero product; "governed judgment" is
   the category; "Evidence-Bench" is the authorship artifact — never conflated.
   The council bound this as the **last rename — no third flip**.
2. **Build-in-public / OSS-first (Q2), timing brought forward.** The demo/eval
   brain will be a **public benchmark** (HotpotQA / a BEIR subset, CC-BY-SA), not
   real Governed-Second-Brain data. That removes the council's #1 one-way-door
   risk — third-party personal data written to immutable public git history — so
   the *timing* locks of `030`-D3 (dark-until-green) and AGP `001` (no public
   surface until defensible) are **superseded** (timing only; every other red line
   carries over intact).

## Decision

### 1. Rename (wordmark-only)

- Product/repo: **`jeremylongshore/bob-the-intendant`**; npm scope
  `@intentsolutions/bob-the-intendant`; CLI `bob`.
- **Unchanged:** the frozen AGP `intendant-adapter` / `intendant-manifest`
  contracts, the `src/intendants/` layer, and the `~/.agp/intendants/` identity
  path — the rename touches marketing/repo/wordmark **only** (109 Q9(a); the
  "intendant" adapter vocabulary of intent-os `030`-D1 / AGP `038-AT-ADR` stands).
- Public release train starts at **v0.x**, never "v3".

### 2. Public-flip timing override

The public flip is brought forward from `030`-D2/D3's dark-until-green timing.
This is **Jeremy's recorded decision** (delegated-authority ratification in
`109-AT-DECR`), justified by the public-benchmark brain making the personal-data
one-way-door **moot**. It supersedes only the *timing*; the safety conditions do
not relax — they **rise** (below).

## The Public-Flip Gate (109-AT-DECR §7) — status at this ADR

The repo flips private→public only when ALL eight are green. Status:

| # | Condition | Status |
|---|---|---|
| 1 | Frozen cross-chain contract, **signed-in** (Ed25519 over the journal entry) | ✅ landed in AGP (`058-AT-ADR`, `#127`); Bob pins the AGP commit that has it |
| 2 | Runnable Layer-1 slice + bundled **public-benchmark** brain (stranger reproduces, zero Jeremy data) | ◑ watcher slice runs; the benchmark brain + judgment loop are Phases 1–3 |
| 3 | PII/secret **scrub gate** live (pre-commit + CI) before the first public commit | ☐ ships in repo-dress (Public-Flip Gate prep) |
| 4 | Claim-control in-repo: `MARKETING_CLAIMS.md` + `claim-scan` (AGP denylist + judgment-layer banned terms) | ☐ ships in repo-dress |
| 5 | Signing trust root + npm scope provisioned; predicate URIs at `evals.` only | ◑ npm scope reserved; signing = per-install Ed25519 |
| 6 | **Trademark clearance + designated fallback recorded** on "Bob the Intendant" | ☐ **Jeremy — legal prerequisite, not an engineering step** |
| 7 | Supersession recorded (this ADR + the `030`-D1/D3 amendment notes) | ◑ this ADR filed; `030` amendment note pending |
| 8 | Honest `THREAT-MODEL.md` (names the event→retrieval→judge injection + provider-egress paths; scrubbed of unpatched-hole detail) | ☐ ships in repo-dress |

**Until all eight are green, this repo stays private.** The public flip is a
separate, explicit action taken only after conditions #3/#4/#6/#7/#8 close.

## Carried-over red lines (NOT relaxed by the timing override)

- **Zero real GSB / personal data on any public surface** — public-benchmark or
  synthetic fixtures only; no real partner/client name as nugget/example/endorser
  without prior written consent (109 Q9(c), GC bind).
- **Claim discipline (109 Q6, CISO veto):** only the allowed mechanism claims;
  the judgment-layer banned terms extend the AGP denylist; each claim registers in
  the PR that ships its enforcing primitive.
- **No public spec/RFC/conformance profile at v0** (Q5 lock stands; a paper on the
  composed method is allowed, deferred until Layer-1 has real data).
- **The holstered Rhys reply does not auto-fire; no partner named as endorser.**

## Consequences

- The repo is renamed and rebranded (`bob`, `@intentsolutions/bob-the-intendant`);
  the composition (Bob → AGP pinned dependency) is green (PR that ships this ADR).
- The flip becomes a small, deliberate step behind an explicit gate rather than an
  ambiguous "when ready" — with the irreversible personal-data risk designed out.

## References

- Authority: intent-eval-lab `109-AT-DECR` (Q9 rename; §7 Public-Flip Gate) · `108-AT-ARCH`
- Timing amended: intent-os `030-AT-DECR` (D2 gate, D3 dark-until-green) · AGP `001-AT-DECR`
- Extraction: AGP `000-docs/059-AT-ADR` (executed) · `057-AT-ADR` (plan)
- Naming vocabulary (unchanged): intent-os `030`-D1 · AGP `038-AT-ADR`
- Beads: `agp-eva.1.9` (extraction) · epic `iel-25a` (governed-judgment build)
