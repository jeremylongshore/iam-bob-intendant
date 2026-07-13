// `bob watch` — the Slice-0 governed GitHub watcher (agp-eva.1.5; intent-os
// 030-AT-DECR). The cadence lives in the OS: cron (the notify-lib spine) calls
// `bob watch run --spec <file>` per tick; each tick is one TriggerEvent through
// the frozen trigger-source contract, one mediated session through the daemon,
// and one signed-journal segment bracketed by `trigger.fired` / `trigger.settled`
// events that carry the cross-chain causal pointer (correlationId + the state
// log's knowledge tip hash).
//
//   run     one poll tick: spec (human-committed, enabled) → failure-bound check
//           → TriggerEvent → runMediated (read=allow, act=require+HITL) → state
//   status  liveness dead-man's-switch: exit 1 when the source is STALE
//           (silent past livenessTimeoutMs), chain-verify the state log
//   enable  human re-commit after a restart-intensity refusal: verifies the spec
//           and appends an `enable` state entry (resets the failure streak)
//
// Wiring mirrors `agp run` and fails closed the same ways: missing signing key /
// policy refuses; AGP_SANDBOX=docker refuses without Docker + pinned image;
// AGP_CHANNEL=slack refuses without live Socket Mode. Reference mode (recording
// sandbox) executes nothing, so a reference read parses nothing and the run
// records an HONEST failure — proving the fail-closed path, not pretending.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type AgpConfig, resolvePaths, resolveSlackCreds } from "agp/src/config.ts";
import { loadPrivateKey } from "agp/src/runtime/crypto.ts";
import { Journal } from "agp/src/journal/journal.ts";
import { loadPolicyEngine } from "agp/src/policy/engine.ts";
import { RecordingSandbox } from "agp/src/runtime/sandbox.ts";
import { ConsoleChannel } from "agp/src/runtime/channel.ts";
import { Daemon } from "agp/src/daemon/daemon.ts";
import { FileSessionStore } from "agp/src/daemon/session-store.ts";
import { FileOutboxStore } from "agp/src/daemon/outbox-store.ts";
import { OutboxRelay } from "agp/src/daemon/outbox-relay.ts";
import { loadEd25519Verifier } from "agp/src/verify/ed25519-verifier.ts";
import { defaultTenantContext } from "agp/src/tenants/tenant.ts";
import { assertNoSecretValues, EnvSecretVault } from "agp/src/sandbox/credentials.ts";
import { DockerSandbox } from "agp/src/sandbox/docker/docker-sandbox.ts";
import { SlackChannel } from "agp/src/channels/slack/slack-channel.ts";
import { FetchSlackTransport } from "agp/src/channels/slack/transport.ts";
import { SocketModeInteractionSource } from "agp/src/channels/slack/socket-mode.ts";
import { FetchWebSocketDialer } from "agp/src/channels/slack/slack-dialer.ts";
import { FsDoctorProbe } from "agp/src/cli/probe.ts";
import type { SandboxProvider } from "agp/src/contracts/sandbox-provider.ts";
import type { ChannelAdapter } from "agp/src/contracts/channel-adapter.ts";
import type { TriggerEvent, TriggerSourceSpec } from "agp/src/contracts/trigger-source.ts";
import { loadWatcherSpec, type WatcherSpec } from "../../triggers/github-watcher/watcher-spec.ts";
import { verifyStateLog, WatcherStateLog } from "../../triggers/github-watcher/state-log.ts";
import { OneShotPollSource } from "../../triggers/github-watcher/one-shot-poll-source.ts";
import { GithubWatcherIntendant } from "../../triggers/github-watcher/watcher-intendant.ts";
import { fetchWebhookPoster, postNotification, type WebhookPoster } from "../../triggers/github-watcher/notify.ts";

export interface WatchOptions {
  /** Path to the committed watcher spec (required for every subcommand). */
  spec?: string;
}

/** Injectable deps so tests never hit the network or a real sandbox. */
export interface WatchDeps {
  /** Notify-mode webhook poster (default: a real fetch POST). */
  poster?: WebhookPoster;
  /**
   * Sandbox override (tests only). When set, replaces the env-selected sandbox
   * so a fixture can serve canned `gh` output — the ONLY way to exercise the
   * read-ok path hermetically (reference sandbox executes nothing). Production
   * never passes this; the env-var selection stays the real path.
   */
  sandbox?: SandboxProvider;
}

function statePathFor(home: string, spec: WatcherSpec): string {
  return join(home, "watch", `${spec.id}.state.jsonl`);
}

function toSourceSpec(spec: WatcherSpec): TriggerSourceSpec {
  return {
    id: spec.id,
    kind: "poll",
    enabled: spec.enabled,
    livenessTimeoutMs: spec.livenessTimeoutMs,
    config: { repo: spec.repo, watch: spec.watch },
  };
}

/** Load the spec fail-closed; returns null after printing the refusal. */
function loadSpecOrRefuse(
  specPath: string | undefined,
  sub: string,
  out: (line: string) => void,
): WatcherSpec | null {
  if (!specPath) {
    out(`bob watch ${sub}: --spec <path> is required. (fail-closed)`);
    return null;
  }
  try {
    return loadWatcherSpec(specPath);
  } catch (err) {
    out(`bob watch ${sub}: ${(err as Error).message} (fail-closed)`);
    return null;
  }
}

export async function watchCommand(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
  out: (line: string) => void = console.log,
  deps: WatchDeps = {},
): Promise<number> {
  const sub = argv[0];
  const si = argv.indexOf("--spec");
  const specPath = si >= 0 ? argv[si + 1] : undefined;
  const paths = resolvePaths(env);

  if (sub === "status") {
    const spec = loadSpecOrRefuse(specPath, "status", out);
    if (!spec) return 1;
    const statePath = statePathFor(paths.home, spec);
    const state = new WatcherStateLog(statePath);
    const chainErrors = verifyStateLog(statePath);
    const lastRunAt = state.lastRunAt();
    const failures = state.consecutiveFailures();
    out(`source ${spec.id} (${spec.watch} on ${spec.repo})`);
    out(`  enabled:              ${spec.enabled}`);
    out(`  last run:             ${lastRunAt ?? "never"}`);
    out(`  consecutive failures: ${failures}/${spec.maxConsecutiveFailures}`);
    out(`  knowledge chain:      ${chainErrors.length === 0 ? `intact (tip ${state.tipHash() ?? "none"})` : "BROKEN"}`);
    for (const e of chainErrors) out(`    ${e}`);
    if (chainErrors.length > 0) return 1;
    if (spec.livenessTimeoutMs !== null && lastRunAt !== null) {
      const silentMs = Date.now() - Date.parse(lastRunAt);
      if (silentMs > spec.livenessTimeoutMs) {
        out(`  liveness:             STALE — silent ${Math.round(silentMs / 1000)}s > ${Math.round(spec.livenessTimeoutMs / 1000)}s (dead-man's-switch)`);
        return 1;
      }
      out(`  liveness:             ok (silent ${Math.round(silentMs / 1000)}s of ${Math.round(spec.livenessTimeoutMs / 1000)}s allowed)`);
    } else if (spec.livenessTimeoutMs !== null) {
      out("  liveness:             STALE — never run but cadence-bound");
      return 1;
    }
    return 0;
  }

  if (sub === "enable") {
    const spec = loadSpecOrRefuse(specPath, "enable", out);
    if (!spec) return 1;
    const state = new WatcherStateLog(statePathFor(paths.home, spec));
    const before = state.consecutiveFailures();
    state.append("enable", { by: env.USER ?? "operator", specId: spec.id });
    out(`source ${spec.id}: enable recorded — failure streak reset (was ${before}, now ${state.consecutiveFailures()}).`);
    out(spec.enabled ? "spec is enabled; next `bob watch run` will poll." : "NOTE: spec file still has enabled:false — edit it to run. (fail-closed)");
    return 0;
  }

  if (sub !== "run") {
    out("bob watch: unknown subcommand — use `bob watch run|status|enable --spec <path>`.");
    return 1;
  }

  // ---- bob watch run ----
  const spec = loadSpecOrRefuse(specPath, "run", out);
  if (!spec) return 1;
  if (!spec.enabled) {
    out(`bob watch run: spec '${spec.id}' has enabled:false — a disabled source never fires. (fail-closed)`);
    return 1;
  }
  if (!existsSync(paths.signingKey)) {
    out(`bob watch run: signing key missing at ${paths.signingKey} — run \`bob keygen\`. (fail-closed)`);
    return 1;
  }
  if (!existsSync(paths.policy)) {
    out(`bob watch run: policy missing at ${paths.policy} — run \`bob init\`. (fail-closed)`);
    return 1;
  }

  let privateKey: ReturnType<typeof loadPrivateKey>;
  try {
    privateKey = loadPrivateKey(readFileSync(paths.signingKey, "utf8"));
  } catch (err) {
    out(`bob watch run: cannot load signing key: ${(err as Error).message} (fail-closed)`);
    return 1;
  }
  let policy: ReturnType<typeof loadPolicyEngine>;
  try {
    policy = loadPolicyEngine(paths.policy);
  } catch (err) {
    out(`bob watch run: invalid policy: ${(err as Error).message} (fail-closed)`);
    return 1;
  }

  // Restart-intensity bound (invariant 2): a source that keeps failing REFUSES
  // to run again until a human re-enables — escalate, don't crash-loop.
  const statePath = statePathFor(paths.home, spec);
  const state = new WatcherStateLog(statePath);
  const failures = state.consecutiveFailures();
  if (failures >= spec.maxConsecutiveFailures) {
    out(
      `bob watch run: source '${spec.id}' has ${failures} consecutive failures (bound ${spec.maxConsecutiveFailures}) — REFUSING until a human runs \`bob watch enable --spec ${specPath}\`. (restart-intensity bound)`,
    );
    return 3;
  }

  // Notify-mode precondition (fail-fast, like the signing-key/policy checks): a
  // `deliver: "notify"` spec needs its webhook URL present in the environment
  // BEFORE we fire the trigger — an unset webhook is a config error, not a
  // transient failure, so refuse rather than run and drop the notification.
  let notifyWebhook: string | undefined;
  if (spec.deliver === "notify") {
    notifyWebhook = spec.notifyWebhookEnv ? env[spec.notifyWebhookEnv] : undefined;
    if (!notifyWebhook) {
      out(
        `bob watch run: deliver:'notify' needs env '${spec.notifyWebhookEnv}' set to the Slack webhook URL — it is unset/empty. (fail-closed)`,
      );
      return 1;
    }
  }

  // Sandbox: recording reference (executes nothing) or real Docker isolation.
  // A test may inject a fixture sandbox to exercise the read-ok path hermetically.
  let sandbox: SandboxProvider;
  let image: string | undefined;
  let networkEnabled = false;
  if (deps.sandbox) {
    sandbox = deps.sandbox;
    out("bob watch run: injected sandbox (test fixture).");
  } else if (env.AGP_SANDBOX === "docker") {
    if (!new FsDoctorProbe(env).docker().ok) {
      out("bob watch run: AGP_SANDBOX=docker but Docker is not available — refusing (no host fallback). (fail-closed)");
      return 1;
    }
    image = env.AGP_SANDBOX_IMAGE;
    if (!image) {
      out("bob watch run: AGP_SANDBOX=docker requires AGP_SANDBOX_IMAGE=<pinned image with gh>. (fail-closed)");
      return 1;
    }
    sandbox = new DockerSandbox();
    networkEnabled = true; // the proxy-executed `gh` calls need api.github.com
    out("bob watch run: DOCKER sandbox — namespace isolation, egress enabled for gh (NOT VM-grade).");
  } else {
    sandbox = new RecordingSandbox();
    out("bob watch run: recording sandbox (reference — executes nothing; the read will record an HONEST failure).");
  }

  const vault = new EnvSecretVault(env);
  const knownSecrets = (extra: readonly string[] = []): string[] => {
    const set = new Set<string>();
    for (const v of vault.values()) set.add(v);
    for (const e of extra) if (e.length > 0) set.add(e);
    return [...set];
  };
  // The notify webhook is a posting credential — screen it out of the signed
  // journal (defense in depth; it never enters a payload by construction).
  const journalScreenSecrets = knownSecrets(notifyWebhook ? [notifyWebhook] : []);
  const journal = new Journal(paths.journal, privateKey, undefined, (event) =>
    assertNoSecretValues(event, journalScreenSecrets, "journal"),
  );

  // Channel: console reference (fail-closed deny with no human) or live Slack.
  let channel: ChannelAdapter;
  let receiver: SocketModeInteractionSource | undefined;
  if (env.AGP_CHANNEL === "slack") {
    const slack = new FsDoctorProbe(env).slack();
    if (!slack.ok) {
      out(`bob watch run: AGP_CHANNEL=slack but ${slack.detail}. (fail-closed)`);
      return 1;
    }
    if (env.AGP_SLACK_LIVE !== "1") {
      out(
        "bob watch run: AGP_CHANNEL=slack but AGP_SLACK_LIVE!=1 — refusing to post a prompt nothing can answer. (fail-closed)",
      );
      return 1;
    }
    let cfg: AgpConfig = {};
    if (existsSync(paths.config)) {
      try {
        cfg = JSON.parse(readFileSync(paths.config, "utf8")) as AgpConfig;
      } catch {
        cfg = {};
      }
    }
    const creds = resolveSlackCreds(env, cfg);
    receiver = new SocketModeInteractionSource({
      appToken: creds.appToken,
      dialer: new FetchWebSocketDialer(),
      onRejected: (r) =>
        journal.append({
          kind: "approval.rejected",
          actor: "session_owner",
          payload: { reason: r.reason, nonce: r.nonce, decidedBy: r.userId ?? null },
        }),
    });
    await receiver.start();
    const slackSecrets = knownSecrets([creds.botToken, creds.appToken]);
    channel = new SlackChannel({
      transport: new FetchSlackTransport(creds.botToken),
      interactions: receiver,
      channelId: creds.channelId,
      screen: (payload) => assertNoSecretValues(payload, slackSecrets, "slack"),
    });
    out("bob watch run: AGP_CHANNEL=slack — live Socket Mode receiver connected.");
  } else {
    channel = new ConsoleChannel(env, out);
  }

  const sessionStore = new FileSessionStore(join(paths.home, "sessions.json"));
  const identityMode =
    env.AGP_IDENTITY_MODE === "warn" || env.AGP_IDENTITY_MODE === "enforce" ? env.AGP_IDENTITY_MODE : "off";
  const verifier = loadEd25519Verifier(join(paths.home, "intendants", "ed25519.pub"));
  const daemon = new Daemon({
    policy,
    journal,
    sandbox,
    channel,
    vault,
    sessionStore,
    verifier,
    identityMode,
    tenantContext: defaultTenantContext(),
  });
  const reaped = daemon.recoverSessions();
  if (reaped.length > 0) {
    out(`bob watch run: recovered — reaped ${reaped.length} orphaned session(s) from a prior crash (journaled).`);
  }
  const outbox = new OutboxRelay(channel, new FileOutboxStore(join(paths.home, "outbox.json")));
  await outbox.drain();

  // One tick through the frozen trigger-source contract.
  const source = new OneShotPollSource({
    sourceSpec: toSourceSpec(spec),
    lastEventAt: state.lastRunAt(),
    restartCount: failures,
  });
  let fired: TriggerEvent | null = null;
  await source.start(async (event) => {
    fired = event;
  });
  await source.stop();
  if (!fired) {
    out("bob watch run: source did not fire (disabled). (fail-closed)");
    return 1;
  }
  const event: TriggerEvent = fired;

  // Cross-chain causal pointer (invariant 1): the shared correlationId + the
  // knowledge chain's tip hash AT DECISION TIME, in the signed action journal.
  journal.append({
    kind: "trigger.fired",
    actor: "session_owner",
    payload: {
      triggerId: event.triggerId,
      source: event.source,
      kind: event.kind,
      correlationId: event.correlationId,
      knowledgeTipHash: state.tipHash(),
    },
  });

  const intendant = new GithubWatcherIntendant(spec, state, event.correlationId);
  const s = intendant.summary;
  let sessionId = "crashed-before-session";
  let notifyDelivered: boolean | null = null;
  const notified: string[] = []; // notify mode: keys delivered AND recorded this run
  try {
    // A crash below (sandbox error, transient runtime failure) must still be
    // ACCOUNTED: the catch records a failed run in the knowledge chain (so the
    // restart-intensity bound counts crashes, not just clean failures) and
    // settles the journal bracket; the finally always stops the Slack receiver.
    const result = await daemon.runMediated(intendant, { ...(image ? { image } : {}), networkEnabled });
    sessionId = result.sessionId;

    // NOTIFY delivery (recorded-iff-delivered): post ONE batched message, then
    // record each item as seen ONLY on success — a dropped post leaves the items
    // to re-fire next run (never silently lost). A read-ok run with a failed post
    // stays ok:true (the agent isn't crash-looping; a transient Slack outage must
    // not trip the restart-intensity bound) but exits non-zero so cron sees it.
    if (spec.deliver === "notify" && s.readOk && s.toNotify.length > 0 && notifyWebhook) {
      const poster = deps.poster ?? fetchWebhookPoster;
      notifyDelivered = await postNotification(poster, notifyWebhook, spec.id, spec.repo, s.toNotify);
      if (notifyDelivered) {
        for (const item of s.toNotify) {
          state.append("observed", { key: item.key, outcome: "notified", correlationId: event.correlationId });
          notified.push(item.key);
        }
      }
    } else if (spec.deliver === "notify" && s.readOk && s.toNotify.length === 0) {
      notifyDelivered = true; // nothing new to say = a trivially successful delivery
    }
    // NB: notify + readOk + items-but-no-webhook can only happen if the fail-fast
    // precondition were bypassed; notifyDelivered then stays null and the exit
    // check below treats anything but `true` as not-delivered (belt-and-suspenders).

    // Record the run in the knowledge chain (heartbeat + failure accounting)
    // and close the journal bracket with the post-run tip. A notify post-failure
    // keeps ok:true (read worked) so the bound doesn't trip on a transient outage.
    state.append("run", {
      correlationId: event.correlationId,
      ok: s.readOk,
      reason: s.failureReason,
      candidates: s.candidates,
      newCount: s.newKeys.length,
      actioned: s.actioned.length,
      suppressed: s.suppressed.length,
      notified: notified.length,
      deliver: spec.deliver,
      notifyDelivered,
    });
    journal.append({
      kind: "trigger.settled",
      actor: "session_owner",
      payload: {
        correlationId: event.correlationId,
        sessionId,
        ok: s.readOk,
        reason: s.failureReason,
        candidates: s.candidates,
        newKeys: s.newKeys,
        actioned: s.actioned,
        suppressed: s.suppressed,
        notified,
        deliver: spec.deliver,
        notifyDelivered,
        knowledgeTipHash: state.tipHash(),
      },
    });
    const doneCount = spec.deliver === "notify" ? `${notified.length} notified` : `${s.actioned.length} actioned`;
    await outbox.project(
      "trigger.settled",
      `watch ${spec.id}: ${s.readOk ? `${s.newKeys.length} new / ${doneCount} / ${s.suppressed.length} suppressed` : `FAILED — ${s.failureReason}`}`,
    );

    out(`\nwatch ${spec.id} — session ${sessionId} (correlation ${event.correlationId}):`);
    for (const o of result.outcomes) {
      const approval = o.approved === null ? "" : ` → approval ${o.approved ? "granted" : "denied"}`;
      out(`  ${o.request.tool}: ${o.verdict.decision}${approval}${o.executed ? " → executed" : ""}`);
    }
  } catch (err) {
    const reason = `run crashed: ${(err as Error).message}`;
    state.append("run", {
      correlationId: event.correlationId,
      ok: false,
      reason,
      candidates: 0,
      newCount: 0,
      actioned: 0,
      suppressed: 0,
    });
    journal.append({
      kind: "trigger.settled",
      actor: "session_owner",
      payload: {
        correlationId: event.correlationId,
        sessionId,
        ok: false,
        reason,
        knowledgeTipHash: state.tipHash(),
      },
    });
    await outbox.project("trigger.settled", `watch ${spec.id}: CRASHED — ${(err as Error).message}`);
    out(`run CRASHED (${(err as Error).message}) — recorded as a failure; consecutive failures ${state.consecutiveFailures()}/${spec.maxConsecutiveFailures}.`);
    out(`journal: ${paths.journal} — verify with \`bob verify\`. state: ${statePath}`);
    return 2;
  } finally {
    await receiver?.stop();
  }

  if (s.readOk && spec.deliver === "notify") {
    if (notifyDelivered === false) {
      out(`read ok — ${s.newKeys.length} new, but the notification POST FAILED; items re-fire next run. (delivery degraded)`);
    } else {
      out(`read ok — ${s.candidates} candidate(s), ${s.newKeys.length} new, ${notified.length} notified via ${spec.notifyWebhookEnv}.`);
    }
  } else if (s.readOk) {
    out(`read ok — ${s.candidates} candidate(s), ${s.newKeys.length} new, ${s.actioned.length} actioned, ${s.suppressed.length} suppressed.`);
  } else {
    const now = state.consecutiveFailures();
    out(`run FAILED (${s.failureReason}) — consecutive failures ${now}/${spec.maxConsecutiveFailures}.`);
  }
  out(`journal: ${paths.journal} — verify with \`bob verify\`. state: ${statePath}`);
  // Exit 0 only on a fully-successful run; a failed read (2) or a not-delivered
  // notify (2) signals cron/loops that work remains. In notify mode success
  // REQUIRES notifyDelivered === true — `false` (post failed) and `null` (the
  // no-webhook-with-items impossible-path) both count as not-delivered.
  if (!s.readOk) return 2;
  if (spec.deliver === "notify" && notifyDelivered !== true) return 2;
  return 0;
}
