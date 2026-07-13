# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
