#!/usr/bin/env bash
# One-command install for the `intendants` CLI. Idempotent + fail-closed: it never
# clobbers an existing signing key or config, and it refuses rather than half-
# installs on a missing prerequisite. Intendants composes agent-governance-plane
# (AGP) as a pinned dependency — `bun install` fetches it automatically.
#
#   curl -fsSL https://raw.githubusercontent.com/jeremylongshore/intendants/main/scripts/install.sh | bash
#
# or, from a clone:   bash scripts/install.sh

set -euo pipefail

REPO_URL="https://github.com/jeremylongshore/intendants.git"
CLONE_DIR="${INTENDANTS_INSTALL_DIR:-$HOME/000-projects/intendants}"
BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; YEL=$'\033[33m'; RED=$'\033[31m'; RST=$'\033[0m'
say()  { printf '%s\n' "$*"; }
ok()   { printf '%s✓%s %s\n' "$GREEN" "$RST" "$*"; }
warn() { printf '%s!%s %s\n' "$YEL" "$RST" "$*"; }
die()  { printf '%s✗ %s%s\n' "$RED" "$*" "$RST" >&2; exit 1; }

say "${BOLD}Intendants — installer${RST}"

# 1. Prerequisites. Bun required; docker + gh recommended (needed for a LIVE run).
command -v bun >/dev/null 2>&1 || die "bun is required — https://bun.sh  (curl -fsSL https://bun.sh/install | bash)"
ok "bun $(bun --version)"
command -v docker >/dev/null 2>&1 && ok "docker present" || warn "docker not found — needed for a LIVE sandboxed run"
command -v gh     >/dev/null 2>&1 && ok "gh present"     || warn "gh (GitHub CLI) not found — needed for the GitHub watcher's reads"

# 2. Land in the repo — identify it by src/index.ts, not a package.json string, so
#    a consumer project isn't mistaken for the repo and modified in place.
if [ -f "package.json" ] && [ -f "src/index.ts" ]; then
  REPO_DIR="$(pwd)"; ok "using the current checkout ($REPO_DIR)"
elif [ -d "$CLONE_DIR/.git" ]; then
  REPO_DIR="$CLONE_DIR"; ok "found an existing clone ($REPO_DIR)"
else
  command -v git >/dev/null 2>&1 || die "git is required to clone the repo"
  say "${DIM}cloning $REPO_URL → $CLONE_DIR${RST}"
  git clone --depth 1 "$REPO_URL" "$CLONE_DIR" >/dev/null || die "clone failed (see the git error above)"
  REPO_DIR="$CLONE_DIR"; ok "cloned to $REPO_DIR"
fi
cd "$REPO_DIR"

# 3. Dependencies (fetches the pinned AGP kernel). stderr stays visible.
say "${DIM}bun install (fetches the pinned agent-governance-plane kernel)…${RST}"
bun install >/dev/null || die "bun install failed (see the error above)"; ok "dependencies installed"

# 4. Operator config + signing key — run ONLY when absent, DIE on real failure.
if [ ! -f "$HOME/.agp/policy.json" ]; then
  bun run src/index.ts init >/dev/null || die "intendants init failed (see the error above)"
fi
[ -f "$HOME/.agp/policy.json" ] && ok "config home ~/.agp ready" || warn "run: bun run src/index.ts init"
if [ ! -f "$HOME/.agp/signing/journal-ed25519.key" ]; then
  bun run src/index.ts keygen >/dev/null || die "intendants keygen failed (see the error above)"
fi
[ -f "$HOME/.agp/signing/journal-ed25519.key" ] && ok "journal signing key present" || warn "run: bun run src/index.ts keygen"

# 5. Prove it works with zero side effects.
bun run src/index.ts verify >/dev/null 2>&1 && ok "verify: journal intact" || warn "verify: no journal yet (expected on a fresh install)"

cat <<EOF

${BOLD}Installed.${RST} Next:
  cd $REPO_DIR && bun run src/index.ts doctor
  ${DIM}# author a spec from templates/github-watcher/, add a humanCommit block + enable it${RST}
  bun run src/index.ts watch run --spec <your-spec.json>

Docs: $REPO_DIR/templates/github-watcher/README.md
EOF
