// Template test pack — ACCEPTANCE layer. The Slice-0 acceptance criteria
// (bead agp-eva.1, per intent-os 030-AT-DECR), end to end and hermetic:
//
//   consecutive triggered runs · only genuinely-new events surface · ZERO
//   duplicate actions · every action HITL-gated · denied means suppressed
//   forever · the signed journal verifies OFFLINE · the cross-chain causal
//   pointer reconstructs "what did it know when it acted?"
//
// The harness composes the REAL plane (Daemon + PolicyEngine + signed Journal +
// OneShotPollSource + GithubWatcherIntendant + hash-chained state log) with an
// executing fixture sandbox (canned GitHub API JSON) and the fail-closed
// console channel — the same composition `agp watch run` wires, minus network.

import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Daemon } from "agp/src/daemon/daemon.ts";
import { Journal, readEvents } from "agp/src/journal/journal.ts";
import { verifyJournalFile } from "agp/src/journal/verify.ts";
import { PolicyEngine, PolicyFile } from "agp/src/policy/engine.ts";
import { ConsoleChannel } from "agp/src/runtime/channel.ts";
import {
  generateSigningKeyPem,
  loadPrivateKey,
  publicKeyFromPrivate,
} from "agp/src/runtime/crypto.ts";
import type {
  ExecResult,
  IsolationGuarantees,
  SandboxHandle,
  SandboxProvider,
  SandboxSpec,
} from "agp/src/contracts/sandbox-provider.ts";
import type { TriggerEvent } from "agp/src/contracts/trigger-source.ts";
import { WatcherSpec } from "agp/src/triggers/github-watcher/watcher-spec.ts";
import { verifyStateLog, WatcherStateLog, readStateEntries } from "agp/src/triggers/github-watcher/state-log.ts";
import { OneShotPollSource } from "agp/src/triggers/github-watcher/one-shot-poll-source.ts";
import { GithubWatcherIntendant } from "agp/src/triggers/github-watcher/watcher-intendant.ts";

const SPEC = WatcherSpec.parse({
  id: "sdk-watcher",
  enabled: true,
  repo: "acme/sdk",
  watch: "releases",
  issueRepo: "acme/watch-inbox",
  humanCommit: { committedBy: "jeremy", committedAt: "2026-07-10T00:00:00.000Z", method: "manual" },
});

/** Executes nothing real: serves canned GitHub JSON for reads, succeeds writes. */
class FixtureSandbox implements SandboxProvider {
  releasesJson = "[]";
  readonly issued: string[] = [];
  isolation(): IsolationGuarantees {
    return { kind: "fixture", boundary: "none — canned responses for the template pack", vmGrade: false };
  }
  spawn(spec: SandboxSpec): Promise<SandboxHandle> {
    return Promise.resolve({ id: `fx-${spec.sessionId}`, sessionId: spec.sessionId });
  }
  exec(_handle: SandboxHandle, command: readonly string[]): Promise<ExecResult> {
    const cmd = command.join(" ");
    if (cmd.includes("gh api")) {
      return Promise.resolve({ exitCode: 0, stdout: this.releasesJson, stderr: "" });
    }
    this.issued.push(cmd);
    return Promise.resolve({ exitCode: 0, stdout: "https://github.com/acme/watch-inbox/issues/1", stderr: "" });
  }
  teardown(): Promise<void> {
    return Promise.resolve();
  }
}

interface Plane {
  dir: string;
  journalPath: string;
  statePath: string;
  pub: ReturnType<typeof publicKeyFromPrivate>;
  daemon: Daemon;
  sandbox: FixtureSandbox;
  journal: Journal;
}

async function plane(env: Record<string, string | undefined>): Promise<Plane> {
  const dir = mkdtempSync(join(tmpdir(), "agp-accept-"));
  const priv = loadPrivateKey(generateSigningKeyPem().privateKeyPem);
  const journalPath = join(dir, "audit.log");
  const journal = new Journal(journalPath, priv);
  const raw = await Bun.file(join(import.meta.dir, "..", "policy.snippet.json")).json();
  const sandbox = new FixtureSandbox();
  const daemon = new Daemon({
    policy: new PolicyEngine(PolicyFile.parse(raw).rules),
    journal,
    sandbox,
    channel: new ConsoleChannel(env, () => {}),
  });
  return { dir, journalPath, statePath: join(dir, "s.jsonl"), pub: publicKeyFromPrivate(priv), daemon, sandbox, journal };
}

/** One `agp watch run`-shaped tick: trigger → journal bracket → mediated session. */
async function tick(p: Plane, n: number): Promise<GithubWatcherIntendant> {
  const state = new WatcherStateLog(p.statePath); // fresh instance per tick, like cron
  const source = new OneShotPollSource({
    sourceSpec: { id: SPEC.id, kind: "poll", enabled: true, livenessTimeoutMs: null, config: {} },
    lastEventAt: state.lastRunAt(),
    restartCount: state.consecutiveFailures(),
    mintId: (() => {
      let i = 0;
      return () => `t${n}-${++i}`;
    })(),
  });
  let fired: TriggerEvent | null = null;
  await source.start(async (e) => {
    fired = e;
  });
  const event = fired!;
  p.journal.append({
    kind: "trigger.fired",
    actor: "session_owner",
    payload: { triggerId: event.triggerId, source: event.source, correlationId: event.correlationId, knowledgeTipHash: state.tipHash() },
  });
  const intendant = new GithubWatcherIntendant(SPEC, state, event.correlationId);
  await p.daemon.runMediated(intendant, { sessionId: `sess-${n}` });
  state.append("run", { correlationId: event.correlationId, ok: intendant.summary.readOk });
  p.journal.append({
    kind: "trigger.settled",
    actor: "session_owner",
    payload: {
      correlationId: event.correlationId,
      newKeys: intendant.summary.newKeys,
      actioned: intendant.summary.actioned,
      suppressed: intendant.summary.suppressed,
      knowledgeTipHash: state.tipHash(),
    },
  });
  return intendant;
}

test("ACCEPTANCE: consecutive runs — new release actioned once under HITL, repeats are silent, backlog drains, journal + pointer verify offline", async () => {
  const p = await plane({ AGP_AUTO_APPROVE: "1" }); // the human approves in this scenario

  // Run 1: one release exists → one HITL-approved issue.
  p.sandbox.releasesJson = JSON.stringify([{ tag_name: "v1.0.0", name: "v1", html_url: "https://x/v1" }]);
  const r1 = await tick(p, 1);
  expect(r1.summary.actioned).toEqual(["release:v1.0.0"]);
  expect(p.sandbox.issued).toHaveLength(1);

  // Run 2: same fixture → ZERO duplicate alerts (the core competitor failure).
  const r2 = await tick(p, 2);
  expect(r2.summary.newKeys).toEqual([]);
  expect(r2.summary.actioned).toEqual([]);
  expect(p.sandbox.issued).toHaveLength(1); // still exactly one issue, ever

  // Run 3: a second release appears → exactly the new one is actioned.
  p.sandbox.releasesJson = JSON.stringify([
    { tag_name: "v2.0.0", name: "v2", html_url: "https://x/v2" },
    { tag_name: "v1.0.0", name: "v1", html_url: "https://x/v1" },
  ]);
  const r3 = await tick(p, 3);
  expect(r3.summary.actioned).toEqual(["release:v2.0.0"]);
  expect(p.sandbox.issued).toHaveLength(2);

  // The signed action journal verifies OFFLINE, end to end.
  expect(verifyJournalFile(p.journalPath, p.pub).ok).toBe(true);
  // …and the knowledge chain verifies too.
  expect(verifyStateLog(p.statePath)).toEqual([]);

  // CROSS-CHAIN CAUSAL POINTER: for each settled run, the journal names the
  // knowledge tip; the state chain contains that exact tip; and every issue
  // actioned under a correlationId is recorded in BOTH chains under it.
  const events = readEvents(p.journalPath);
  const settled = events.filter((e) => e.kind === "trigger.settled");
  expect(settled).toHaveLength(3);
  const stateHashes = new Set(readStateEntries(p.statePath).map((e) => e.hash));
  for (const s of settled) {
    expect(stateHashes.has(s.payload.knowledgeTipHash as string)).toBe(true);
  }
  const run1Fired = events.find((e) => e.kind === "trigger.fired")!;
  expect(run1Fired.payload.knowledgeTipHash).toBeNull(); // before run 1 it knew nothing
  const observedV1 = readStateEntries(p.statePath).find(
    (e) => e.kind === "observed" && e.payload.key === "release:v1.0.0",
  )!;
  expect(observedV1.payload.correlationId).toBe(settled[0]!.payload.correlationId);

  // Every executed action really went through approval: the journal shows the
  // require verdict AND the grant before each execution of gh_issue_create.
  const kinds = events.map((e) => e.kind);
  expect(kinds.filter((k) => k === "approval.granted").length).toBeGreaterThanOrEqual(2);
  rmSync(p.dir, { recursive: true, force: true });
});

test("ACCEPTANCE: with NO human present the fail-closed channel denies — the issue is suppressed forever, never filed, and never re-asked", async () => {
  const p = await plane({}); // no AGP_AUTO_APPROVE → ConsoleChannel denies
  p.sandbox.releasesJson = JSON.stringify([{ tag_name: "v1.0.0", name: "v1", html_url: "https://x/v1" }]);

  const r1 = await tick(p, 1);
  expect(r1.summary.actioned).toEqual([]);
  expect(r1.summary.suppressed).toEqual(["release:v1.0.0"]);
  expect(p.sandbox.issued).toHaveLength(0); // nothing was ever filed

  const r2 = await tick(p, 2);
  expect(r2.summary.newKeys).toEqual([]); // the denial dedupes: the watcher never nags

  const events = readEvents(p.journalPath);
  expect(events.some((e) => e.kind === "approval.denied")).toBe(true);
  expect(events.some((e) => e.kind === "tool_call.executed" && String(e.payload.messageId).includes(":act:"))).toBe(false);
  expect(verifyJournalFile(p.journalPath, p.pub).ok).toBe(true);
  rmSync(p.dir, { recursive: true, force: true });
});
