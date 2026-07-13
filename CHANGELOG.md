# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.5] - 2026-07-13

### Changed

- docs(test-audit): add TEST_AUDIT.md from the /audit-tests 7-layer sweep (#11) (b3a3e05)

## [0.0.4] - 2026-07-13

### Added

- feat(judge): ship the Layer-1 governed-judgment loop as `bob judge` (Phase 3, 108 §12) (#10) (8eae903)

## [0.0.3] - 2026-07-13

### Changed

- docs: update the PRIVATE-v0 notices to build-in-public now that the repo is public (#9) (ade8810)

## [0.0.2] - 2026-07-13

### Changed

- chore(deps): repin AGP to the v0.1.100 release (post-extraction clean kernel) (#8) (1693066)

## [0.0.1] - 2026-07-13

### Added

- feat: scaffold intendants — governed background agents (private v0) (4fe69f6)

### Changed

- **BREAKING:** feat(compose)!: own the watcher agent + rename Intendants -> Bob the Intendant (#7) (39d345f)
- chore(deps): bump pinned AGP kernel v0.1.97 -> v0.1.98 (meaningfulness filter) (875f513)

- Composed the extracted governance agent layer from `agent-governance-plane`
  (the GitHub watcher + `bob watch` operator surface) and renamed the product
  Intendants → **Bob the Intendant** (intent-eval-lab `109-AT-DECR`). Dressed the
  repo with the AGP-parity gate chain (claim-scan + `MARKETING_CLAIMS.md`, PII/
  secret scrub gate, `THREAT-MODEL.md`, vendored audit-harness). Repo is PRIVATE
  until the Public-Flip Gate closes; the first public release cuts then.
