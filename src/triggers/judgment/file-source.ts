// file-source.ts — the default JudgmentSource for `bob judge`: reads a seeded
// brain's retrieval + the composed eval report (Phase 1 + Phase 2 artifacts) off
// disk and shapes each into a governed judgment + metrics. Keeps the CLI honest —
// retrieval + eval are produced by the composition tooling (brain_search + the eval
// stack) and consumed here; the governance loop stays pure Bob/AGP code.
import { readFileSync } from "node:fs";
import type { Judgment } from "./judgment-intendant.ts";
import type { JudgmentMetrics, JudgmentSource } from "../../cli/commands/judge.ts";

interface RetrievalItem {
  idx: number;
  question: string;
  hits: Array<{ citation: string }>;
}
interface ReportRow {
  idx: number;
  colA?: { gold_label?: boolean | null; sf_recall?: number | null };
  colB?: { poll_verdict?: boolean | null; faithfulness?: number | null; alce?: unknown; panel_size?: number };
}

export function fileJudgmentSource(opts: {
  retrievalPath: string;
  reportPath: string;
  jrigPath?: string;
  limit?: number;
}): JudgmentSource {
  const retrieval = JSON.parse(readFileSync(opts.retrievalPath, "utf8")) as RetrievalItem[];
  const report = JSON.parse(readFileSync(opts.reportPath, "utf8")) as { rows: ReportRow[] };
  const jrig = opts.jrigPath
    ? (JSON.parse(readFileSync(opts.jrigPath, "utf8")) as { binary?: string; jrig_decision?: string; ground_truth?: boolean })
    : { binary: "allow", jrig_decision: "ship", ground_truth: false };
  const byIdx = new Map<number, ReportRow>(report.rows.map((r) => [r.idx, r]));
  const items = retrieval.slice(0, opts.limit ?? retrieval.length);
  const byQuestion = new Map<string, RetrievalItem>(items.map((it) => [it.question, it]));

  return {
    candidates: () => items.map((it) => it.question),
    judge: (question: string) => {
      const item = byQuestion.get(question);
      const row: ReportRow = (item ? byIdx.get(item.idx) : undefined) ?? { idx: -1 };
      const citations = (item?.hits ?? [])
        .map((h) => h.citation)
        .filter((c) => /^qmd:\/\/kb-curated\//.test(c));
      const grounded = row.colA?.gold_label === true && citations.length > 0;
      const pollVerdict = row.colB?.poll_verdict;
      // worth-a-human: grounded AND the panel says yes (or the panel was skipped
      // keyless, in which case a grounded verdict is the honest floor).
      const worthAHuman = grounded && (pollVerdict === true || (pollVerdict == null && grounded));
      const judgment: Judgment = {
        question,
        grounded,
        worthAHuman,
        citations,
        rationale: `grounded=${grounded} via ${citations.length} qmd:// cites`,
      };
      const metrics: JudgmentMetrics = {
        deterministic: { gold_label: row.colA?.gold_label ?? null, sf_recall: row.colA?.sf_recall ?? null },
        panel: {
          poll_verdict: row.colB?.poll_verdict ?? null,
          faithfulness: row.colB?.faithfulness ?? null,
          alce: row.colB?.alce ?? null,
          panel_size: row.colB?.panel_size ?? 0,
        },
        gate: {
          binary: jrig.binary === "block" ? "block" : "allow",
          jrig_decision: jrig.jrig_decision ?? "ship",
          ground_truth: Boolean(jrig.ground_truth),
        },
      };
      return Promise.resolve({ judgment, metrics });
    },
  };
}
