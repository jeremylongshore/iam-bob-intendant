// `bob watch` command tests — reference-mode paths only (hermetic; the live
// Docker/Slack paths stay behind AGP_DOCKER_E2E / AGP_SLACK_LIVE like `agp run`).

import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initCommand } from "agp/src/cli/commands/init.ts";
import { keygenCommand } from "agp/src/cli/commands/keygen.ts";
import { watchCommand } from "./watch.ts";
import { readEvents } from "agp/src/journal/journal.ts";
import { resolvePaths } from "agp/src/config.ts";

const POLICY = {
  rules: [
    { id: "watcher-gh-read", effect: "allow", tool: "gh_read", actor: "claude_process" },
    { id: "watcher-gh-issue-create", effect: "require", tool: "gh_issue_create", actor: "claude_process" },
  ],
};

function home(): { env: Record<string, string | undefined>; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "agp-watch-"));
  return { env: { AGP_HOME: dir }, dir };
}

/** A provisioned home (init + keygen + watcher policy) and a committed spec. */
function provisioned(specOverrides: Record<string, unknown> = {}) {
  const { env, dir } = home();
  initCommand(env);
  keygenCommand(env);
  const paths = resolvePaths(env);
  writeFileSync(paths.policy, JSON.stringify(POLICY));
  const specPath = join(dir, "watcher.spec.json");
  writeFileSync(
    specPath,
    JSON.stringify({
      id: "sdk-watcher",
      enabled: true,
      repo: "acme/sdk",
      watch: "releases",
      issueRepo: "acme/watch-inbox",
      humanCommit: { committedBy: "jeremy", committedAt: "2026-07-10T00:00:00.000Z", method: "manual" },
      ...specOverrides,
    }),
  );
  return { env, dir, specPath, paths };
}

test("run fails closed: missing --spec, missing spec file, disabled spec, missing key", async () => {
  const lines: string[] = [];
  const out = (l: string) => lines.push(l);

  expect(await watchCommand(["run"], home().env, out)).toBe(1);
  expect(lines.join("\n")).toContain("--spec <path> is required");

  expect(await watchCommand(["run", "--spec", "/nope.json"], home().env, out)).toBe(1);

  const disabled = provisioned({ enabled: false });
  expect(await watchCommand(["run", "--spec", disabled.specPath], disabled.env, out)).toBe(1);
  expect(lines.join("\n")).toContain("enabled:false");
  rmSync(disabled.dir, { recursive: true, force: true });

  const { env, dir, specPath } = provisioned();
  rmSync(resolvePaths(env).signingKey); // provisioned, then key removed
  expect(await watchCommand(["run", "--spec", specPath], env, out)).toBe(1);
  expect(lines.join("\n")).toContain("signing key missing");
  rmSync(dir, { recursive: true, force: true });
});

test("a draft spec (no humanCommit) refuses — the human commit gate at the CLI boundary", async () => {
  const { env, dir, specPath } = provisioned();
  const raw = JSON.parse(readFileSync(specPath, "utf8"));
  delete raw.humanCommit;
  writeFileSync(specPath, JSON.stringify(raw));
  const lines: string[] = [];
  expect(await watchCommand(["run", "--spec", specPath], env, (l) => lines.push(l))).toBe(1);
  expect(lines.join("\n")).toContain("(fail-closed)");
  rmSync(dir, { recursive: true, force: true });
});

test("reference run records an HONEST failure (recording sandbox reads nothing) with the full journal bracket", async () => {
  const { env, dir, specPath, paths } = provisioned();
  const lines: string[] = [];
  const code = await watchCommand(["run", "--spec", specPath], env, (l) => lines.push(l));
  expect(code).toBe(2); // ran, read unparseable → failure, fail-closed

  const events = readEvents(paths.journal);
  const kinds = events.map((e) => e.kind);
  expect(kinds).toContain("trigger.fired");
  expect(kinds).toContain("session.started");
  expect(kinds).toContain("tool_call.allow"); // the gh_read verdict
  expect(kinds).toContain("session.ended");
  expect(kinds).toContain("trigger.settled");

  // Cross-chain causal pointer: fired + settled share the correlationId, and
  // settled records the post-run knowledge tip.
  const fired = events.find((e) => e.kind === "trigger.fired")!;
  const settled = events.find((e) => e.kind === "trigger.settled")!;
  expect(settled.payload.correlationId).toBe(fired.payload.correlationId);
  expect(fired.payload.knowledgeTipHash).toBeNull(); // knew nothing before run 1
  expect(typeof settled.payload.knowledgeTipHash).toBe("string"); // knows the run now
  expect(settled.payload.ok).toBe(false);

  // The state log recorded the failed run.
  const state = readFileSync(join(dir, "watch", "sdk-watcher.state.jsonl"), "utf8");
  expect(state).toContain('"ok":false');
  rmSync(dir, { recursive: true, force: true });
});

test("restart-intensity bound: after maxConsecutiveFailures the runner REFUSES until a human enables", async () => {
  const { env, dir, specPath } = provisioned({ maxConsecutiveFailures: 2 });
  const out = () => {};
  expect(await watchCommand(["run", "--spec", specPath], env, out)).toBe(2);
  expect(await watchCommand(["run", "--spec", specPath], env, out)).toBe(2);
  // Bound reached: the third run refuses before doing anything.
  const lines: string[] = [];
  expect(await watchCommand(["run", "--spec", specPath], env, (l) => lines.push(l))).toBe(3);
  expect(lines.join("\n")).toContain("REFUSING");

  // Human re-commit resets the streak; the next run runs again (and fails honestly).
  expect(await watchCommand(["enable", "--spec", specPath], env, out)).toBe(0);
  expect(await watchCommand(["run", "--spec", specPath], env, out)).toBe(2);
  rmSync(dir, { recursive: true, force: true });
});

test("status: reports the dead-man's-switch — never-run cadence-bound is STALE, fresh run is ok", async () => {
  const bound = provisioned({ livenessTimeoutMs: 60_000 });
  const lines: string[] = [];
  expect(await watchCommand(["status", "--spec", bound.specPath], bound.env, (l) => lines.push(l))).toBe(1);
  expect(lines.join("\n")).toContain("STALE");

  await watchCommand(["run", "--spec", bound.specPath], bound.env, () => {});
  const after: string[] = [];
  expect(await watchCommand(["status", "--spec", bound.specPath], bound.env, (l) => after.push(l))).toBe(0);
  expect(after.join("\n")).toContain("liveness:             ok");
  expect(after.join("\n")).toContain("knowledge chain:      intact");
  rmSync(bound.dir, { recursive: true, force: true });

  const unbound = provisioned(); // livenessTimeoutMs null → not cadence-watched
  expect(await watchCommand(["status", "--spec", unbound.specPath], unbound.env, () => {})).toBe(0);
  rmSync(unbound.dir, { recursive: true, force: true });
});

test("status detects a tampered knowledge chain (exit 1, BROKEN)", async () => {
  const { env, dir, specPath } = provisioned();
  await watchCommand(["run", "--spec", specPath], env, () => {});
  const statePath = join(dir, "watch", "sdk-watcher.state.jsonl");
  const entry = JSON.parse(readFileSync(statePath, "utf8").trim());
  entry.payload.ok = true; // rewrite history: the failure never happened
  writeFileSync(statePath, JSON.stringify(entry) + "\n");
  const lines: string[] = [];
  expect(await watchCommand(["status", "--spec", specPath], env, (l) => lines.push(l))).toBe(1);
  expect(lines.join("\n")).toContain("BROKEN");
  rmSync(dir, { recursive: true, force: true });
});

test("NOTIFY mode: unset webhook env fails closed before firing", async () => {
  const { env, dir, specPath } = provisioned({
    deliver: "notify",
    notifyWebhookEnv: "MY_HOOK",
  });
  const lines: string[] = [];
  // env.MY_HOOK is unset → refuse before running.
  expect(await watchCommand(["run", "--spec", specPath], env, (l) => lines.push(l))).toBe(1);
  expect(lines.join("\n")).toContain("MY_HOOK");
  expect(lines.join("\n")).toContain("(fail-closed)");
  rmSync(dir, { recursive: true, force: true });
});

const RELEASES = JSON.stringify([
  { tag_name: "v2.0.0", name: "v2", html_url: "https://github.com/acme/sdk/releases/tag/v2.0.0" },
  { tag_name: "v1.0.0", name: "v1", html_url: "https://github.com/acme/sdk/releases/tag/v1.0.0" },
]);

/** A sandbox that serves canned `gh api` output and records other commands. */
class CannedSandbox {
  constructor(private readonly readJson: string) {}
  isolation() {
    return { kind: "canned", boundary: "none — test fixture", vmGrade: false };
  }
  spawn(spec: { sessionId: string }) {
    return Promise.resolve({ id: `cn-${spec.sessionId}`, sessionId: spec.sessionId });
  }
  exec(_h: { id: string }, command: readonly string[]) {
    const cmd = command.join(" ");
    if (cmd.includes("gh api")) return Promise.resolve({ exitCode: 0, stdout: this.readJson, stderr: "" });
    return Promise.resolve({ exitCode: 0, stdout: "ok", stderr: "" });
  }
  teardown() {
    return Promise.resolve();
  }
}

test("NOTIFY mode: unset webhook fails closed; on a good read it posts once, records iff delivered, and never journals the webhook", async () => {
  const { env, dir, specPath, paths } = provisioned({
    deliver: "notify",
    notifyWebhookEnv: "MY_HOOK",
    maxActionsPerRun: 5,
  });
  const sandbox = new CannedSandbox(RELEASES) as unknown as import("agp/src/contracts/sandbox-provider.ts").SandboxProvider;

  // Webhook env unset → refuse before firing.
  expect(await watchCommand(["run", "--spec", specPath], env, () => {}, { sandbox })).toBe(1);

  // Webhook set → post once (batched), record both, exit 0.
  const posts: Array<{ url: string; body: string }> = [];
  const poster = (url: string, body: string) => {
    posts.push({ url, body });
    return Promise.resolve({ ok: true, status: 200 });
  };
  const hook = "https://hooks.slack.com/services/T/B/secret";
  const notifyEnv = { ...env, MY_HOOK: hook };
  const lines: string[] = [];
  expect(await watchCommand(["run", "--spec", specPath], notifyEnv, (l) => lines.push(l), { sandbox, poster })).toBe(0);
  expect(posts).toHaveLength(1); // ONE batched message, not one per item
  expect(posts[0]!.url).toBe(hook);
  expect(posts[0]!.body).toContain("2 new on `acme/sdk`");
  expect(lines.join("\n")).toContain("2 notified via MY_HOOK");

  // Journal recorded the read (allow), NO issue-create, and never the webhook.
  const journal = readFileSync(paths.journal, "utf8");
  expect(journal).toContain("gh_read");
  expect(journal).not.toContain("gh_issue_create");
  expect(journal).not.toContain("hooks.slack.com");

  // Second run over the same releases → dedup → nothing new, no post.
  posts.length = 0;
  const l2: string[] = [];
  expect(await watchCommand(["run", "--spec", specPath], notifyEnv, (x) => l2.push(x), { sandbox, poster })).toBe(0);
  expect(posts).toHaveLength(0);
  expect(l2.join("\n")).toContain("0 notified");
  rmSync(dir, { recursive: true, force: true });
});

test("NOTIFY mode: a failed post does NOT record the items (they re-fire) and does NOT trip the failure bound", async () => {
  const { env, dir, specPath } = provisioned({
    deliver: "notify",
    notifyWebhookEnv: "MY_HOOK",
  });
  const sandbox = new CannedSandbox(RELEASES) as unknown as import("agp/src/contracts/sandbox-provider.ts").SandboxProvider;
  const notifyEnv = { ...env, MY_HOOK: "https://hooks.slack.com/services/T/B/secret" };
  const failing = () => Promise.resolve({ ok: false, status: 500 });

  const lines: string[] = [];
  // Read ok but post fails → exit 2 (degraded), items NOT recorded.
  expect(await watchCommand(["run", "--spec", specPath], notifyEnv, (l) => lines.push(l), { sandbox, poster: failing })).toBe(2);
  expect(lines.join("\n")).toContain("POST FAILED");

  // Next run re-surfaces the same items (they were never recorded) and the run
  // that failed delivery did NOT count as a failure (read was ok) → no refusal.
  const ok: Array<unknown> = [];
  const okPoster = (_u: string, _b: string) => {
    ok.push(1);
    return Promise.resolve({ ok: true, status: 200 });
  };
  expect(await watchCommand(["run", "--spec", specPath], notifyEnv, () => {}, { sandbox, poster: okPoster })).toBe(0);
  expect(ok.length).toBe(1); // re-fired and delivered on the retry
  rmSync(dir, { recursive: true, force: true });
});

test("unknown subcommand and slack-without-live fail closed", async () => {
  const lines: string[] = [];
  expect(await watchCommand(["prowl"], home().env, (l) => lines.push(l))).toBe(1);
  expect(lines.join("\n")).toContain("unknown subcommand");

  const { env, dir, specPath } = provisioned();
  const slackEnv = {
    ...env,
    AGP_CHANNEL: "slack",
    AGP_SLACK_BOT_TOKEN: "xoxb-test",
    AGP_SLACK_APP_TOKEN: "xapp-test",
    AGP_SLACK_CHANNEL: "C123",
  };
  const slackLines: string[] = [];
  expect(await watchCommand(["run", "--spec", specPath], slackEnv, (l) => slackLines.push(l))).toBe(1);
  expect(slackLines.join("\n")).toContain("AGP_SLACK_LIVE");
  rmSync(dir, { recursive: true, force: true });
});
