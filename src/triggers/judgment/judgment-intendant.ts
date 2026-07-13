// judgment-intendant.ts — the JudgmentIntendant: carries ONE governed judgment
// ("grounded & worth-a-human?", cited to qmd://) through AGP's mediated-run loop.
// Mirrors GithubWatcherIntendant: it holds no executor — the daemon proxy-executes
// every tool call through mediate(). It emits a `brain_search` read (policy allow)
// then a `deliver_judgment` action (policy REQUIRE -> HITL -> signed approval). The
// verdict is precomputed by the composition layer (retrieval + eval stack); the
// intendant carries it through the governance gate so a human decides WITH the
// qmd:// evidence. Outcome is read purely from the delivered message.kind:
// tool_call_result ok -> actioned (approved+executed); policy_verdict -> suppressed
// (denied / no-human fail-closed).
import type { GatewayMessage, ToolCallRequest } from "agp/src/contracts/gateway-message.ts";
import type { IntendantAdapter, IntendantIdentity, ToolCallHandler } from "agp/src/contracts/intendant-adapter.ts";

/** A precomputed governed judgment over one event (question). */
export interface Judgment {
  /** The event / benchmark question judged. */
  question: string;
  /** Grounded in the brain (deterministic gold) AND cites at least one qmd:// nugget. */
  grounded: boolean;
  /** Grounded AND the panel says it is worth surfacing to a human. */
  worthAHuman: boolean;
  /** The qmd://kb-curated citations the judgment rests on (>=1 when grounded). */
  citations: readonly string[];
  /** One-line rationale carried into the delivered body. */
  rationale: string;
}

export type JudgmentOutcome = "actioned" | "suppressed" | "crashed";

export class JudgmentIntendant implements IntendantAdapter {
  readonly identity: IntendantIdentity;
  /** Terminal outcome of the mediated run (set by run()). */
  outcome: JudgmentOutcome = "crashed";
  private handler: ToolCallHandler | null = null;
  private sessionId = "";
  private readonly pending = new Map<string, (m: GatewayMessage) => void>();

  constructor(
    private readonly judgment: Judgment,
    /** stable id (e.g. sha256(question) prefix) for the intendant identity + tool-call ids */
    private readonly id: string,
  ) {
    this.identity = { name: `judgment/${id}`, version: "0.1.0", uri: null };
  }

  start(sessionId: string): Promise<void> {
    this.sessionId = sessionId;
    return Promise.resolve();
  }

  onToolCall(handler: ToolCallHandler): void {
    this.handler = handler;
  }

  deliver(message: GatewayMessage): Promise<void> {
    if (message.kind === "tool_call_result" || message.kind === "policy_verdict") {
      const resolve = this.pending.get(message.id);
      if (resolve) {
        this.pending.delete(message.id);
        resolve(message);
      }
    }
    return Promise.resolve();
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }

  /** Emit one tool call and await its delivered result (serial — no read-modify race). */
  private call(callId: string, tool: string, command: string): Promise<GatewayMessage> {
    if (!this.handler) throw new Error("no tool-call handler registered");
    const req: ToolCallRequest = {
      kind: "tool_call_request",
      id: callId,
      sessionId: this.sessionId,
      tool,
      args: { command },
      actor: "claude_process",
    };
    const p = new Promise<GatewayMessage>((resolve) => this.pending.set(callId, resolve));
    this.handler(req);
    return p;
  }

  async run(sessionId: string): Promise<void> {
    this.sessionId = sessionId;
    // 1. RETRIEVAL leg — a governed read (policy: allow -> journaled). Fail-closed if
    //    the read did not come back as a result.
    const read = await this.call(`${this.id}:retrieve`, "brain_search", `brain_search ${JSON.stringify(this.judgment.question)}`);
    if (read.kind !== "tool_call_result") {
      this.outcome = "suppressed";
      return;
    }
    // 2. DELIVER leg — the consequential action (policy: REQUIRE -> Slack HITL ->
    //    signed approval). Carry the verdict + rationale + qmd:// citations so the
    //    human decides WITH the evidence.
    const body = `[worth-a-human] ${this.judgment.question} :: ${this.judgment.rationale} :: cites ${this.judgment.citations.join(",")}`;
    const act = await this.call(`${this.id}:deliver`, "deliver_judgment", `deliver ${JSON.stringify(body)}`);
    this.outcome = act.kind === "tool_call_result" && act.ok ? "actioned" : "suppressed";
  }
}
