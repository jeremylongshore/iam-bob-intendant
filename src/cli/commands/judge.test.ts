// Hermetic tests for `bob judge` — the governed-judgment loop. No brain, no
// network: a fixture JudgmentSource feeds precomputed verdicts + metrics, and the
// whole governance path (mediate → signed journal → cross-chain pointer → dedup) is
// exercised against a temp AGP home. Asserts the 108 §12 invariants the loop must
// hold: grounded+cited delivery, top-level cross-chain pointer, reconstructable
// knowledge→action, deterministic-vs-panel separation, and ZERO duplicate alerts.
import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateSigningKeyPem } from "agp/src/runtime/crypto.ts";
import { readEvents } from "agp/src/journal/journal.ts";
import { reconstructKnowledgeAt } from "agp/src/journal/cross-chain.ts";
import { verifyJournalFile } from "agp/src/journal/verify.ts";
import { createPublicKey } from "node:crypto";
import { judgeCommand, type JudgmentSource, type JudgmentMetrics } from "./judge.ts";
import type { Judgment } from "../../triggers/judgment/judgment-intendant.ts";

function seededHome(): { home: string; env: Record<string, string>; pubPem: string } {
  const home = mkdtempSync(join(tmpdir(), "bob-judge-"));
  mkdirSync(join(home, "signing"), { recursive: true });
  const { privateKeyPem, publicKeyPem } = generateSigningKeyPem();
  writeFileSync(join(home, "signing", "journal-ed25519.key"), privateKeyPem);
  return { home, env: { AGP_HOME: home, AGP_AUTO_APPROVE: "1" }, pubPem: publicKeyPem };
}

function metrics(gold: boolean | null, poll: boolean | null): JudgmentMetrics {
  return {
    deterministic: { gold_label: gold, sf_recall: gold ? 1 : 0.5 },
    panel: { poll_verdict: poll, faithfulness: 0.75, alce: { precision: 1, recall: 0 }, panel_size: 2 },
    gate: { binary: "allow", jrig_decision: "ship", ground_truth: false },
  };
}

/** A fixture source: two worth-a-human items (grounded + panel yes) + one not-worth. */
function fixtureSource(questions: readonly string[]): JudgmentSource {
  return {
    candidates: () => questions,
    judge: (q: string) => {
      const worth = q.startsWith("WORTH");
      const j: Judgment = {
        question: q,
        grounded: worth,
        worthAHuman: worth,
        citations: worth ? ["qmd://kb-curated/abc.md", "qmd://kb-curated/def.md"] : [],
        rationale: `fixture grounded=${worth}`,
      };
      return Promise.resolve({ judgment: j, metrics: metrics(worth, worth) });
    },
  };
}

test("bob judge delivers only grounded, worth-a-human, qmd-cited verdicts (fail-closed otherwise)", async () => {
  const { home, env } = seededHome();
  const lines: string[] = [];
  const source = fixtureSource(["WORTH-1", "WORTH-2", "SKIP-3"]);
  const res = await judgeCommand(env, (l) => lines.push(l), { source, autoApprove: true });
  expect(res.code).toBe(0);
  expect(res.delivered).toBe(2); // the two WORTH items
  expect(res.suppressed).toBe(1); // SKIP-3 (not worth-a-human)
  // every delivered verdict cites qmd:// (grounded + cited); nothing ungrounded delivered
  for (const r of res.runs) {
    if (r.delivered) expect(r.citations.every((c) => c.startsWith("qmd://kb-curated/"))).toBe(true);
    else expect(r.reason === "not-worth-a-human" || r.reason === "ungrounded" || r.reason === "dup").toBe(true);
  }
  rmSync(home, { recursive: true, force: true });
});

test("every verdict is journaled with a TOP-LEVEL cross-chain pointer, and the run reconstructs (knowledge→action, non-vacuous)", async () => {
  const { home, env, pubPem } = seededHome();
  const source = fixtureSource(["WORTH-1"]);
  const res = await judgeCommand(env, () => {}, { source, autoApprove: true });
  const journalPath = join(home, "judge.audit.log");
  // the signed journal verifies with the public key
  const pub = createPublicKey(pubPem);
  expect(verifyJournalFile(journalPath, pub).ok).toBe(true);
  // reconstruct the delivered run: non-vacuous gsbReceiptTips (the top-level pointer resolves)
  const run = res.runs.find((r) => r.delivered)!;
  const events = readEvents(journalPath);
  const rec = reconstructKnowledgeAt(events, run.correlationId);
  expect(rec.gsbReceiptTips.length).toBeGreaterThan(0);
  const kinds = rec.actions.map((a) => a.kind);
  expect(kinds).toContain("trigger.fired");
  expect(kinds).toContain("judgment.deterministic");
  expect(kinds).toContain("judgment.panel");
  expect(kinds.some((k) => k.startsWith("gate."))).toBe(true);
  expect(kinds).toContain("trigger.settled");
  // negative control: a blank correlationId is fail-closed
  expect(() => reconstructKnowledgeAt(events, "  ")).toThrow();
  rmSync(home, { recursive: true, force: true });
});

test("deterministic and probabilistic metrics are journaled as SEPARATE events (never blended)", async () => {
  const { home, env } = seededHome();
  const res = await judgeCommand(env, () => {}, { source: fixtureSource(["WORTH-1"]), autoApprove: true });
  const events = readEvents(join(home, "judge.audit.log"));
  const kinds = events.map((e) => e.kind);
  expect(kinds).toContain("judgment.deterministic");
  expect(kinds).toContain("judgment.panel");
  expect(kinds.some((k) => /blend/i.test(k))).toBe(false);
  // and the two are distinct events, not one merged record
  expect(events.filter((e) => e.kind === "judgment.deterministic").length).toBe(1);
  expect(events.filter((e) => e.kind === "judgment.panel").length).toBe(1);
  void res;
  rmSync(home, { recursive: true, force: true });
});

test("consecutive ticks over the SAME event produce ZERO duplicate alerts (stable question-keyed dedup)", async () => {
  const { home, env } = seededHome();
  const source = fixtureSource(["WORTH-1", "WORTH-2"]);
  const first = await judgeCommand(env, () => {}, { source, autoApprove: true });
  expect(first.delivered).toBe(2);
  // re-run the same questions against the persisted state-log
  const second = await judgeCommand(env, () => {}, { source, autoApprove: true });
  expect(second.delivered).toBe(0); // ZERO duplicate alerts
  expect(second.runs.every((r) => r.reason === "dup")).toBe(true);
  rmSync(home, { recursive: true, force: true });
});

test("fails closed when the signing key is missing", async () => {
  const home = mkdtempSync(join(tmpdir(), "bob-judge-nokey-"));
  const lines: string[] = [];
  const res = await judgeCommand({ AGP_HOME: home }, (l) => lines.push(l), { source: fixtureSource(["WORTH-1"]) });
  expect(res.code).toBe(1);
  expect(lines.join("\n")).toContain("signing key missing");
  rmSync(home, { recursive: true, force: true });
});
