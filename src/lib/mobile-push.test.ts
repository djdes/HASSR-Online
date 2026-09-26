import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFcmMessage,
  isDeadTokenError,
  isNotificationSnoozed,
  normalizePushUrl,
  organizationAlertPush,
  pushTextFromTelegramHtml,
  shouldSkipBotPush,
} from "./mobile-push";

test("ссылка push остаётся внутренней", () => {
  assert.equal(normalizePushUrl("/journals/hygiene"), "/journals/hygiene");
  assert.equal(normalizePushUrl("/mini/o/obl_1?x=1"), "/mini/o/obl_1?x=1");
  assert.equal(normalizePushUrl("https://wesetup.ru/mini/today"), "/mini/today");
  assert.equal(normalizePushUrl("https://www.wesetup.ru/journals?a=1#b"), "/journals?a=1#b");
  // Адрес стенда из NEXTAUTH_URL тоже свой.
  assert.equal(
    normalizePushUrl("http://localhost:3021/mini", ["localhost:3021"]),
    "/mini"
  );
});

test("чужое, опасное и служебное ведёт на главный экран", () => {
  assert.equal(normalizePushUrl("https://evil.example/x"), "/mini");
  assert.equal(normalizePushUrl("https://wesetup.ru.evil.example/x"), "/mini");
  assert.equal(normalizePushUrl("//evil.example"), "/mini");
  assert.equal(normalizePushUrl("/\\evil.example"), "/mini");
  assert.equal(normalizePushUrl("javascript:alert(1)"), "/mini");
  assert.equal(normalizePushUrl("journals"), "/mini");
  assert.equal(normalizePushUrl("/api/secret"), "/mini");
  assert.equal(normalizePushUrl("/api"), "/mini");
  assert.equal(normalizePushUrl("https://wesetup.ru/api/x"), "/mini");
  assert.equal(normalizePushUrl(""), "/mini");
  assert.equal(normalizePushUrl(null), "/mini");
  assert.equal(normalizePushUrl(undefined), "/mini");
});

test("мёртвый ключ устройства распознаётся по ответу FCM", () => {
  const fcm = (status: string, errorCode?: string, message = "") => ({
    error: {
      code: 400,
      message,
      status,
      details: errorCode
        ? [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode }]
        : [],
    },
  });
  assert.equal(isDeadTokenError(fcm("NOT_FOUND", "UNREGISTERED")), true);
  assert.equal(isDeadTokenError(fcm("PERMISSION_DENIED", "SENDER_ID_MISMATCH")), true);
  assert.equal(
    isDeadTokenError(
      fcm("INVALID_ARGUMENT", "INVALID_ARGUMENT", "The registration token is not a valid FCM registration token")
    ),
    true
  );
  // Ошибка в нашем же сообщении не повод стирать все телефоны.
  assert.equal(
    isDeadTokenError(fcm("INVALID_ARGUMENT", "INVALID_ARGUMENT", "Invalid value at 'message.android.ttl'")),
    false
  );
  assert.equal(isDeadTokenError(fcm("UNAVAILABLE", "UNAVAILABLE")), false);
  assert.equal(isDeadTokenError(fcm("RESOURCE_EXHAUSTED", "QUOTA_EXCEEDED")), false);
  assert.equal(isDeadTokenError(null), false);
  assert.equal(isDeadTokenError("oops"), false);
});

test("текст бота без разметки и в разумной длине", () => {
  assert.equal(
    pushTextFromTelegramHtml("<b>Задача</b>: гигиена &amp; здоровье"),
    "Задача: гигиена & здоровье"
  );
  assert.equal(pushTextFromTelegramHtml("Строка 1<br>Строка 2\n\nСтрока 3"), "Строка 1 Строка 2 Строка 3");
  assert.equal(pushTextFromTelegramHtml("&lt;tag&gt; &quot;x&quot; &#39;y&#39;"), "<tag> \"x\" 'y'");
  const long = pushTextFromTelegramHtml("а".repeat(500));
  assert.ok(long.length <= 180);
  assert.ok(long.endsWith("…"));
});

test("сообщение FCM несёт ссылку в data и тег для замены", () => {
  const message = buildFcmMessage("tok", {
    title: "WeSetup",
    body: "Текст",
    url: "/journals/hygiene",
    tag: "k1",
  });
  assert.deepEqual(message, {
    token: "tok",
    notification: { title: "WeSetup", body: "Текст" },
    data: { url: "/journals/hygiene" },
    android: { priority: "high", notification: { tag: "k1" } },
    apns: { payload: { aps: { sound: "default", "thread-id": "k1" } } },
  });
  const noTag = buildFcmMessage("tok", { title: "T", body: "B" });
  assert.deepEqual(noTag.data, { url: "/mini" });
  assert.deepEqual(noTag.android, { priority: "high" });
  assert.deepEqual(noTag.apns, { payload: { aps: { sound: "default" } } });
});

test("копия сообщения бота молчит сразу после push колокольчика", () => {
  const now = 1_000_000;
  assert.equal(shouldSkipBotPush(undefined, now), false);
  assert.equal(shouldSkipBotPush(now - 5_000, now), true);
  assert.equal(shouldSkipBotPush(now - 60_000, now), false);
});

test("тревога руководству уходит push'ем: заголовок — первая строка", () => {
  const push = organizationAlertPush(
    "🔴 <b>Превышение температуры — открыт CAPA</b>\n\nХолодильник №2: 9.1°C (2…6°C, выше)\nДлительность 40 мин.",
    "temperature"
  );
  assert.deepEqual(push, {
    title: "🔴 Превышение температуры — открыт CAPA",
    body: "Холодильник №2: 9.1°C (2…6°C, выше) Длительность 40 мин.",
  });
});

test("однострочная тревога: заголовок WeSetup, текст целиком", () => {
  assert.deepEqual(
    organizationAlertPush("Отзыв Анны опубликован — начислено <b>500 ₽</b>."),
    { title: "WeSetup", body: "Отзыв Анны опубликован — начислено 500 ₽." }
  );
});

test("сводки и отчёты push'ем не уходят", () => {
  assert.equal(
    organizationAlertPush("<b>📊 Сводка за неделю · Кафе</b>\n\nЗаполнено: 90%", "compliance"),
    null
  );
  assert.equal(organizationAlertPush("🤖 <b>AI-сводка за неделю</b>\n\nВсё хорошо"), null);
  assert.equal(organizationAlertPush("<b>Дайджест</b>\nтекст"), null);
  assert.equal(organizationAlertPush("<b>Отчёт за смену</b>\nтекст"), null);
  // Длинное сообщение без типа тревоги — это отчёт, а не тревога.
  assert.equal(organizationAlertPush(`<b>Новости</b>\n${"слово ".repeat(150)}`), null);
});

test("длинная тревога с типом всё равно уходит, текст обрезан", () => {
  const lines = Array.from({ length: 40 }, (_, i) => `• Журнал номер ${i + 1}`).join("\n");
  const push = organizationAlertPush(
    `⚠️ <b>Внимание: незаполненные журналы за сегодня</b>\n\n${lines}`,
    "compliance"
  );
  assert.ok(push);
  assert.equal(push.title, "⚠️ Внимание: незаполненные журналы за сегодня");
  assert.ok(push.body.length <= 180);
});

test("пустое сообщение — без push", () => {
  assert.equal(organizationAlertPush("  <b></b> "), null);
});

test("отложенные уведомления: push молчит до конца откладывания", () => {
  const now = new Date("2026-09-26T10:00:00.000Z");
  assert.equal(isNotificationSnoozed(null, now), false);
  assert.equal(isNotificationSnoozed({}, now), false);
  assert.equal(isNotificationSnoozed({ snoozedUntil: "2026-09-26T10:30:00.000Z" }, now), true);
  assert.equal(isNotificationSnoozed({ snoozedUntil: "2026-09-26T09:30:00.000Z" }, now), false);
  assert.equal(isNotificationSnoozed({ snoozedUntil: "мусор" }, now), false);
  assert.equal(isNotificationSnoozed({ snoozedUntil: now.getTime() + 1000 }, now), true);
});
