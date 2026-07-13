// WatcherStateLog — the watcher's hash-chained KNOWLEDGE receipt log
// (agp-eva.1.2 substrate). Append-only JSONL where each entry's `hash` covers
// `prevHash ‖ canonicalJson(entry sans hash)` — the same chain discipline as the
// signed action journal, WITHOUT signing (this is the "what it knew" chain; the
// Ed25519-signed journal is the "what it did" chain; GSB's receipt store swaps
// in behind this same shape at extraction, per intent-os 030-AT-DECR).
//
// CROSS-CHAIN CAUSAL POINTER (invariant 1): `tipHash()` at decision time is
// stamped into the action journal's `trigger.fired` / `trigger.settled` events
// together with the shared `correlationId`, so "what did the watcher know at the
// moment it acted?" is answerable offline: walk this chain to the stamped tip.
//
// Dedup ("same SHA twice → no re-alert"): an item is `observed` exactly once —
// whether the human APPROVED (actioned) or DENIED (suppressed; the operator said
// no once, the watcher does not nag) — and `has(key)` filters future runs.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { IsoTimestamp, Sha256Hex } from "agp/src/contracts/_common.ts";
import { canonicalJson, sha256Hex } from "agp/src/runtime/crypto.ts";

export const StateEntryKind = z.enum(["run", "observed", "enable"]);
export type StateEntryKind = z.infer<typeof StateEntryKind>;

export const StateEntry = z
  .object({
    v: z.literal(1),
    seq: z.number().int().positive(),
    ts: IsoTimestamp,
    kind: StateEntryKind,
    /** Structured, secret-free payload (keys, outcomes, correlation ids). */
    payload: z.record(z.string(), z.unknown()),
    prevHash: Sha256Hex.nullable(),
    hash: Sha256Hex,
  })
  .strict();
export type StateEntry = z.infer<typeof StateEntry>;

export function readStateEntries(path: string): StateEntry[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((line) => StateEntry.parse(JSON.parse(line)));
}

/** Walk the chain; return the errors found (empty = intact). */
export function verifyStateLog(path: string): string[] {
  const errors: string[] = [];
  const entries = readStateEntries(path);
  let prevHash: string | null = null;
  entries.forEach((e, i) => {
    if (e.seq !== i + 1) errors.push(`entry ${i + 1}: seq ${e.seq} breaks monotonic sequence`);
    if (e.prevHash !== prevHash) errors.push(`entry ${e.seq}: prevHash does not match prior entry`);
    const { hash, ...sansHash } = e;
    const expected = sha256Hex((e.prevHash ?? "") + canonicalJson(sansHash));
    if (hash !== expected) errors.push(`entry ${e.seq}: hash mismatch (content altered)`);
    prevHash = e.hash;
  });
  return errors;
}

export class WatcherStateLog {
  private readonly path: string;
  private readonly now: () => string;
  private entries: StateEntry[];

  constructor(path: string, now: () => string = () => new Date().toISOString()) {
    this.path = path;
    this.now = now;
    this.entries = readStateEntries(path);
  }

  /** SHA-256 tip of the knowledge chain; null before the first entry. */
  tipHash(): string | null {
    const last = this.entries[this.entries.length - 1];
    return last ? last.hash : null;
  }

  append(kind: StateEntryKind, payload: Record<string, unknown>): StateEntry {
    const last = this.entries[this.entries.length - 1];
    const unsealed = {
      v: 1 as const,
      seq: (last?.seq ?? 0) + 1,
      ts: this.now(),
      kind,
      payload,
      prevHash: last ? last.hash : null,
    };
    const hash = sha256Hex((unsealed.prevHash ?? "") + canonicalJson(unsealed));
    const entry = StateEntry.parse({ ...unsealed, hash });
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, JSON.stringify(entry) + "\n");
    this.entries.push(entry);
    return entry;
  }

  /** Has this dedupe key ever been observed (actioned OR suppressed)? */
  has(dedupeKey: string): boolean {
    return this.entries.some((e) => e.kind === "observed" && e.payload.key === dedupeKey);
  }

  /** ISO time of the most recent run; null if the watcher has never run. */
  lastRunAt(): string | null {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i]!;
      if (e.kind === "run") return e.ts;
    }
    return null;
  }

  /**
   * Consecutive failed runs counted from the tail (restart-intensity input).
   * An `enable` entry breaks the streak — a human re-enable resets the bound.
   */
  consecutiveFailures(): number {
    let n = 0;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i]!;
      if (e.kind === "enable") break;
      if (e.kind !== "run") continue;
      if (e.payload.ok === true) break;
      n++;
    }
    return n;
  }
}
