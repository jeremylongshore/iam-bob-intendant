# Contributing to Bob the Intendant

Thank you for your interest in contributing to **Bob the Intendant**! This guide will help you get started.

Bob is the product front that composes [`agent-governance-plane`](https://github.com/jeremylongshore/agent-governance-plane)
(AGP) as a **pinned dependency** and owns the agent/composition layer (the GitHub
watcher, the `bob watch` CLI, and the agent templates). The governance runtime —
policy gate, Docker sandbox, Slack human-in-the-loop, and the signed hash-chained
audit journal — lives in **AGP**, not here. Bob is a leaf on the AGP kernel: **do
not fork or vendor AGP** — import it (`agp/src/...`). Changes to AGP's six frozen
contracts or governance kernel are a Bead + ADR **in AGP**, not in this repo.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) (this is a Bun + TypeScript repo — **not** Node/npm)
- Git
- GitHub account

### Development Setup

```bash
# Clone the repository
git clone https://github.com/jeremylongshore/bob-the-intendant.git
cd bob-the-intendant

# Install dependencies (fetches the pinned AGP kernel)
bun install

# Verify the toolchain
bun run typecheck
bun test
```

## How to Contribute

### Reporting Bugs

1. Search [existing issues](https://github.com/jeremylongshore/bob-the-intendant/issues) first
2. Open a [bug report](https://github.com/jeremylongshore/bob-the-intendant/issues/new?template=bug_report.md)
3. Include reproduction steps, expected vs actual behavior, and environment details (paste `bob doctor` output)

### Suggesting Enhancements

1. Check [existing feature requests](https://github.com/jeremylongshore/bob-the-intendant/issues?q=label%3Aenhancement)
2. Open a [feature request](https://github.com/jeremylongshore/bob-the-intendant/issues/new?template=feature_request.md)

### Pull Requests

1. Fork the repository
2. Create a feature branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. Make your changes
4. Write or update tests
5. Ensure `bun run typecheck` and `bun test` both pass
6. Commit with [conventional commit messages](#commit-messages)
7. Push and open a pull request

## Development Process

### Branch Strategy

| Branch | Purpose |
|--------|---------|
| `main` | Production-ready code |
| `feature/*` | New features |
| `fix/*` | Bug fixes |
| `docs/*` | Documentation changes |

### Testing

This is a **Bun** repo. Run the gates before submitting a PR:

```bash
bun run typecheck    # strict tsc --noEmit
bun test             # watcher tests + template packs against the pinned AGP kernel
```

Every agent template under `templates/<name>/` ships its own test pack
(unit · policy · state · acceptance); the default `bun test` runs those packs, so
CI gates them.

### Code Review

- All PRs require at least 1 maintainer approval
- CI must pass (typecheck + tests + claim-scan)
- Keep PRs focused — one feature or fix per PR
- Do not weaken a gate or loosen a hash-pinned surface to make a PR pass

## Style Guides

### Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

[optional body]
[optional footer]
```

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `ci`

**Examples:**
- `feat(watch): add liveness dead-man's-switch to bob watch status`
- `fix(github-watcher): handle empty poll result gracefully`
- `docs(readme): clarify the AGP composition boundary`

The commit body should carry WHAT changed, WHY (one line "chose X over Y because
Z" when a real alternative existed), and HOW it was verified.

### Bumping the AGP Dependency

The `agp` dependency is pinned by commit in `package.json`. To bump it: change the
pin, run `bun install`, re-run `bun run typecheck` + `bun test`, and note the bump
in the commit body.

### Code Style

- Follow the project's existing conventions
- Run `bun run typecheck` (and the linter, if configured) before committing
- Write clear, self-documenting code
- Add comments only where logic isn't obvious

## Community

- **Questions**: [GitHub Discussions](https://github.com/jeremylongshore/bob-the-intendant/discussions)
- **Bugs**: [Issue Tracker](https://github.com/jeremylongshore/bob-the-intendant/issues)
- **Email**: jeremy@intentsolutions.io

## License

By contributing, you agree that your contributions will be licensed under the
project's [Apache-2.0 License](LICENSE).

---

*Thank you for helping improve Bob the Intendant!*
