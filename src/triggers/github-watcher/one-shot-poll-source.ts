// OneShotPollSource — the Slice-0 concrete TriggerSource (agp-eva.1.5). The
// cadence lives in the OS (cron / notify-lib spine calls `agp watch run` per
// tick); each invocation is ONE poll firing, emitted through the frozen
// trigger-source contract so the daemon-facing shape is exercised for real from
// the first slice. A resident scheduler can replace this without touching the
// contract or the watcher.
//
// FAIL-CLOSED (contract requirement): `start()` on an `enabled: false` spec is
// a no-op — a disabled source never emits.

import { randomUUID } from "node:crypto";
import type {
  TriggerEvent,
  TriggerHeartbeat,
  TriggerSource,
  TriggerSourceSpec,
} from "agp/src/contracts/trigger-source.ts";

export interface OneShotPollSourceOptions {
  sourceSpec: TriggerSourceSpec;
  /** ISO time of the source's most recent state-log run (liveness sample). */
  lastEventAt: string | null;
  /** Consecutive-failure count from the state log (restart-intensity sample). */
  restartCount: number;
  now?: () => string;
  /** Injectable id minting for deterministic tests. */
  mintId?: () => string;
}

export class OneShotPollSource implements TriggerSource {
  private readonly opts: OneShotPollSourceOptions;
  private started = false;
  private emitted: TriggerEvent | null = null;

  constructor(opts: OneShotPollSourceOptions) {
    this.opts = opts;
  }

  spec(): TriggerSourceSpec {
    return this.opts.sourceSpec;
  }

  async start(emit: (event: TriggerEvent) => Promise<void>): Promise<void> {
    if (!this.opts.sourceSpec.enabled) return; // fail-closed: disabled never emits
    if (this.started) return;
    this.started = true;
    const mint = this.opts.mintId ?? randomUUID;
    const now = this.opts.now ?? (() => new Date().toISOString());
    const event: TriggerEvent = {
      triggerId: mint(),
      source: this.opts.sourceSpec.id,
      kind: "poll",
      firedAt: now(),
      // Cross-chain causal pointer (invariant 1): minted at the firing, stamped
      // into the action journal AND the knowledge state log for this run.
      correlationId: mint(),
      dedupeKey: null, // the tick has no natural dedup key; items dedupe downstream
      sessionId: null,
      payload: {},
    };
    this.emitted = event;
    await emit(event);
  }

  stop(): Promise<void> {
    this.started = false;
    return Promise.resolve();
  }

  heartbeat(): TriggerHeartbeat {
    return {
      sourceId: this.opts.sourceSpec.id,
      running: this.started,
      lastEventAt: this.emitted?.firedAt ?? this.opts.lastEventAt,
      restartCount: this.opts.restartCount,
    };
  }
}
