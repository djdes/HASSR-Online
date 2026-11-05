import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  buildMaxPostBody,
  maxPostDraftSchema,
  parseChannelMembershipUpdate,
  tagSiteLinks,
  withUtm,
} from "./channel-post";
import { canAccessPlatformPath, platformGateFor } from "../platform-access";

test("UTM ставится только на ссылки сайта и не перетирает существующие", () => {
  assert.equal(
    withUtm("https://wesetup.ru/register", "intro"),
    "https://wesetup.ru/register?utm_source=max&utm_medium=social&utm_campaign=intro",
  );
  assert.equal(withUtm("https://example.com/a", "intro"), "https://example.com/a");
  assert.equal(withUtm("https://wesetup.ru/?utm_source=vk", "intro"), "https://wesetup.ru/?utm_source=vk");
});

test("ссылки сайта в тексте размечаются, точка в конце предложения не попадает в ссылку", () => {
  const text = tagSiteLinks("Смотрите https://wesetup.ru/blog/x. И [тут](https://wesetup.ru/).", "c1");
  assert.match(text, /https:\/\/wesetup\.ru\/blog\/x\?utm_source=max&utm_medium=social&utm_campaign=c1\. /);
  assert.match(text, /\[тут\]\(https:\/\/wesetup\.ru\/\?utm_source=max&utm_medium=social&utm_campaign=c1\)/);
});

test("тело сообщения: markdown, картинки перед кнопкой-ссылкой с UTM", () => {
  const body = buildMaxPostBody(
    { text: "**Привет**", buttonText: "Попробовать", buttonUrl: "https://wesetup.ru/register", campaign: "promo" },
    ["tok1"],
  );
  assert.equal(body.format, "markdown");
  assert.deepEqual(body.attachments[0], { type: "image", payload: { token: "tok1" } });
  assert.deepEqual(body.attachments[1], {
    type: "inline_keyboard",
    payload: {
      buttons: [[{ type: "link", text: "Попробовать", url: "https://wesetup.ru/register?utm_source=max&utm_medium=social&utm_campaign=promo" }]],
    },
  });
});

test("черновик: кнопка требует и надпись, и https-ссылку; текст не длиннее 4000", () => {
  assert.equal(maxPostDraftSchema.safeParse({ channelId: "c", text: "x", buttonText: "Да" }).success, false);
  assert.equal(maxPostDraftSchema.safeParse({ channelId: "c", text: "x", buttonText: "Да", buttonUrl: "javascript:alert(1)" }).success, false);
  assert.equal(maxPostDraftSchema.safeParse({ channelId: "c", text: "x".repeat(4001) }).success, false);
  assert.equal(maxPostDraftSchema.safeParse({ channelId: "c", text: "x", images: ["../../.env"] }).success, false);
  assert.equal(maxPostDraftSchema.safeParse({ channelId: "c", text: "x", images: ["max-channel/abcdefgh12.png"] }).success, true);
});

test("события bot_added/bot_removed про канал разбираются, остальные — нет", () => {
  assert.deepEqual(parseChannelMembershipUpdate({ update_type: "bot_added", chat_id: -7123, is_channel: true }), { kind: "added", chatId: "-7123" });
  assert.deepEqual(parseChannelMembershipUpdate({ update_type: "bot_removed", chat_id: "-7123" }), { kind: "removed", chatId: "-7123" });
  assert.equal(parseChannelMembershipUpdate({ update_type: "bot_added", chat_id: -1, is_channel: false }), null);
  assert.equal(parseChannelMembershipUpdate({ update_type: "message_created" }), null);
  assert.equal(parseChannelMembershipUpdate({ update_type: "bot_added", chat_id: "1; drop" }), null);
});

test("раздел «Канал MAX» открыт тем, у кого есть «Блог», и закрыт остальным", () => {
  assert.equal(platformGateFor("/root/max-channel"), "content");
  assert.equal(platformGateFor("/api/root/max-channel/posts/x/publish", "POST"), "content");
  const content = { superadmin: false, sections: ["content"] } as Parameters<typeof canAccessPlatformPath>[0];
  const support = { superadmin: false, sections: ["support"] } as Parameters<typeof canAccessPlatformPath>[0];
  assert.equal(canAccessPlatformPath(content, "/api/root/max-channel/posts", "POST"), true);
  assert.equal(canAccessPlatformPath(support, "/root/max-channel"), false);
});

test("вебхук основного бота передаёт события каналов до обработки диалогов", () => {
  const route = readFileSync("src/app/api/max/webhook/route.ts", "utf8");
  assert.ok(route.indexOf("handleChannelWebhookUpdate(update)") < route.indexOf("handleMaxUpdate(update)"));
  const setup = readFileSync("scripts/setup-max.ts", "utf8");
  assert.match(setup, /"bot_added","bot_removed"/);
});
