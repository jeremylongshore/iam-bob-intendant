// WatcherSpec — the committed declaration of the Slice-0 GitHub watcher
// (agp-eva.1.5; naming + supersession per intent-os 030-AT-DECR). This is the
// "Spec" stage of the deploy rule `Prompt → Spec → Tests → Policy → Deploy`.
//
// HUMAN COMMIT GATE (invariant 3, agp-eva.1.4): a spec is a VALUE a human
// deterministically committed, never something a model asserted into effect.
// The loader refuses any spec without an explicit `humanCommit` block — "the
// model proposes; the deterministic system decides and records". A future
// authoring flow may DRAFT a spec, but only a human commit makes it loadable.
//
// FAIL-CLOSED: `.strict()` schemas (an unknown key is a malformed spec, refused),
// `enabled` defaults to false (a newly written spec is inert until an operator
// enables it), and `loadWatcherSpec` throws rather than degrades.

import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { IsoTimestamp } from "agp/src/contracts/_common.ts";

/** `owner/name` — a GitHub repository reference. */
const RepoRef = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "must be a GitHub 'owner/name' repo reference");

/**
 * The explicit human commitment that makes a spec loadable. Records WHO put
 * this spec into effect and WHEN — accountability data, mirrored in spirit by
 * the journal's reserved `on_behalf_of` column (052-AR-BORD).
 */
export const HumanCommit = z
  .object({
    /** The human who committed this spec (operator handle, not a bot). */
    committedBy: z.string().min(1),
    committedAt: IsoTimestamp,
    /** v0: only manual commits exist. A future draft→review flow adds values. */
    method: z.literal("manual"),
  })
  .strict();
export type HumanCommit = z.infer<typeof HumanCommit>;

export const WatcherSpec = z
  .object({
    /** Stable source id — becomes `TriggerEvent.source` and the state-log name. */
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "must be a kebab-case id"),
    /** Fail-closed: an un-enabled spec never runs (flag-gated spike posture). */
    enabled: z.boolean().default(false),
    /** The repository being watched. */
    repo: RepoRef,
    /** What to watch: published releases, or commits on a branch. */
    watch: z.enum(["releases", "commits"]),
    /** Branch for `watch: "commits"`; null for releases. */
    branch: z.string().min(1).nullable().default(null),
    /**
     * What the agent DOES with a new item — a human-committed behavior choice:
     * - `issue`  (default): file a GitHub issue, gated by a `require` verdict +
     *   HITL approval (needs a two-way approval channel; the consequential mode).
     * - `notify`: post ONE batched summary to a one-way notification webhook and
     *   record the item as seen. No write to GitHub, so no `require`/HITL is
     *   needed — the read is still governed, and notifying yourself is not a
     *   consequential action. Safe to run unattended (no suppression trap). This
     *   is the interim mode until a two-way Slack HITL channel is wired.
     */
    deliver: z.enum(["issue", "notify"]).default("issue"),
    /**
     * `notify` mode only: the ENV VAR NAME holding the Slack incoming-webhook URL
     * (e.g. `SLACK_OPERATION_HIRED_WEBHOOK_URL`). The value stays in the
     * environment — never in this spec, never in the journal (screened) — mirroring
     * the `{{secret:NAME}}` discipline. Required when `deliver: "notify"`.
     */
    notifyWebhookEnv: z.string().min(1).nullable().default(null),
    /**
     * Where the consequential action files issues (issue mode). MUST be a repo the
     * operator owns (GC red line, 030-AT-DECR: never file issues on unowned repos)
     * — ownership is asserted by the human commit below and enforced socially +
     * by the require-verdict HITL, not guessable from here.
     */
    issueRepo: RepoRef,
    /** Prefix for created issue titles, so watcher issues are recognizable. */
    issueTitlePrefix: z.string().default("[watch]"),
    /**
     * Meaningfulness filter for `watch: "releases"` (non-spam). Drafts are ALWAYS
     * dropped (never a real release); prereleases/RCs are dropped unless this is
     * true. Default false = only full releases surface — Rhys's "don't tell me
     * about every RC" in one committed flag. No effect on `watch: "commits"`.
     */
    includePrereleases: z.boolean().default(false),
    /** How many items one poll reads (newest-first from the GitHub API). */
    pollLimit: z.number().int().positive().max(50).default(10),
    /**
     * Safety cap: at most this many require-verdict actions per run. Excess NEW
     * items stay unrecorded and surface on later runs (oldest first) — throttling,
     * not dropping.
     */
    maxActionsPerRun: z.number().int().positive().max(10).default(3),
    /**
     * Restart-intensity bound (invariant 2): after this many CONSECUTIVE failed
     * runs the runner refuses to run again until a human re-enables — a crash
     * loop escalates instead of burning quota forever.
     */
    maxConsecutiveFailures: z.number().int().positive().max(20).default(3),
    /**
     * Liveness dead-man's-switch (invariant 2): max ms of silence tolerated
     * before `agp watch status` reports STALE (exit 1). Null = not cadence-bound.
     */
    livenessTimeoutMs: z.number().int().positive().nullable().default(null),
    /**
     * Optional vault secret NAME for GitHub auth. When set, proxy-executed `gh`
     * commands are prefixed `env GH_TOKEN={{secret:NAME}} ` and the placeholder
     * resolves ONLY in the post-gate argv (034-AT-ARCH) — the token never enters
     * a GatewayMessage or the journal. Null = ambient auth (host/image `gh`).
     */
    ghTokenSecret: z.string().min(1).nullable().default(null),
    /** The human commit gate — REQUIRED; a draft without it refuses to load. */
    humanCommit: HumanCommit,
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.watch === "commits" && s.branch === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["branch"],
        message: "watch: 'commits' requires a branch",
      });
    }
    if (s.deliver === "notify" && s.notifyWebhookEnv === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["notifyWebhookEnv"],
        message: "deliver: 'notify' requires notifyWebhookEnv (the env var name holding the webhook URL)",
      });
    }
  });
export type WatcherSpec = z.infer<typeof WatcherSpec>;

/**
 * Load a committed watcher spec from disk. FAIL-CLOSED: a missing file, invalid
 * JSON, schema violation, or missing human commit throws — the runner never
 * guesses its way past a malformed declaration of authority.
 */
export function loadWatcherSpec(path: string): WatcherSpec {
  if (!existsSync(path)) throw new Error(`watcher spec not found at ${path}`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`watcher spec is not valid JSON: ${(err as Error).message}`);
  }
  return WatcherSpec.parse(raw); // throws on violation — incl. absent humanCommit
}
