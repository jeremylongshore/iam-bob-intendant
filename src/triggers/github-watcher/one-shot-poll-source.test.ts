import { test, expect } from "bun:test";
import { TriggerEvent, type TriggerSourceSpec } from "agp/src/contracts/trigger-source.ts";
import { OneShotPollSource } from "./one-shot-poll-source.ts";

const spec = (enabled: boolean): TriggerSourceSpec => ({
  id: "sdk-watcher",
  kind: "poll",
  enabled,
  livenessTimeoutMs: 60_000,
  config: { repo: "acme/sdk", watch: "releases" },
});

test("FAIL-CLOSED: start() on a disabled spec never emits", async () => {
  const source = new OneShotPollSource({ sourceSpec: spec(false), lastEventAt: null, restartCount: 0 });
  const emitted: TriggerEvent[] = [];
  await source.start(async (e) => {
    emitted.push(e);
  });
  expect(emitted).toHaveLength(0);
  expect(source.heartbeat().running).toBe(false);
});

test("an enabled source emits exactly one contract-valid poll event with a correlationId", async () => {
  let n = 0;
  const source = new OneShotPollSource({
    sourceSpec: spec(true),
    lastEventAt: null,
    restartCount: 0,
    now: () => "2026-07-10T00:00:00.000Z",
    mintId: () => `id-${++n}`,
  });
  const emitted: TriggerEvent[] = [];
  await source.start(async (e) => {
    emitted.push(e);
  });
  expect(emitted).toHaveLength(1);
  const event = TriggerEvent.parse(emitted[0]); // strict contract shape holds
  expect(event.kind).toBe("poll");
  expect(event.source).toBe("sdk-watcher");
  expect(event.correlationId.length).toBeGreaterThan(0); // invariant 1: required
  expect(event.dedupeKey).toBeNull(); // the tick has no natural key
  // Idempotent: a second start on the same one-shot does not re-emit.
  await source.start(async (e) => {
    emitted.push(e);
  });
  expect(emitted).toHaveLength(1);
});

test("heartbeat carries the state-log liveness sample before any emission", () => {
  const source = new OneShotPollSource({
    sourceSpec: spec(true),
    lastEventAt: "2026-07-09T00:00:00.000Z",
    restartCount: 2,
  });
  const hb = source.heartbeat();
  expect(hb.sourceId).toBe("sdk-watcher");
  expect(hb.lastEventAt).toBe("2026-07-09T00:00:00.000Z");
  expect(hb.restartCount).toBe(2);
});
