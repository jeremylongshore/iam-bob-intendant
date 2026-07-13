// Template test pack — STATE/MEMORY layer (custom layer 2 of 3; maps to GSB).
// The Slice-0 acceptance criterion in miniature: "same SHA twice → no re-alert",
// on the hash-chained knowledge log that GSB's receipt store later swaps behind.

import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolCallRequest } from "agp/src/contracts/gateway-message.ts";
import { WatcherSpec } from "../../../src/triggers/github-watcher/watcher-spec.ts";
import { verifyStateLog, WatcherStateLog } from "../../../src/triggers/github-watcher/state-log.ts";
import { GithubWatcherIntendant } from "../../../src/triggers/github-watcher/watcher-intendant.ts";

const SPEC = WatcherSpec.parse({
  id: "sdk-watcher",
  enabled: true,
  repo: "acme/sdk",
  watch: "commits",
  branch: "main",
  issueRepo: "acme/watch-inbox",
  humanCommit: { committedBy: "jeremy", committedAt: "2026-07-10T00:00:00.000Z", method: "manual" },
});

const COMMITS = JSON.stringify([
  { sha: "aaa111", commit: { message: "feat: breaking API change" }, html_url: "https://x/aaa111" },
]);

async function oneRun(state: WatcherStateLog, correlationId: string): Promise<GithubWatcherIntendant> {
  const intendant = new GithubWatcherIntendant(SPEC, state, correlationId);
  intendant.onToolCall((req: ToolCallRequest) => {
    void (async () => {
      if (req.tool === "gh_read") {
        await intendant.deliver({ kind: "tool_call_result", id: req.id, sessionId: "s", ok: true, output: COMMITS });
      } else {
        await intendant.deliver({ kind: "tool_call_result", id: req.id, sessionId: "s", ok: true, output: "issue" });
      }
    })();
  });
  await intendant.start("s");
  await intendant.run("s");
  await intendant.stop();
  return intendant;
}

test("SAME SHA TWICE → NO RE-ALERT: the second run over identical input acts zero times", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agp-tstate-"));
  const path = join(dir, "s.jsonl");

  const run1 = await oneRun(new WatcherStateLog(path), "corr-1");
  expect(run1.summary.actioned).toEqual(["commit:aaa111"]);

  // Fresh instance, same persisted chain — exactly how consecutive cron ticks run.
  const run2 = await oneRun(new WatcherStateLog(path), "corr-2");
  expect(run2.summary.readOk).toBe(true);
  expect(run2.summary.candidates).toBe(1);
  expect(run2.summary.newKeys).toEqual([]); // seen before — silence
  expect(run2.summary.actioned).toEqual([]);

  expect(verifyStateLog(path)).toEqual([]); // and the knowledge chain is intact
  rmSync(dir, { recursive: true, force: true });
});

test("the observed entry records WHICH run knew it (correlationId, for the cross-chain join)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agp-tstate-"));
  const path = join(dir, "s.jsonl");
  await oneRun(new WatcherStateLog(path), "corr-9");
  const state = new WatcherStateLog(path);
  expect(state.has("commit:aaa111")).toBe(true);
  const raw = await Bun.file(path).text();
  expect(raw).toContain('"correlationId":"corr-9"');
  rmSync(dir, { recursive: true, force: true });
});
