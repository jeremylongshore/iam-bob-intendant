// Notify projection for the watcher's `deliver: "notify"` mode
// (agp-eva.1: interim delivery until the two-way HITL channel lands). This is a
// PROJECTION, not the authority — same invariant as the AGP channel adapter: a
// dropped/failed post never changes what the signed journal records. Delivery is
// recorded-iff-delivered by the CLI, so a failed post re-fires next run.
//
// Webhook mode keeps the historical clay-accent payload for compatible callers.
// Command mode sends the same human-readable text through a fixed executable
// boundary (no shell, no hosted-chat dependency). Posting credentials and command
// paths stay in the environment and MUST NOT be journaled.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

import type { WatchItem } from "./watcher-intendant.ts";

/** The clay accent retained for webhook-compatible projections. */
export const NOTIFY_ACCENT = "#D97757";

/** Injectable HTTP poster so tests never hit the network. */
export type WebhookPoster = (url: string, body: string) => Promise<{ ok: boolean; status: number }>;

/** The real webhook poster: a plain incoming-webhook POST. */
export const fetchWebhookPoster: WebhookPoster = async (url, body) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-type": "application/json" },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  return { ok: res.ok, status: res.status };
};

/**
 * Escape mrkdwn control chars in USER-DERIVED text (a release/commit title).
 * The escaping keeps the historical webhook representation safe; Buzz also
 * accepts the resulting text as plain content. A `|` inside
 * `<url|label>` link text would truncate the label, so swap it for a lookalike.
 * Left unescaped, a title like `feat: add <Component> | fix` would corrupt the
 * message or break the link.
 */
export function escapeNotifyText(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("|", "∣");
}

/** @deprecated Use escapeNotifyText; retained for compatibility with callers. */
export const escapeSlack = escapeNotifyText;

/** Build the mrkdwn body for a batch of new items. */
export function buildNotifyText(sourceId: string, repo: string, items: readonly WatchItem[]): string {
  const header =
    items.length === 1
      ? `*bob · ${sourceId}* — 1 new on \`${repo}\``
      : `*bob · ${sourceId}* — ${items.length} new on \`${repo}\``;
  // URL is not escaped (it is our own https://github.com/… link); the title is.
  const lines = items.map((it) => `> • <${it.url}|${escapeNotifyText(it.title)}>`);
  return [header, ...lines].join("\n");
}

/** The compatible incoming-webhook payload (house clay-accent attachment). */
export function buildNotifyPayload(text: string): string {
  return JSON.stringify({
    unfurl_links: false,
    unfurl_media: false,
    attachments: [{ color: NOTIFY_ACCENT, text, mrkdwn_in: ["text"], fallback: text }],
  });
}

/**
 * Post one batched notification for the given items. Returns whether it was
 * delivered — the caller records the items as seen ONLY on `true`, so a failed
 * post leaves them to re-fire next run (never silently lost).
 */
export async function postNotification(
  poster: WebhookPoster,
  webhookUrl: string,
  sourceId: string,
  repo: string,
  items: readonly WatchItem[],
): Promise<boolean> {
  if (items.length === 0) return true; // nothing to say is a trivially successful "delivery"
  const text = buildNotifyText(sourceId, repo, items);
  try {
    const res = await poster(webhookUrl, buildNotifyPayload(text));
    return res.ok;
  } catch {
    return false; // network/timeout — treat as undelivered; items re-fire next run
  }
}

/** Injectable command poster for repository-owned transports such as Buzz. */
export type CommandPoster = (
  command: string,
  text: string,
  topic: string,
) => Promise<{ ok: boolean; status: number }>;

/** Execute a notification transport without invoking a shell. */
export const execCommandPoster: CommandPoster = async (command, text, topic) => {
  try {
    await execFileAsync(command, [text], {
      env: { ...process.env, BUZZ_NOTIFY_TOPIC: topic },
      timeout: 10_000,
      maxBuffer: 64 * 1024,
    });
    return { ok: true, status: 0 };
  } catch (err) {
    const status = typeof (err as { code?: unknown }).code === "number" ? Number((err as { code: number }).code) : 1;
    return { ok: false, status };
  }
};

/** Post one batched notification through a repository-owned command transport. */
export async function postCommandNotification(
  poster: CommandPoster,
  command: string,
  topic: string,
  sourceId: string,
  repo: string,
  items: readonly WatchItem[],
): Promise<boolean> {
  if (items.length === 0) return true;
  const text = buildNotifyText(sourceId, repo, items);
  try {
    const res = await poster(command, text, topic);
    return res.ok;
  } catch {
    return false;
  }
}
