// GithubWatcherIntendant — the Slice-0 first governed agent (agp-eva.1.5, per
// intent-os 030-AT-DECR). A deterministic RunnableIntendant: it holds NO
// executor of its own — every read AND every write it attempts is a tool call
// the daemon proxy-executes through `mediate()` (policy gate → HITL → signed
// journal → sandbox exec). The watcher decides WHAT to ask; the plane decides
// WHETHER it happens. "The model proposes; the deterministic system decides and
// records" — and this agent isn't even a model: judgment is a deterministic
// diff against the hash-chained state log, honest about what Slice 0 is.
//
// One run:
//   1. READ  — `gh api` for the watched repo's releases/commits (`gh_read`,
//              policy: allow — journaled + sandbox-executed).
//   2. DIFF  — items whose dedupeKey the state log has never observed, oldest
//              first, capped at maxActionsPerRun (throttle, don't drop).
//   3. ACT   — per new item, `gh issue create` on the OWNED issueRepo
//              (`gh_issue_create`, policy: require — Slack HITL approves/denies).
//              Approved+executed → observed as "actioned"; denied → observed as
//              "suppressed" (the operator said no once; the watcher never nags);
//              executed-but-failed → NOT observed (retried next run).
//
// FAIL-CLOSED: a failed or unparseable read ends the run with zero actions and
// a recorded failure — the watcher never guesses at what it could not observe.

import type { GatewayMessage, ToolCallRequest } from "agp/src/contracts/gateway-message.ts";
import type { IntendantAdapter, IntendantIdentity, ToolCallHandler } from "agp/src/contracts/intendant-adapter.ts";
import type { WatcherSpec } from "./watcher-spec.ts";
import type { WatcherStateLog } from "./state-log.ts";

/** One watchable item derived from the GitHub API read. */
export interface WatchItem {
  /** Dedupe key: `release:<tag>` or `commit:<sha>`. */
  key: string;
  title: string;
  url: string;
}

export interface WatcherRunSummary {
  /** Did the read execute AND parse? False = failure (fail-closed, no actions). */
  readOk: boolean;
  /** Why the run failed, when readOk is false. */
  failureReason: string | null;
  /** Items the read returned. */
  candidates: number;
  /** Never-observed items, oldest first (before the action cap). */
  newKeys: string[];
  /** Items whose issue-create was approved and executed (issue mode). */
  actioned: string[];
  /** Items the human denied (suppressed — never re-asked; issue mode). */
  suppressed: string[];
  /**
   * NOTIFY mode: the capped new items to project to the notification channel.
   * The intendant does NOT record these — the CLI records them as seen ONLY
   * after a successful post (recorded-iff-delivered), so a dropped notification
   * re-fires next run instead of being silently lost.
   */
  toNotify: WatchItem[];
}

/** `sh -c` command for the poll read. */
export function buildReadCommand(spec: WatcherSpec): string {
  const auth = spec.ghTokenSecret ? `env GH_TOKEN={{secret:${spec.ghTokenSecret}}} ` : "";
  if (spec.watch === "releases") {
    return `${auth}gh api 'repos/${spec.repo}/releases?per_page=${spec.pollLimit}'`;
  }
  return `${auth}gh api 'repos/${spec.repo}/commits?sha=${spec.branch}&per_page=${spec.pollLimit}'`;
}

/** `sh -c` command for the consequential action (require-verdict, HITL-gated). */
export function buildIssueCommand(spec: WatcherSpec, item: WatchItem): string {
  const auth = spec.ghTokenSecret ? `env GH_TOKEN={{secret:${spec.ghTokenSecret}}} ` : "";
  const title = `${spec.issueTitlePrefix} ${item.title}`.replaceAll("'", "'\\''");
  const body = `Observed by the ${spec.id} watcher on ${spec.repo}: ${item.url}`.replaceAll("'", "'\\''");
  return `${auth}gh issue create -R ${spec.issueRepo} --title '${title}' --body '${body}'`;
}

/**
 * Parse the GitHub API JSON into watch items. DEFENSIVE: throws on anything
 * that is not the expected shape — a malformed read is a failure, not a guess.
 */
export function parseWatchItems(spec: WatcherSpec, raw: unknown): WatchItem[] {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new Error("read returned no output");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("read output is not JSON");
  }
  if (!Array.isArray(parsed)) throw new Error("read output is not a JSON array");
  const items: WatchItem[] = [];
  parsed.forEach((entry, i) => {
    if (typeof entry !== "object" || entry === null) throw new Error(`item ${i} is not an object`);
    const rec = entry as Record<string, unknown>;
    if (spec.watch === "releases") {
      // Meaningfulness filter (non-spam), applied BEFORE tag validation: a draft
      // is never a real release (and GitHub drafts may legitimately have NO
      // tag_name, so validating first would crash the whole read on one), and a
      // prerelease/RC is noise unless the spec opts in. Dropped items are NOT
      // candidates — they never reach the state log, so a later promotion of the
      // same tag to a full release still surfaces.
      if (rec.draft === true) return;
      if (rec.prerelease === true && !spec.includePrereleases) return;
      // A KEPT release must have a tag (a full release always does; a tagless one
      // is genuinely malformed → fail closed).
      const tag = rec.tag_name;
      if (typeof tag !== "string" || tag.length === 0) throw new Error(`item ${i} has no tag_name`);
      const name = typeof rec.name === "string" && rec.name.length > 0 ? rec.name : tag;
      const url = typeof rec.html_url === "string" ? rec.html_url : `https://github.com/${spec.repo}/releases/tag/${tag}`;
      items.push({ key: `release:${tag}`, title: `${spec.repo} release ${name}`, url });
      return;
    }
    const sha = rec.sha;
    if (typeof sha !== "string" || sha.length === 0) throw new Error(`item ${i} has no sha`);
    const commit = rec.commit as Record<string, unknown> | undefined;
    const message = typeof commit?.message === "string" ? (commit.message.split("\n")[0] ?? sha) : sha;
    const url = typeof rec.html_url === "string" ? rec.html_url : `https://github.com/${spec.repo}/commit/${sha}`;
    items.push({ key: `commit:${sha}`, title: `${spec.repo}@${spec.branch}: ${message}`, url });
  });
  return items;
}

export class GithubWatcherIntendant implements IntendantAdapter {
  readonly identity: IntendantIdentity;
  readonly summary: WatcherRunSummary = {
    readOk: false,
    failureReason: null,
    candidates: 0,
    newKeys: [],
    actioned: [],
    suppressed: [],
    toNotify: [],
  };

  private readonly spec: WatcherSpec;
  private readonly state: WatcherStateLog;
  private readonly correlationId: string;
  private handler: ToolCallHandler | null = null;
  private sessionId = "";
  private readonly pending = new Map<string, (msg: GatewayMessage) => void>();

  constructor(spec: WatcherSpec, state: WatcherStateLog, correlationId: string) {
    this.spec = spec;
    this.state = state;
    this.correlationId = correlationId;
    this.identity = { name: `github-watcher/${spec.id}`, version: "0.1.0", uri: null };
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

  /** Emit one tool call and await what the plane delivers back for it. */
  private call(id: string, tool: string, command: string): Promise<GatewayMessage> {
    if (!this.handler) throw new Error("no tool-call handler registered");
    const req: ToolCallRequest = {
      kind: "tool_call_request",
      id,
      sessionId: this.sessionId,
      tool,
      args: { command },
      actor: "claude_process",
    };
    const result = new Promise<GatewayMessage>((resolve) => this.pending.set(id, resolve));
    this.handler(req);
    return result;
  }

  /** Drive one watch run to completion (read → diff → gated actions). */
  async run(sessionId: string): Promise<void> {
    this.sessionId = sessionId;
    const cid = this.correlationId;

    const readMsg = await this.call(`${cid}:read`, "gh_read", buildReadCommand(this.spec));
    if (readMsg.kind !== "tool_call_result" || !readMsg.ok) {
      this.summary.failureReason =
        readMsg.kind === "policy_verdict" ? `read refused: ${readMsg.verdict.reason}` : "read execution failed";
      return; // fail-closed: nothing observed, nothing acted on
    }

    let items: WatchItem[];
    try {
      items = parseWatchItems(this.spec, readMsg.output);
    } catch (err) {
      this.summary.failureReason = `read unparseable: ${(err as Error).message}`;
      return; // fail-closed: a guess is worse than a recorded failure
    }
    this.summary.readOk = true;
    this.summary.candidates = items.length;

    // GitHub returns newest first; act oldest-first so the backlog drains in
    // chronological order across runs. Cap per run — throttle, never drop.
    const fresh = items
      .slice()
      .reverse()
      .filter((it) => !this.state.has(it.key));
    this.summary.newKeys = fresh.map((it) => it.key);
    const capped = fresh.slice(0, this.spec.maxActionsPerRun);

    // NOTIFY mode: no GitHub write, so no `require`/HITL — just surface the
    // capped items for the CLI to project and record-iff-delivered. The read
    // above was still governed (allow → sandbox → journal).
    if (this.spec.deliver === "notify") {
      this.summary.toNotify = capped;
      return;
    }

    // ISSUE mode: each new item is a `require`-gated, HITL-approved issue-create.
    for (const item of capped) {
      const msg = await this.call(`${cid}:act:${item.key}`, "gh_issue_create", buildIssueCommand(this.spec, item));
      if (msg.kind === "tool_call_result" && msg.ok) {
        // Approved + executed: observed as actioned (dedupes forever).
        this.state.append("observed", { key: item.key, outcome: "actioned", correlationId: cid });
        this.summary.actioned.push(item.key);
      } else if (msg.kind === "policy_verdict") {
        // Denied (or no decision → fail-closed deny): observed as suppressed —
        // the operator said no once; the watcher does not nag.
        this.state.append("observed", { key: item.key, outcome: "suppressed", correlationId: cid });
        this.summary.suppressed.push(item.key);
      }
      // Executed-but-failed (result ok:false): NOT observed — retried next run.
    }
  }
}
