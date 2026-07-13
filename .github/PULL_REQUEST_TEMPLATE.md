<!--
Bob the Intendant PR template — enforces the three-layer mirror discipline
(Bead ↔ GitHub Issue ↔ Docs). Every PR references its Bead ID, its GitHub issue,
the docs it touches, and the validation it ran. See CLAUDE.md (§ Beads) for the
full rule. Bob composes agent-governance-plane (AGP) as a pinned dependency —
changes to AGP's frozen contracts or governance kernel belong in AGP, not here.
-->

## Summary

<!-- 1-3 bullet points -->

-
-
-

## Mirror discipline (required)

- **Refs:** #<parent-epic-issue-number>
- **Closes:** #<this-issue-number>  <!-- if this PR retires a tracked issue -->
- **Bead:** `<actual bd ID, e.g. agp-eva.1.9>` <!-- get from `bd list` or `bd show` — do NOT invent -->
- **Docs touched:** <!-- list every file under 000-docs/, README.md, MARKETING_CLAIMS.md, .github/ etc. -->
  -

## Test plan

<!-- Each unchecked box blocks merge. Reviewers check the box only after seeing the evidence. -->

- [ ] `bun run typecheck` passes (strict `tsc --noEmit`)
- [ ] `bun test` passes (watcher tests + template packs against the pinned AGP kernel)
- [ ] `bash scripts/claim-scan.sh` exits 0 (no v0-banned claims on public surfaces)
- [ ] `bash scripts/coverage-gate.sh` passes (aggregate coverage floor)
- [ ] AGP dependency pin unchanged, OR the bump is noted below with re-verified typecheck + test
- [ ] Markdown renders correctly on GitHub (preview the diff)

## Claim impact

<!--
Required. State explicitly:
- "No new marketing/security claims introduced." OR
- "Adds claim 'X' — registered in MARKETING_CLAIMS.md in this PR." OR
- "Removes implicit claim 'Y' — see commit body for the removal trace."

Public surfaces may make exactly ONE security claim: "signed audit log of every
tool call." Every PR answers this.
-->

## Closure evidence (filled by author at merge time)

- PR #:
- Merge commit SHA:
- Validation output:

## Notes

<!-- Anything reviewers should know. Cross-PR dependencies, rebase order, follow-up beads filed for accepted gaps. -->

---

<!--
Footer is auto-applied by Claude Code attribution settings on commits and PR descriptions.
For issue/comment/review bodies (which are NOT covered by attribution), authors must manually append:

  - Jeremy Longshore
  intentsolutions.io
-->
