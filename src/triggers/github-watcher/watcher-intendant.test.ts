import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolCallRequest } from "agp/src/contracts/gateway-message.ts";
import { WatcherSpec } from "./watcher-spec.ts";
import { WatcherStateLog } from "./state-log.ts";
import {
  buildIssueCommand,
  buildReadCommand,
  GithubWatcherIntendant,
  parseWatchItems,
} from "./watcher-intendant.ts";

const SPEC = WatcherSpec.parse({
  id: "sdk-watcher",
  enabled: true,
  repo: "acme/sdk",
  watch: "releases",
  issueRepo: "acme/watch-inbox",
  humanCommit: { committedBy: "jeremy", committedAt: "2026-07-10T00:00:00.000Z", method: "manual" },
});

const RELEASES = JSON.stringify([
  { tag_name: "v2.0.0", name: "v2", html_url: "https://github.com/acme/sdk/releases/tag/v2.0.0" },
  { tag_name: "v1.0.0", name: "v1", html_url: "https://github.com/acme/sdk/releases/tag/v1.0.0" },
]);

/** Drive the intendant like the daemon would, with scripted plane responses. */
async function drive(
  intendant: GithubWatcherIntendant,
  respond: (req: ToolCallRequest) => Promise<void>,
): Promise<void> {
  intendant.onToolCall((req) => {
    void respond(req);
  });
  await intendant.start("s1");
  await intendant.run("s1");
  await intendant.stop();
}

function tmpState(): { dir: string; log: WatcherStateLog } {
  const dir = mkdtempSync(join(tmpdir(), "agp-wint-"));
  return { dir, log: new WatcherStateLog(join(dir, "s.jsonl")) };
}

test("command builders: read + issue-create, with and without the vault placeholder", () => {
  expect(buildReadCommand(SPEC)).toBe("gh api 'repos/acme/sdk/releases?per_page=10'");
  const withSecret = WatcherSpec.parse({ ...JSON.parse(JSON.stringify(SPEC)), ghTokenSecret: "GH_TOKEN" });
  expect(buildReadCommand(withSecret)).toStartWith("env GH_TOKEN={{secret:GH_TOKEN}} gh api");
  const cmd = buildIssueCommand(SPEC, { key: "release:v1", title: "it's v1", url: "https://x" });
  expect(cmd).toContain("gh issue create -R acme/watch-inbox");
  expect(cmd).toContain("'\\''"); // single quotes in titles are shell-escaped
  const commits = WatcherSpec.parse({
    ...JSON.parse(JSON.stringify(SPEC)),
    watch: "commits",
    branch: "main",
  });
  expect(buildReadCommand(commits)).toContain("commits?sha=main");
});

test("parseWatchItems: releases and commits parse; malformed shapes throw (fail-closed)", () => {
  const items = parseWatchItems(SPEC, RELEASES);
  expect(items.map((i) => i.key)).toEqual(["release:v2.0.0", "release:v1.0.0"]);
  const commitsSpec = WatcherSpec.parse({
    ...JSON.parse(JSON.stringify(SPEC)),
    watch: "commits",
    branch: "main",
  });
  const commits = parseWatchItems(
    commitsSpec,
    JSON.stringify([{ sha: "abc123", commit: { message: "fix: x\n\nbody" }, html_url: "https://y" }]),
  );
  expect(commits[0]!.key).toBe("commit:abc123");
  expect(commits[0]!.title).toContain("fix: x");

  expect(() => parseWatchItems(SPEC, "")).toThrow(/no output/);
  expect(() => parseWatchItems(SPEC, "not json")).toThrow(/not JSON/);
  expect(() => parseWatchItems(SPEC, "{}")).toThrow(/not a JSON array/);
  expect(() => parseWatchItems(SPEC, JSON.stringify([{ nope: 1 }]))).toThrow(/no tag_name/);
});

test("MEANINGFULNESS FILTER: drafts always dropped; prereleases dropped unless opted in", () => {
  const mixed = JSON.stringify([
    { tag_name: "v3-rc1", name: "v3 RC1", html_url: "https://x/rc1", prerelease: true },
    { tag_name: "v2.0.0", name: "v2", html_url: "https://x/v2", prerelease: false },
    { tag_name: "v-draft", name: "draft", html_url: "https://x/d", draft: true },
    // A draft with NO tag_name (GitHub allows this) must be skipped, not crash the read.
    { name: "untagged draft", draft: true },
    { tag_name: "v1.0.0", name: "v1", html_url: "https://x/v1" },
  ]);
  // Default: only the two FULL releases survive (both drafts + the prerelease dropped).
  const filtered = parseWatchItems(SPEC, mixed);
  expect(filtered.map((i) => i.key)).toEqual(["release:v2.0.0", "release:v1.0.0"]);
  // Opt in to prereleases: the RC returns, the draft still never does.
  const withPre = WatcherSpec.parse({ ...JSON.parse(JSON.stringify(SPEC)), includePrereleases: true });
  const kept = parseWatchItems(withPre, mixed);
  expect(kept.map((i) => i.key)).toEqual(["release:v3-rc1", "release:v2.0.0", "release:v1.0.0"]);
  expect(kept.some((i) => i.key.includes("draft"))).toBe(false);
});

test("read → diff → act: new items are actioned oldest-first and recorded with the correlationId", async () => {
  const t = tmpState();
  const intendant = new GithubWatcherIntendant(SPEC, t.log, "corr-1");
  const acted: string[] = [];
  await drive(intendant, async (req) => {
    if (req.tool === "gh_read") {
      await intendant.deliver({ kind: "tool_call_result", id: req.id, sessionId: "s1", ok: true, output: RELEASES });
    } else {
      acted.push(req.id);
      await intendant.deliver({ kind: "tool_call_result", id: req.id, sessionId: "s1", ok: true, output: "issue #1" });
    }
  });
  expect(intendant.summary.readOk).toBe(true);
  // Oldest first: v1 before v2, ids carry the correlation id (cross-chain join).
  expect(acted).toEqual(["corr-1:act:release:v1.0.0", "corr-1:act:release:v2.0.0"]);
  expect(intendant.summary.actioned).toEqual(["release:v1.0.0", "release:v2.0.0"]);
  expect(t.log.has("release:v1.0.0")).toBe(true);
  rmSync(t.dir, { recursive: true, force: true });
});

test("FAIL-CLOSED: a failed or unparseable read means zero actions and a recorded reason", async () => {
  const t = tmpState();
  const failed = new GithubWatcherIntendant(SPEC, t.log, "corr-2");
  let acts = 0;
  await drive(failed, async (req) => {
    if (req.tool === "gh_read") {
      await failed.deliver({ kind: "tool_call_result", id: req.id, sessionId: "s1", ok: false, output: "boom" });
    } else acts++;
  });
  expect(failed.summary.readOk).toBe(false);
  expect(failed.summary.failureReason).toBe("read execution failed");
  expect(acts).toBe(0);

  const garbled = new GithubWatcherIntendant(SPEC, t.log, "corr-3");
  await drive(garbled, async (req) => {
    if (req.tool === "gh_read") {
      await garbled.deliver({
        kind: "tool_call_result",
        id: req.id,
        sessionId: "s1",
        ok: true,
        output: "[recording-sandbox] would run: gh api ...",
      });
    } else acts++;
  });
  expect(garbled.summary.readOk).toBe(false);
  expect(garbled.summary.failureReason).toContain("read unparseable");
  expect(acts).toBe(0);
  rmSync(t.dir, { recursive: true, force: true });
});

test("a DENIED action is suppressed (observed) — the watcher never nags; a failed exec is retried", async () => {
  const t = tmpState();
  const intendant = new GithubWatcherIntendant(SPEC, t.log, "corr-4");
  await drive(intendant, async (req) => {
    if (req.tool === "gh_read") {
      await intendant.deliver({ kind: "tool_call_result", id: req.id, sessionId: "s1", ok: true, output: RELEASES });
    } else if (req.id.endsWith("release:v1.0.0")) {
      // Human denied: mediate delivers the verdict, not a result.
      await intendant.deliver({
        kind: "policy_verdict",
        id: req.id,
        sessionId: "s1",
        verdict: { decision: "deny", reason: "operator said no", ruleId: "r1", tier: null },
      });
    } else {
      // Approved but the exec itself failed (gh error): retryable.
      await intendant.deliver({ kind: "tool_call_result", id: req.id, sessionId: "s1", ok: false, output: "gh: 502" });
    }
  });
  expect(intendant.summary.suppressed).toEqual(["release:v1.0.0"]);
  expect(intendant.summary.actioned).toEqual([]);
  expect(t.log.has("release:v1.0.0")).toBe(true); // denied → never re-asked
  expect(t.log.has("release:v2.0.0")).toBe(false); // failed exec → retried next run
  rmSync(t.dir, { recursive: true, force: true });
});

test("NOTIFY mode: surfaces capped new items, makes NO issue-create call, records nothing itself", async () => {
  const t = tmpState();
  const notifySpec = WatcherSpec.parse({
    id: "sdk-watcher",
    enabled: true,
    repo: "acme/sdk",
    watch: "releases",
    issueRepo: "acme/watch-inbox",
    deliver: "notify",
    notifyWebhookEnv: "HOOK",
    maxActionsPerRun: 1,
    humanCommit: { committedBy: "jeremy", committedAt: "2026-07-11T00:00:00.000Z", method: "manual" },
  });
  const intendant = new GithubWatcherIntendant(notifySpec, t.log, "corr-n");
  const tools: string[] = [];
  await drive(intendant, async (req) => {
    tools.push(req.tool);
    if (req.tool === "gh_read") {
      await intendant.deliver({ kind: "tool_call_result", id: req.id, sessionId: "s1", ok: true, output: RELEASES });
    }
  });
  expect(intendant.summary.readOk).toBe(true);
  expect(tools).toEqual(["gh_read"]); // NO gh_issue_create in notify mode
  expect(intendant.summary.toNotify.map((i) => i.key)).toEqual(["release:v1.0.0"]); // capped, oldest-first
  expect(intendant.summary.actioned).toEqual([]);
  // The intendant records nothing — the CLI records after a successful post.
  expect(t.log.has("release:v1.0.0")).toBe(false);
  rmSync(t.dir, { recursive: true, force: true });
});

test("the per-run action cap throttles (excess new items wait for later runs)", async () => {
  const t = tmpState();
  const capped = WatcherSpec.parse({
    id: "sdk-watcher",
    enabled: true,
    repo: "acme/sdk",
    watch: "releases",
    issueRepo: "acme/watch-inbox",
    maxActionsPerRun: 1,
    humanCommit: { committedBy: "jeremy", committedAt: "2026-07-10T00:00:00.000Z", method: "manual" },
  });
  const intendant = new GithubWatcherIntendant(capped, t.log, "corr-5");
  let acts = 0;
  await drive(intendant, async (req) => {
    if (req.tool === "gh_read") {
      await intendant.deliver({ kind: "tool_call_result", id: req.id, sessionId: "s1", ok: true, output: RELEASES });
    } else {
      acts++;
      await intendant.deliver({ kind: "tool_call_result", id: req.id, sessionId: "s1", ok: true, output: "ok" });
    }
  });
  expect(acts).toBe(1);
  expect(intendant.summary.newKeys).toHaveLength(2); // both seen as new…
  expect(intendant.summary.actioned).toEqual(["release:v1.0.0"]); // …oldest actioned first
  expect(t.log.has("release:v2.0.0")).toBe(false); // waits for the next run
  rmSync(t.dir, { recursive: true, force: true });
});
