// `bob judge` — the Layer-1 governed-judgment loop (109-AT-DECR Phase 3; 108 §12).
// Per tick: event (a question) -> qmd retrieval over the brain -> judgment
// ("grounded & worth-a-human?", cited to qmd://) -> daemon.runMediated (policy gate
// -> HITL -> signed journal) -> composed metrics -> deliver. Mirrors watch.ts and
// reuses the SAME cross-chain-pointer + state-log dedup invariants.
//
// The retrieval + eval stack are provided by an injectable JudgmentSource: the CLI
// wires a file-backed source (reading the seeded brain's retrieval + the composed
// eval report); tests inject a fixture source, so the whole governance loop is
// exercised hermetically. The GOVERNANCE (mediate + signed journal + dedup) is
// entirely AGP/Bob code; only retrieval/eval cross the boundary.
//
// Review-mandated invariants (each proven load-bearing in the §12 acceptance):
//  - the cross-chain pointer is a TOP-LEVEL correlation_id + gsb_receipt_tip_hash on
//    every leaf event (nested payload.correlationId is NOT reconstructable);
//  - the dedupe key is sha256(question) — STABLE, never the LLM-chosen citations;
//  - deterministic (colA) and probabilistic (colB) are TWO SEPARATE journal events.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { resolvePaths } from "agp/src/config.ts";
import { loadPrivateKey } from "agp/src/runtime/crypto.ts";
import { Journal } from "agp/src/journal/journal.ts";
import { PolicyEngine, type PolicyRule } from "agp/src/policy/engine.ts";
import { RecordingSandbox } from "agp/src/runtime/sandbox.ts";
import { ConsoleChannel } from "agp/src/runtime/channel.ts";
import { Daemon } from "agp/src/daemon/daemon.ts";
import { FileSessionStore } from "agp/src/daemon/session-store.ts";
import { loadEd25519Verifier } from "agp/src/verify/ed25519-verifier.ts";
import { defaultTenantContext } from "agp/src/tenants/tenant.ts";
import { WatcherStateLog } from "../../triggers/github-watcher/state-log.ts";
import { type Judgment, JudgmentIntendant } from "../../triggers/judgment/judgment-intendant.ts";

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

/** Composed-eval metrics for one judgment — deterministic (A) and probabilistic (B)
 *  kept structurally apart, plus the JRig gate. */
export interface JudgmentMetrics {
  deterministic: { gold_label: boolean | null; sf_recall: number | null };
  panel: { poll_verdict: boolean | null; faithfulness: number | null; alce: unknown; panel_size: number };
  gate: { binary: "allow" | "block"; jrig_decision: string; ground_truth: boolean };
}

/** Injectable retrieval + evaluation. Production: file/shell-backed. Tests: fixtures. */
export interface JudgmentSource {
  /** The events (questions) to judge this tick. */
  candidates(): readonly string[];
  /** Retrieve + evaluate one question into a governed judgment + composed metrics. */
  judge(question: string): Promise<{ judgment: Judgment; metrics: JudgmentMetrics }>;
}

export interface JudgeDeps {
  source: JudgmentSource;
  /** Test override for the daemon's sandbox/channel; default is reference mode. */
  autoApprove?: boolean;
}

export interface JudgeResult {
  code: number;
  delivered: number;
  suppressed: number;
  runs: Array<{ question: string; correlationId: string; delivered: boolean; reason: string; citations: readonly string[] }>;
}

/**
 * Drive one governed-judgment tick over the source's candidates. Fail-closed on a
 * missing signing key / policy. `deps.source` is required (the CLI wires the default).
 */
export async function judgeCommand(
  env: Record<string, string | undefined>,
  out: (line: string) => void,
  deps: JudgeDeps,
): Promise<JudgeResult> {
  const paths = resolvePaths(env);
  if (!existsSync(paths.signingKey)) {
    out(`bob judge: signing key missing at ${paths.signingKey} — run \`bob keygen\`. (fail-closed)`);
    return { code: 1, delivered: 0, suppressed: 0, runs: [] };
  }
  let privateKey: ReturnType<typeof loadPrivateKey>;
  try {
    privateKey = loadPrivateKey(readFileSync(paths.signingKey, "utf8"));
  } catch (err) {
    out(`bob judge: cannot load signing key: ${(err as Error).message} (fail-closed)`);
    return { code: 1, delivered: 0, suppressed: 0, runs: [] };
  }

  // Policy: the retrieval read is allowed; the deliver is the consequential action
  // (require -> HITL). MERGE the operator's committed rules (for their own tools)
  // with the judgment defaults, so brain_search + deliver_judgment always carry
  // their governance rule even when the operator's policy predates the judgment
  // loop (an unmerged operator policy would default-deny deliver_judgment). The
  // policy engine is default-deny + strictest-effect, so an operator rule that
  // hardens one of these tools still wins.
  const defaults: PolicyRule[] = [
    { id: "allow-brain-search", effect: "allow", tool: "brain_search" },
    { id: "require-deliver-judgment", effect: "require", tool: "deliver_judgment" },
  ];
  let operatorRules: PolicyRule[] = [];
  if (existsSync(paths.policy)) {
    try {
      const parsed = JSON.parse(readFileSync(paths.policy, "utf8")) as { rules?: PolicyRule[] };
      operatorRules = parsed.rules ?? [];
    } catch {
      operatorRules = [];
    }
  }
  const policy = new PolicyEngine([...operatorRules, ...defaults]);

  const judgeJournal = join(paths.home, "judge.audit.log");
  const journal = new Journal(judgeJournal, privateKey);
  const sandbox = new RecordingSandbox();
  const channel = new ConsoleChannel({ AGP_AUTO_APPROVE: deps.autoApprove ? "1" : env.AGP_AUTO_APPROVE }, out);
  const sessionStore = new FileSessionStore(join(paths.home, "judge.sessions.json"));
  const verifier = loadEd25519Verifier(join(paths.home, "intendants", "ed25519.pub"));
  const daemon = new Daemon({
    policy,
    journal,
    sandbox,
    channel,
    sessionStore,
    verifier,
    identityMode: "off",
    tenantContext: defaultTenantContext(),
  });
  const state = new WatcherStateLog(join(paths.home, "judge.state.jsonl"));

  const result: JudgeResult = { code: 0, delivered: 0, suppressed: 0, runs: [] };
  for (const question of deps.source.candidates()) {
    const { judgment, metrics } = await deps.source.judge(question);
    // STABLE dedupe key — the question, NEVER the LLM-chosen citations (review fix).
    const dedupeKey = `judgment:${sha256(question)}`;
    const correlationId = randomUUID();
    const id = sha256(question).slice(0, 8);
    // knowledge tip at decision time — the bob knowledge-chain head, carried as the
    // cross-chain pointer's knowledge side (a GSB receipt tip when a real brain wires in).
    const tip = (): string => state.tipHash() ?? sha256(`genesis:${dedupeKey}`);

    // OPEN bracket — TOP-LEVEL cross-chain pointer so reconstructKnowledgeAt resolves it.
    journal.append({
      kind: "trigger.fired",
      actor: "session_owner",
      correlation_id: correlationId,
      gsb_receipt_tip_hash: tip(),
      payload: { triggerId: `judge-${id}`, source: "brain", question },
    });

    const grounded = judgment.grounded && judgment.citations.length > 0;
    const isDup = state.has(dedupeKey);
    if (!judgment.worthAHuman || !grounded || isDup) {
      const reason = isDup ? "dup" : !grounded ? "ungrounded" : "not-worth-a-human";
      state.append("observed", { key: dedupeKey, outcome: "suppressed", reason, correlationId });
      journal.append({
        kind: "trigger.settled",
        actor: "session_owner",
        correlation_id: correlationId,
        gsb_receipt_tip_hash: tip(),
        payload: { correlationId, ok: true, delivered: false, reason },
      });
      result.suppressed += 1;
      result.runs.push({ question, correlationId, delivered: false, reason, citations: judgment.citations });
      continue;
    }

    // GOVERNED delivery — mediate() gates deliver_judgment (require -> HITL -> signed approval).
    const intendant = new JudgmentIntendant(judgment, id);
    await daemon.runMediated(intendant, { networkEnabled: false });

    // Composed metrics — TWO SEPARATE events (deterministic vs probabilistic), never blended.
    journal.append({
      kind: "judgment.deterministic",
      actor: "session_owner",
      correlation_id: correlationId,
      gsb_receipt_tip_hash: tip(),
      payload: { gold_label: metrics.deterministic.gold_label, sf_recall: metrics.deterministic.sf_recall },
    });
    journal.append({
      kind: "judgment.panel",
      actor: "session_owner",
      correlation_id: correlationId,
      gsb_receipt_tip_hash: tip(),
      payload: {
        poll_verdict: metrics.panel.poll_verdict,
        faithfulness: metrics.panel.faithfulness,
        alce: metrics.panel.alce,
        panel_size: metrics.panel.panel_size,
        comparison: "validated-against-deterministic-never-blended",
      },
    });
    journal.append({
      kind: `gate.${metrics.gate.binary}`,
      actor: "session_owner",
      correlation_id: correlationId,
      gsb_receipt_tip_hash: tip(),
      payload: { jrig_decision: metrics.gate.jrig_decision, binary: metrics.gate.binary, ground_truth: metrics.gate.ground_truth },
    });

    const delivered = intendant.outcome === "actioned";
    state.append("observed", { key: dedupeKey, outcome: delivered ? "actioned" : "suppressed", correlationId });
    journal.append({
      kind: "trigger.settled",
      actor: "session_owner",
      correlation_id: correlationId,
      gsb_receipt_tip_hash: tip(),
      payload: { correlationId, ok: true, delivered, outcome: intendant.outcome },
    });
    if (delivered) {
      result.delivered += 1;
      out(`bob judge: DELIVERED (worth-a-human) — ${question} [cites ${judgment.citations.length} qmd://]`);
    } else {
      result.suppressed += 1;
    }
    result.runs.push({ question, correlationId, delivered, reason: delivered ? "actioned" : "suppressed", citations: judgment.citations });
  }

  out(`bob judge: ${result.runs.length} judged — ${result.delivered} delivered, ${result.suppressed} suppressed. journal: ${judgeJournal} (verify with \`bob verify\`).`);
  return result;
}
