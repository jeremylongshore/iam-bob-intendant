import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadWatcherSpec, WatcherSpec } from "./watcher-spec.ts";

const VALID = {
  id: "sdk-watcher",
  repo: "acme/sdk",
  watch: "releases",
  issueRepo: "acme/watch-inbox",
  humanCommit: { committedBy: "jeremy", committedAt: "2026-07-10T00:00:00.000Z", method: "manual" },
};

function tmpSpec(content: unknown): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "agp-wspec-"));
  const path = join(dir, "spec.json");
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
  return { dir, path };
}

test("a valid committed spec parses and applies fail-closed defaults", () => {
  const spec = WatcherSpec.parse(VALID);
  expect(spec.enabled).toBe(false); // fail-closed: inert until explicitly enabled
  expect(spec.maxActionsPerRun).toBe(3);
  expect(spec.maxConsecutiveFailures).toBe(3);
  expect(spec.ghTokenSecret).toBeNull();
  expect(spec.branch).toBeNull();
});

test("HUMAN COMMIT GATE: a draft without humanCommit refuses to parse", () => {
  const { humanCommit: _dropped, ...draft } = VALID;
  expect(() => WatcherSpec.parse(draft)).toThrow();
});

test("an unknown key is a malformed spec and refuses (strict, fail-closed)", () => {
  expect(() => WatcherSpec.parse({ ...VALID, autoApprove: true })).toThrow();
});

test("watch: commits without a branch refuses", () => {
  expect(() => WatcherSpec.parse({ ...VALID, watch: "commits" })).toThrow();
  const withBranch = WatcherSpec.parse({ ...VALID, watch: "commits", branch: "main" });
  expect(withBranch.branch).toBe("main");
});

test("a non-'owner/name' repo reference refuses", () => {
  expect(() => WatcherSpec.parse({ ...VALID, repo: "not a repo" })).toThrow();
  expect(() => WatcherSpec.parse({ ...VALID, issueRepo: "https://github.com/a/b" })).toThrow();
});

test("humanCommit.method only accepts 'manual' at v0", () => {
  expect(() =>
    WatcherSpec.parse({
      ...VALID,
      humanCommit: { ...VALID.humanCommit, method: "llm-asserted" },
    }),
  ).toThrow();
});

test("deliver defaults to 'issue'; 'notify' requires notifyWebhookEnv", () => {
  expect(WatcherSpec.parse(VALID).deliver).toBe("issue");
  // notify without the webhook env name refuses…
  expect(() => WatcherSpec.parse({ ...VALID, deliver: "notify" })).toThrow(/notifyWebhookEnv/);
  // …with it, it parses.
  const notify = WatcherSpec.parse({
    ...VALID,
    deliver: "notify",
    notifyWebhookEnv: "SLACK_OPERATION_HIRED_WEBHOOK_URL",
  });
  expect(notify.deliver).toBe("notify");
  expect(notify.notifyWebhookEnv).toBe("SLACK_OPERATION_HIRED_WEBHOOK_URL");
});

test("loadWatcherSpec: missing file, invalid JSON, and schema violations all throw", () => {
  expect(() => loadWatcherSpec("/nonexistent/spec.json")).toThrow(/not found/);

  const bad = tmpSpec("{ not json");
  expect(() => loadWatcherSpec(bad.path)).toThrow(/not valid JSON/);
  rmSync(bad.dir, { recursive: true, force: true });

  const draft = tmpSpec({ ...VALID, humanCommit: undefined });
  expect(() => loadWatcherSpec(draft.path)).toThrow();
  rmSync(draft.dir, { recursive: true, force: true });

  const ok = tmpSpec(VALID);
  expect(loadWatcherSpec(ok.path).id).toBe("sdk-watcher");
  rmSync(ok.dir, { recursive: true, force: true });
});
