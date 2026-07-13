import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readStateEntries, verifyStateLog, WatcherStateLog } from "./state-log.ts";

function tmpLog(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "agp-wstate-"));
  return { dir, path: join(dir, "w.state.jsonl") };
}

test("appends chain: each entry's prevHash is the prior hash and the chain verifies", () => {
  const t = tmpLog();
  const log = new WatcherStateLog(t.path, () => "2026-07-10T00:00:00.000Z");
  expect(log.tipHash()).toBeNull();
  const e1 = log.append("run", { ok: true });
  const e2 = log.append("observed", { key: "release:v1", outcome: "actioned" });
  expect(e1.prevHash).toBeNull();
  expect(e2.prevHash).toBe(e1.hash);
  expect(log.tipHash()).toBe(e2.hash);
  expect(verifyStateLog(t.path)).toEqual([]);
  rmSync(t.dir, { recursive: true, force: true });
});

test("TAMPER-EVIDENT: altering a recorded entry breaks the chain verifiably", () => {
  const t = tmpLog();
  const log = new WatcherStateLog(t.path, () => "2026-07-10T00:00:00.000Z");
  log.append("observed", { key: "release:v1", outcome: "actioned" });
  log.append("run", { ok: true });
  const lines = readFileSync(t.path, "utf8").trim().split("\n");
  const first = JSON.parse(lines[0]!);
  first.payload.outcome = "suppressed"; // rewrite history: actioned → suppressed
  writeFileSync(t.path, [JSON.stringify(first), lines[1]].join("\n") + "\n");
  const errors = verifyStateLog(t.path);
  expect(errors.length).toBeGreaterThan(0);
  expect(errors.join(" ")).toContain("hash mismatch");
  rmSync(t.dir, { recursive: true, force: true });
});

test("DEDUP: has() sees observed keys regardless of outcome — actioned and suppressed both dedupe", () => {
  const t = tmpLog();
  const log = new WatcherStateLog(t.path);
  log.append("observed", { key: "release:v1", outcome: "actioned" });
  log.append("observed", { key: "release:v2", outcome: "suppressed" });
  expect(log.has("release:v1")).toBe(true);
  expect(log.has("release:v2")).toBe(true); // the operator said no ONCE — never nag
  expect(log.has("release:v3")).toBe(false);
  rmSync(t.dir, { recursive: true, force: true });
});

test("restart-intensity: consecutiveFailures counts the failing tail and a human enable resets it", () => {
  const t = tmpLog();
  const log = new WatcherStateLog(t.path);
  expect(log.consecutiveFailures()).toBe(0);
  log.append("run", { ok: false, reason: "read unparseable" });
  log.append("run", { ok: false, reason: "read unparseable" });
  expect(log.consecutiveFailures()).toBe(2);
  log.append("run", { ok: true });
  expect(log.consecutiveFailures()).toBe(0); // a success breaks the streak
  log.append("run", { ok: false });
  expect(log.consecutiveFailures()).toBe(1);
  log.append("enable", { by: "jeremy" });
  expect(log.consecutiveFailures()).toBe(0); // a human re-commit resets the bound
  rmSync(t.dir, { recursive: true, force: true });
});

test("lastRunAt reads the most recent run entry; observed entries do not count", () => {
  const t = tmpLog();
  let tick = 0;
  const times = ["2026-07-10T00:00:00.000Z", "2026-07-10T01:00:00.000Z", "2026-07-10T02:00:00.000Z"];
  const log = new WatcherStateLog(t.path, () => times[tick++]!);
  expect(log.lastRunAt()).toBeNull();
  log.append("run", { ok: true });
  log.append("observed", { key: "k", outcome: "actioned" });
  expect(log.lastRunAt()).toBe("2026-07-10T00:00:00.000Z");
  rmSync(t.dir, { recursive: true, force: true });
});

test("a fresh instance re-reads the persisted chain (dedup survives across runs)", () => {
  const t = tmpLog();
  const first = new WatcherStateLog(t.path);
  first.append("observed", { key: "release:v1", outcome: "actioned" });
  const second = new WatcherStateLog(t.path); // a new `agp watch run` invocation
  expect(second.has("release:v1")).toBe(true);
  expect(second.tipHash()).toBe(first.tipHash());
  expect(readStateEntries(t.path)).toHaveLength(1);
  rmSync(t.dir, { recursive: true, force: true });
});
