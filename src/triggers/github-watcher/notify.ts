// Slack notify projection for the watcher's `deliver: "notify"` mode
// (agp-eva.1: interim delivery until the two-way HITL channel lands). This is a
// PROJECTION, not the authority — same invariant as the AGP channel adapter: a
// dropped/failed post never changes what the signed journal records. Delivery is
// recorded-iff-delivered by the CLI, so a failed post re-fires next run.
//
// House style matches ~/bin/lib/notify-lib.sh slack_post: a single clay-accent
// (#D97757) attachment with mrkdwn text — every non-card alert across the estate
// shares the shape. The webhook URL is a POSTING CREDENTIAL: it lives in the
// environment, is passed in here as a value, and MUST NOT be journaled (the CLI
// screens it out of the signed journal).

import type { WatchItem } from "./watcher-intendant.ts";

/** The clay accent used by the estate's Slack alerts. */
export const NOTIFY_ACCENT = "#D97757";

/** Injectable HTTP poster so tests never hit the network. */
export type WebhookPoster = (url: string, body: string) => Promise<{ ok: boolean; status: number }>;

/** The real poster: a plain incoming-webhook POST. */
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
 * Escape Slack mrkdwn control chars in USER-DERIVED text (a release/commit
 * title). Per Slack's rules `&`, `<`, `>` must be HTML-escaped; a `|` inside
 * `<url|label>` link text would truncate the label, so swap it for a lookalike.
 * Left unescaped, a title like `feat: add <Component> | fix` would corrupt the
 * message or break the link.
 */
export function escapeSlack(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("|", "∣");
}

/** Build the mrkdwn body for a batch of new items. */
export function buildNotifyText(sourceId: string, repo: string, items: readonly WatchItem[]): string {
  const header =
    items.length === 1
      ? `*bob · ${sourceId}* — 1 new on \`${repo}\``
      : `*bob · ${sourceId}* — ${items.length} new on \`${repo}\``;
  // URL is not escaped (it is our own https://github.com/… link); the title is.
  const lines = items.map((it) => `> • <${it.url}|${escapeSlack(it.title)}>`);
  return [header, ...lines].join("\n");
}

/** The Slack incoming-webhook payload (house clay-accent attachment). */
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
