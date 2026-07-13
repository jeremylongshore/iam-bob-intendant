import { test, expect } from "bun:test";
import type { WatchItem } from "./watcher-intendant.ts";
import { buildNotifyPayload, buildNotifyText, NOTIFY_ACCENT, postNotification, type WebhookPoster } from "./notify.ts";

const items: WatchItem[] = [
  { key: "release:v1", title: "acme/sdk release v1", url: "https://x/v1" },
  { key: "release:v2", title: "acme/sdk release v2", url: "https://x/v2" },
];

test("buildNotifyText: singular vs plural header + one linked line per item", () => {
  const one = buildNotifyText("sdk", "acme/sdk", [items[0]!]);
  expect(one).toContain("1 new on `acme/sdk`");
  expect(one).toContain("<https://x/v1|acme/sdk release v1>");
  const many = buildNotifyText("sdk", "acme/sdk", items);
  expect(many).toContain("2 new on `acme/sdk`");
  expect(many.split("\n")).toHaveLength(3); // header + 2 items
});

test("escapeSlack: mrkdwn control chars in a title are neutralized (link stays intact)", () => {
  const nasty: WatchItem = {
    key: "release:v9",
    title: "feat: add <Component> & fix | leak",
    url: "https://x/v9",
  };
  const text = buildNotifyText("sdk", "acme/sdk", [nasty]);
  // The raw < > | & in the TITLE must not survive to break the <url|label> link.
  expect(text).toContain("&lt;Component&gt;");
  expect(text).toContain("&amp;");
  expect(text).not.toContain("<Component>");
  // exactly one link delimiter '|' (the real one), the title's pipe is swapped.
  expect(text).toContain("<https://x/v9|");
  expect(text.split("|")).toHaveLength(2);
});

test("buildNotifyPayload: house clay-accent attachment with mrkdwn", () => {
  const payload = JSON.parse(buildNotifyPayload("hi"));
  expect(payload.attachments[0].color).toBe(NOTIFY_ACCENT);
  expect(payload.attachments[0].mrkdwn_in).toEqual(["text"]);
  expect(payload.unfurl_links).toBe(false);
});

test("postNotification: delivered on 2xx, undelivered on non-2xx, undelivered on throw", async () => {
  const ok: WebhookPoster = () => Promise.resolve({ ok: true, status: 200 });
  expect(await postNotification(ok, "https://hook", "sdk", "acme/sdk", items)).toBe(true);

  const rejected: WebhookPoster = () => Promise.resolve({ ok: false, status: 500 });
  expect(await postNotification(rejected, "https://hook", "sdk", "acme/sdk", items)).toBe(false);

  const threw: WebhookPoster = () => Promise.reject(new Error("network down"));
  expect(await postNotification(threw, "https://hook", "sdk", "acme/sdk", items)).toBe(false);
});

test("postNotification: an empty batch is a trivially successful delivery (no post attempted)", async () => {
  let called = 0;
  const spy: WebhookPoster = () => {
    called++;
    return Promise.resolve({ ok: true, status: 200 });
  };
  expect(await postNotification(spy, "https://hook", "sdk", "acme/sdk", [])).toBe(true);
  expect(called).toBe(0);
});

test("the posted body carries only public item URLs — never the webhook URL", () => {
  const body = buildNotifyPayload(buildNotifyText("sdk", "acme/sdk", items));
  expect(body).not.toContain("hooks.slack.com");
  expect(body).toContain("https://x/v1");
});
