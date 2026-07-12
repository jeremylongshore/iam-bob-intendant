// Template test pack — POLICY layer (custom layer 1 of 3; maps to AGP).
// Proves what the watcher is NOT allowed to do: the consequential action can
// never pass without a human, and anything undeclared is default-denied.

import { test, expect } from "bun:test";
import { join } from "node:path";
import { PolicyEngine, PolicyFile } from "agp/src/policy/engine.ts";

async function engineFromSnippet(): Promise<PolicyEngine> {
  const raw = await Bun.file(join(import.meta.dir, "..", "policy.snippet.json")).json();
  return new PolicyEngine(PolicyFile.parse(raw).rules);
}

test("the poll read is allowed for the agent actor", async () => {
  const engine = await engineFromSnippet();
  expect(engine.evaluate({ tool: "gh_read", actor: "claude_process" }).decision).toBe("allow");
});

test("issue-create ALWAYS requires a human — the watcher cannot approve itself", async () => {
  const engine = await engineFromSnippet();
  expect(engine.evaluate({ tool: "gh_issue_create", actor: "claude_process" }).decision).toBe("require");
});

test("strictest-wins: a stray allow rule for the same tool cannot weaken the require", async () => {
  const raw = await Bun.file(join(import.meta.dir, "..", "policy.snippet.json")).json();
  const rules = PolicyFile.parse(raw).rules;
  const engine = new PolicyEngine([
    ...rules,
    // An attacker (or a sloppy merge) adds a broad allow — require still wins.
    { id: "sloppy-allow", effect: "allow", tool: "gh_issue_create", priority: 999 },
  ]);
  expect(engine.evaluate({ tool: "gh_issue_create", actor: "claude_process" }).decision).toBe("require");
});

test("anything the template did not declare is DEFAULT-DENIED (fail-closed)", async () => {
  const engine = await engineFromSnippet();
  for (const tool of ["gh_pr_merge", "Bash", "rm", "curl"]) {
    expect(engine.evaluate({ tool, actor: "claude_process" }).decision).toBe("deny");
  }
});

test("the watcher's tools do not leak to the human actor rule-free", async () => {
  const engine = await engineFromSnippet();
  // The snippet scopes rules to claude_process; a session_owner call has no
  // matching rule and default-denies — no accidental human bypass lane.
  expect(engine.evaluate({ tool: "gh_read", actor: "session_owner" }).decision).toBe("deny");
});
