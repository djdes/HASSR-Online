// Stream server-fixes (раунд 2): тихие часы для сотрудника без Telegram
// и push без 20-секундного окна. Без реального FCM и Telegram: e2e-база,
// поддельный сервисный аккаунт Firebase, перехваченный fetch.
// Запуск из d:/wt/mobile-apps:
//   node --import tsx .agent/tasks/mobile-apps-2026-09/e2e/fix2-quiet-push.ts
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { Prisma } from "@prisma/client";

const E2E = "postgresql://postgres:postgres@localhost:5432/wesetup_e2e?sslmode=disable";
process.env.DATABASE_URL = E2E;
process.env.DATABASE_URL_DIRECT = E2E;
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.TELEGRAM_FORCE_IP;
const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
  project_id: "e2e-fake",
  client_email: "e2e@e2e-fake.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
});

type Sent = { token: string; title: string; body: string; url: string };
const sent: Sent[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("https://oauth2.googleapis.com/")) {
    return new Response(JSON.stringify({ access_token: "fake", expires_in: 3600 }), { status: 200 });
  }
  if (url.startsWith("https://fcm.googleapis.com/")) {
    const m = JSON.parse(String(init?.body)).message;
    sent.push({ token: m.token, title: m.notification.title, body: m.notification.body, url: m.data.url });
    return new Response(JSON.stringify({ name: "projects/e2e-fake/messages/1" }), { status: 200 });
  }
  if (/googleapis|yandex|telegram/.test(url)) throw new Error(`unexpected external fetch ${url}`);
  return realFetch(input, init);
}) as typeof fetch;

const settle = () => new Promise((r) => setTimeout(r, 1500));
// Тихие часы почти на весь день — «сейчас» точно попадает в окно.
const QUIET = { quietHours: { enabled: true, from: "00:00", to: "23:59" } };

async function main() {
  const { db } = await import("@/lib/db");
  const { notifyEmployee, sendDeferredTelegramLogs } = await import("@/lib/telegram");
  const { upsertNotification } = await import("@/lib/notifications");
  const state = JSON.parse(
    fs.readFileSync("D:/www/Wesetup.ru/.agent/tasks/journal-responsibles-org-2026-09/e2e/state.json", "utf8")
  );
  const cook = await db.user.findUniqueOrThrow({
    where: { id: state.users.cookA.id },
    select: { id: true, organizationId: true, telegramChatId: true, notificationPrefs: true },
  });
  const out: Record<string, unknown> = {};
  const saved = { prefs: cook.notificationPrefs, chat: cook.telegramChatId };
  const stamp = Date.now();
  const token = `e2e-fix2-cook-${stamp}`;
  const bellKey = `e2e-fix2-bell:${stamp}`;
  const createdLogIds: string[] = [];
  try {
    await db.mobileDevice.create({
      data: { organizationId: cook.organizationId, userId: cook.id, platform: "android", token, appVersion: "1.0.0" },
    });

    // 1. Только приложение, тихие часы: ночью push нет, строка deferred с пустым chatId.
    await db.user.update({ where: { id: cook.id }, data: { telegramChatId: null, notificationPrefs: QUIET } });
    const key1 = `e2e-fix2-quiet-app:${stamp}`;
    await notifyEmployee(cook.id, "<b>Задачи на сегодня</b>\nГигиена", undefined, {
      delivery: { organizationId: cook.organizationId, kind: "e2e.fix2", dedupeKey: key1 },
      policy: { skipOnRerun: true },
    });
    // Повтор крона ночью — вторая строка не появляется.
    await notifyEmployee(cook.id, "<b>Задачи на сегодня</b>\nГигиена", undefined, {
      delivery: { organizationId: cook.organizationId, kind: "e2e.fix2", dedupeKey: key1 },
      policy: { skipOnRerun: true },
    });
    await settle();
    const night1 = await db.telegramLog.findMany({ where: { dedupeKey: key1 }, select: { id: true, chatId: true, status: true, deliverAfter: true } });
    createdLogIds.push(...night1.map((r) => r.id));
    out.appOnlyNight = { pushes: sent.length, rows: night1 };
    assert.equal(sent.length, 0, "ночью push не будит");
    assert.equal(night1.length, 1, "одна отложенная строка, повтор крона её видит");
    assert.equal(night1[0].chatId, "");
    assert.equal(night1[0].status, "deferred");

    // 2. С Telegram, тихие часы: две отложенные строки (Telegram и push).
    await db.user.update({ where: { id: cook.id }, data: { telegramChatId: "e2e-fix2-chat", notificationPrefs: QUIET } });
    const key2 = `e2e-fix2-quiet-tg:${stamp}`;
    await notifyEmployee(cook.id, "Напоминание: журнал гигиены", undefined, {
      delivery: { organizationId: cook.organizationId, kind: "e2e.fix2", dedupeKey: key2 },
    });
    const night2 = await db.telegramLog.findMany({ where: { dedupeKey: key2 }, select: { id: true, chatId: true, status: true } });
    createdLogIds.push(...night2.map((r) => r.id));
    out.telegramNight = night2;
    assert.deepEqual(night2.map((r) => [r.chatId, r.status]).sort(), [["", "deferred"], ["e2e-fix2-chat", "deferred"]]);

    // Утро: крон отложенных. Бот на стенде не настроен — Telegram-строка
    // станет failed «bot not configured» (так и раньше), push уходят.
    const morning = new Date(Date.now() + 2 * 24 * 3600_000);
    const flushed = await sendDeferredTelegramLogs(morning);
    await settle();
    const after = await db.telegramLog.findMany({
      where: { id: { in: createdLogIds } },
      select: { chatId: true, status: true, error: true, dedupeKey: true },
    });
    out.morning = { flushed, pushes: [...sent], rows: after };
    const mine = sent.filter((s) => s.token === token);
    assert.equal(mine.length, 2, "утром — по одному push на каждое отложенное сообщение");
    assert.deepEqual(mine.map((s) => s.url), ["/mini", "/mini"]);
    assert.equal(after.filter((r) => r.chatId === "" && r.status === "push_only").length, 2);
    assert.equal(after.find((r) => r.chatId === "e2e-fix2-chat")?.error, "bot not configured");

    // 3. Без тихих часов: push колокольчика не глушит push бота про другое событие.
    await db.user.update({ where: { id: cook.id }, data: { telegramChatId: null, notificationPrefs: {} } });
    sent.length = 0;
    await upsertNotification({
      organizationId: cook.organizationId,
      userId: cook.id,
      kind: "e2e.fix2",
      dedupeKey: bellKey,
      title: "Колокольчик e2e",
      items: [{ id: "1", label: "Первое событие" }],
    });
    await notifyEmployee(cook.id, "🌡 Другое событие: температура");
    await settle();
    out.bellThenBot = sent.filter((s) => s.token === token).map((s) => s.title + " / " + s.body);
    assert.equal(sent.filter((s) => s.token === token).length, 2, "оба push дошли");

    // appPush: false — только колокольчик.
    sent.length = 0;
    await notifyEmployee(cook.id, "То же событие, что в колокольчике", undefined, { appPush: false });
    await settle();
    out.optOut = sent.length;
    assert.equal(sent.length, 0);

    console.log(JSON.stringify(out, null, 2));
    console.log("OK fix2-quiet-push");
  } finally {
    await db.mobileDevice.deleteMany({ where: { token } });
    await db.telegramLog.deleteMany({
      where: { OR: [{ id: { in: createdLogIds } }, { userId: cook.id, kind: "e2e.fix2" }, { userId: cook.id, createdAt: { gte: new Date(stamp) } }] },
    });
    await db.notification.deleteMany({ where: { dedupeKey: bellKey } });
    await db.user.update({
      where: { id: cook.id },
      data: { telegramChatId: saved.chat, notificationPrefs: saved.prefs === null ? Prisma.DbNull : (saved.prefs as Prisma.InputJsonValue) },
    });
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
