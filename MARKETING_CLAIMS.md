# MARKETING_CLAIMS.md — Bob the Intendant claim-control registry

> **This file is enforcement, not prose.** `scripts/claim-scan.sh` reads the
> machine-readable block below as its single source of truth and fails CI on any
> Bob-public surface that uses a banned term. Marketing/security claims are
> **code**: a claim does not exist until it is registered here and backed by a
> shipped primitive. The CISO seat holds veto authority over every entry
> (intent-eval-lab `109-AT-DECR` Q6).

## Why this exists

Security and judgment-quality wording must never outrun shipped primitives. Bob's
public surface is deliberately **strict**: it composes AGP (already stricter than
its CCSC substrate) and adds a *governed judgment* layer whose assurance terms are
the easiest to over-claim. Per `109-AT-DECR` Q6, "a judge that tops out ~55% on
hard grounded calls cannot wear an accuracy claim." Every claim below maps to a
primitive that actually ships at the stated version.

## Allowed claims by version

A claim may appear on a Bob-public surface only if it is listed for the current
version tag (or an earlier one).

| Version | Allowed claim | Backing primitive |
|---------|---------------|-------------------|
| v0 | "signed audit log of every tool call" | Ed25519-signed, hash-chained journal (AGP `journal.ts`, composed) — local authoritative log |
| v0 | "governed judgment for the agent you already run" | Category descriptor / positioning (not an assurance claim). Bob runs a background agent whose every tool call passes AGP's policy gate + signed journal. |

Not yet allowed (register in the SAME PR that ships the enforcing primitive, never
before, per `109-AT-DECR` Q6):

- "every judgment is cited to the brain context it used and recorded on a signed,
  hash-chained journal" — needs the groundedness + ALCE citation primitives shipped
  and verifying (Layer-1 build, `iel-25a.4`).
- "judgment quality is measured against a human-labeled golden set" — a *process*
  claim (never a standing accuracy number); needs the composed eval stack + golden
  set shipped.
- "living, self-improving governed judgment" — a scoped capability claim that fires
  ONLY when the Circle-of-Life loop is live (not a static golden file) and has
  provably closed once through the cross-chain pointer.

## Banned terms (v0)

These assurance terms over-promise relative to what v0 ships (single-operator,
local signed log; a governed *background agent* — **not** a validated-accuracy,
externally-verifiable, or compliance-audited judgment guarantee). They are
forbidden on Bob-public surfaces until a primitive that earns them ships and a
corresponding allowed-claim row is added above.

Two families are banned: the inherited **AGP assurance terms**, and the
**judgment-layer assurance terms** added by `109-AT-DECR` Q6. The scanner consumes
the regex between the markers below. Edit the registry here; do **not** hardcode
the list anywhere else. The ambiguous words (verified/accurate/reliable) are
banned only in proximity to "judgment", so legitimate mechanism copy ("verify the
signed journal", "measured against a golden set") is not tripped.

<!-- CLAIM-SCAN:BANNED-REGEX:V0:START -->
<!-- regex: tamper.?evident|tamper.?proof|non.?repudia[bt]|forensic.?grade|audit.?grade|compliance.?grade|hallucination.?(free|proof)|provably.?correct|accuracy.?guarantee|(reliable|trustworthy|unbiased|accurate|verified)[a-z ,-]{0,24}judgment|judgment[a-z ,-]{0,24}(reliable|trustworthy|unbiased|accurate|verified|guaranteed) -->
<!-- CLAIM-SCAN:BANNED-REGEX:V0:END -->

In human-readable form (zero-width breaks keep this list from tripping the scanner
against this registry itself; the authoritative pattern is the marked regex above):

- Inherited AGP: tamper&#8203;-evident, tamper&#8203;-proof,
  non&#8203;repudiable / non&#8203;repudiation, forensic&#8203;-grade,
  audit&#8203;-grade, compliance&#8203;-grade.
- Judgment layer (`109` Q6): hallucination&#8203;-free / hallucination&#8203;-proof,
  provably&#8203;-correct, accuracy&#8203;-guaranteed, and
  reliable/trustworthy/un&#8203;biased/accurate/verified **judgment** (the
  assurance sense, i.e. any of those words next to "judgment"); "self&#8203;-improving"
  as a standing guarantee (allowed only once the live loop provably closes).

## Scope

`scripts/claim-scan.sh` scans the Bob-public surfaces — `README.md`, `AGENTS.md`,
`CLAUDE.md`, `CONTRIBUTING.md`, `SECURITY.md`, `SUPPORT.md`, `CODE_OF_CONDUCT.md`,
and the `.github/` templates.

**Deliberately out of scope:** this file (`MARKETING_CLAIMS.md`) is the registry
and must enumerate the banned terms, so the scanner does not scan it; and
`000-docs/` planning/audit docs legitimately discuss banned claims while designing
the control.

## Emergency override

Removing a term from the banned list, or shipping a claim ahead of its primitive,
requires explicit operator (Jeremy) approval recorded against a Bead. The CISO
seat may veto any addition regardless (`109-AT-DECR` Q6).
