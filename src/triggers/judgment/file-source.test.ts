// file-source.test.ts — the default file-backed JudgmentSource shapes a seeded
// brain's retrieval + the composed eval report into governed judgments: grounded
// requires gold_label AND a qmd:// citation; worth-a-human requires grounded AND
// the panel (or a keyless grounded floor); metrics keep colA/colB apart.
import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileJudgmentSource } from "./file-source.ts";

function fixtures(): { retrieval: string; report: string; jrig: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "bob-fsrc-"));
  const retrieval = join(dir, "retrieval.json");
  const report = join(dir, "report.json");
  const jrig = join(dir, "jrig.json");
  writeFileSync(retrieval, JSON.stringify([
    { idx: 0, question: "grounded-and-worth", hits: [{ citation: "qmd://kb-curated/a.md" }] },
    { idx: 1, question: "grounded-not-worth", hits: [{ citation: "qmd://kb-curated/b.md" }] },
    { idx: 2, question: "ungrounded", hits: [{ citation: "https://not-a-qmd" }] },
  ]));
  writeFileSync(report, JSON.stringify({
    rows: [
      { idx: 0, colA: { gold_label: true, sf_recall: 1 }, colB: { poll_verdict: true, faithfulness: 0.9, alce: { precision: 1, recall: 1 }, panel_size: 2 } },
      { idx: 1, colA: { gold_label: true, sf_recall: 1 }, colB: { poll_verdict: false, faithfulness: 0.4, alce: null, panel_size: 2 } },
      { idx: 2, colA: { gold_label: false, sf_recall: 0 }, colB: { poll_verdict: null, faithfulness: null, alce: null, panel_size: 0 } },
    ],
  }));
  writeFileSync(jrig, JSON.stringify({ binary: "allow", jrig_decision: "ship", ground_truth: false }));
  return { retrieval, report, jrig, dir };
}

test("file source maps grounded/worth-a-human + separates colA/colB metrics", async () => {
  const f = fixtures();
  const src = fileJudgmentSource({ retrievalPath: f.retrieval, reportPath: f.report, jrigPath: f.jrig });
  expect(src.candidates()).toEqual(["grounded-and-worth", "grounded-not-worth", "ungrounded"]);

  const a = await src.judge("grounded-and-worth");
  expect(a.judgment.grounded).toBe(true);
  expect(a.judgment.worthAHuman).toBe(true);
  expect(a.judgment.citations).toEqual(["qmd://kb-curated/a.md"]);
  expect(a.metrics.deterministic.gold_label).toBe(true); // colA
  expect(a.metrics.panel.poll_verdict).toBe(true); // colB — kept separate
  expect(a.metrics.gate.binary).toBe("allow");

  const b = await src.judge("grounded-not-worth");
  expect(b.judgment.grounded).toBe(true);
  expect(b.judgment.worthAHuman).toBe(false); // panel said no

  const c = await src.judge("ungrounded");
  expect(c.judgment.grounded).toBe(false); // no qmd:// citation + no gold
  expect(c.judgment.citations).toEqual([]);
  rmSync(f.dir, { recursive: true, force: true });
});

test("file source honors --limit and defaults the gate when no jrig result is given", async () => {
  const f = fixtures();
  const src = fileJudgmentSource({ retrievalPath: f.retrieval, reportPath: f.report, limit: 1 });
  expect(src.candidates().length).toBe(1);
  const a = await src.judge("grounded-and-worth");
  expect(a.metrics.gate.binary).toBe("allow"); // default when jrigPath omitted
  expect(a.metrics.gate.ground_truth).toBe(false);
  rmSync(f.dir, { recursive: true, force: true });
});
