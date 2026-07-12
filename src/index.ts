#!/usr/bin/env bun
// `intendants` — the operator CLI for governed background agents.
//
// Intendants is the PRODUCT front for the governance runtime shipped by
// agent-governance-plane (AGP): it composes AGP as a pinned git dependency and
// owns the operator surface — templates, install, and the `watch` loop that
// wakes a governed agent on a trigger. The governance itself (policy gate →
// Slack HITL → Docker sandbox → signed audit log of every tool call) lives in
// AGP; this CLI dispatches to it, so the "model proposes; the deterministic
// system decides and records" boundary is exactly AGP's, unchanged.
//
// Extraction plan + architecture: AGP 000-docs/057-AT-ADR (intent-os 030-AT-DECR).
// Private v0 — no public surface until Jeremy opens that door.

import { initCommand } from "agp/src/cli/commands/init.ts";
import { keygenCommand } from "agp/src/cli/commands/keygen.ts";
import { doctorCommand } from "agp/src/cli/commands/doctor.ts";
import { verifyCommand } from "agp/src/cli/commands/verify.ts";
import { watchCommand } from "agp/src/cli/commands/watch.ts";

const USAGE = `intendants — governed background agents

Usage: intendants <command> [options]

Commands:
  init        Scaffold the config home (~/.agp): config + policy skeletons + signing dir
              --force   overwrite existing config/policy files
  keygen      Generate the Ed25519 journal-signing key (--force to replace)
  doctor      Validate prerequisites (Docker, Slack, signing key, policy) — fail-closed
  watch       Run a governed background agent on a trigger
              run    --spec <path>   one tick: read (gated) → judge → act (issue: require+HITL | notify: webhook)
              status --spec <path>   liveness dead-man's-switch + knowledge-chain verify (exit 1 = stale/broken)
              enable --spec <path>   human re-commit after a restart-intensity refusal
  verify      Verify the signed audit journal (hash chain + signatures), offline
  help        Show this help

Governance runtime: agent-governance-plane (composed as a pinned dependency).
Every tool call passes a policy gate and lands in a signed audit log.
`;

export async function main(argv: string[]): Promise<number> {
  const cmd = argv[0];
  switch (cmd) {
    case "init": {
      const res = initCommand(process.env, { force: argv.includes("--force") });
      for (const c of res.created) console.log(`created  ${c}`);
      for (const s of res.skipped) console.log(`skipped  ${s} (exists; use --force to overwrite)`);
      console.log(res.message);
      return res.code;
    }
    case "keygen": {
      const res = keygenCommand(process.env, { force: argv.includes("--force") });
      console.log(res.message);
      return res.code;
    }
    case "doctor": {
      const ci = argv.indexOf("--check");
      const only = ci >= 0 ? argv[ci + 1] : undefined;
      return doctorCommand(process.env, console.log, only);
    }
    case "watch":
      return watchCommand(argv.slice(1), process.env, console.log);
    case "verify":
      return verifyCommand(argv.slice(1));
    case "help":
    case "--help":
    case "-h":
      console.log(USAGE);
      return 0;
    case undefined:
      console.log(USAGE);
      return 1;
    default:
      console.error(`intendants: unknown command '${cmd}'\n`);
      console.error(USAGE);
      return 1;
  }
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
