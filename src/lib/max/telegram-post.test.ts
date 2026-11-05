import assert from "node:assert/strict";
import { test } from "node:test";

import {
  markdownToTelegramHtml,
  normalizeTelegramChannelRef,
  planTelegramPost,
  telegramMessageUrl,
  telegramVisibleLength,
} from "./telegram-post";

test("разметка MAX переводится в HTML Telegram, опасные символы экранируются", () => {
  assert.equal(
    markdownToTelegramHtml("**Журналы** и *без бумаги* <script> & `ПРОМО<1>` ~~было~~", null),
    "<b>Журналы</b> и <i>без бумаги</i> &lt;script&gt; &amp; <code>ПРОМО&lt;1&gt;</code> <s>было</s>",
  );
  assert.equal(markdownToTelegramHtml("2 * 3 * 4", null), "2 * 3 * 4");
});

test("ссылки: разметка [текст](url) → <a>, сайт получает utm_source=telegram", () => {
  const html = markdownToTelegramHtml("[Попробуйте](https://wesetup.ru/register) и https://example.com", "promo");
  assert.equal(
    html,
    '<a href="https://wesetup.ru/register?utm_source=telegram&amp;utm_medium=social&amp;utm_campaign=promo">Попробуйте</a> и https://example.com',
  );
  assert.equal(markdownToTelegramHtml('[x](https://a.ru/"onmouseover=1)', null).includes('"onmouseover'), false);
});

test("видимая длина считается без тегов", () => {
  assert.equal(telegramVisibleLength("<b>ab</b> &amp; <a href=\"https://x\">c</a>"), 6);
});

test("план отправки: подпись к фото до 1024 знаков, иначе фото и текст отдельно", () => {
  const button = { buttonText: "Попробовать", buttonUrl: "https://wesetup.ru/", campaign: "welcome" };
  assert.equal(planTelegramPost({ text: "Привет", images: [], ...button }).mode, "text");
  assert.equal(planTelegramPost({ text: "Привет", images: ["max-channel/a.jpg"], ...button }).mode, "caption");
  assert.equal(planTelegramPost({ text: "x".repeat(1025), images: ["max-channel/a.jpg"] }).mode, "photos-then-text");
  assert.equal(planTelegramPost({ text: "x", images: ["max-channel/a.jpg", "max-channel/b.jpg"] }).mode, "photos-then-text");
  assert.deepEqual(planTelegramPost({ text: "x", images: [], ...button }).replyMarkup, {
    inline_keyboard: [[{ text: "Попробовать", url: "https://wesetup.ru/?utm_source=telegram&utm_medium=social&utm_campaign=welcome" }]],
  });
  assert.equal(planTelegramPost({ text: "x", images: [] }).replyMarkup, undefined);
});

test("канал Telegram: имя, ссылка t.me и числовой id", () => {
  assert.equal(normalizeTelegramChannelRef("@wesetup"), "@wesetup");
  assert.equal(normalizeTelegramChannelRef("https://t.me/wesetup"), "@wesetup");
  assert.equal(normalizeTelegramChannelRef("wesetup"), "@wesetup");
  assert.equal(normalizeTelegramChannelRef("-1001234567890"), "-1001234567890");
  assert.equal(normalizeTelegramChannelRef("abc"), null);
  assert.equal(normalizeTelegramChannelRef("t.me/+invite"), null);
  assert.equal(telegramMessageUrl("wesetup", "-1001", 5), "https://t.me/wesetup/5");
  assert.equal(telegramMessageUrl(null, "-1001234567890", 5), "https://t.me/c/1234567890/5");
});
