// Template test pack — UNIT layer. The template's shipped artifacts are valid:
// the example spec parses (and is inert by default), the policy snippet parses.

import { test, expect } from "bun:test";
import { join } from "node:path";
import { loadWatcherSpec } from "../../../src/triggers/github-watcher/watcher-spec.ts";
import { PolicyFile } from "agp/src/policy/engine.ts";

const HERE = join(import.meta.dir, "..");

test("the shipped example spec parses and is DISABLED by default (fail-closed template)", () => {
  const spec = loadWatcherSpec(join(HERE, "watcher.spec.json"));
  expect(spec.id).toBe("example-sdk-watcher");
  expect(spec.enabled).toBe(false); // copying the template must never start a watcher
  expect(spec.humanCommit.method).toBe("manual");
});

test("the shipped policy snippet is a valid PolicyFile with the two watcher rules", async () => {
  const raw = await Bun.file(join(HERE, "policy.snippet.json")).json();
  const file = PolicyFile.parse(raw);
  const byId = Object.fromEntries(file.rules.map((r) => [r.id, r]));
  expect(byId["watcher-gh-read"]!.effect).toBe("allow");
  expect(byId["watcher-gh-issue-create"]!.effect).toBe("require");
});
