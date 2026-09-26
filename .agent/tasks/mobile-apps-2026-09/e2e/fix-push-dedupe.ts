// Stream server-fixes, пункты 1 и 2: без реального FCM.
// Прямой вызов notifyEmployee / notifyOrganization на e2e-базе с поддельным
// сервисным аккаунтом Firebase и перехваченным fetch — считаем, сколько
// push ушло бы в FCM.
// Запуск из d:/wt/mobile-apps:
//   node --import tsx .agent/tasks/mobile-apps-2026-09/e2e/fix-push-dedupe.ts
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

async function main() {
  const { db } = await import("@/lib/db");
  const { notifyEmployee, notifyOrganization } = await import("@/lib/telegram");
  const state = JSON.parse(
    fs.readFileSync("D:/www/Wesetup.ru/.agent/tasks/journal-responsibles-org-2026-09/e2e/state.json", "utf8")
  );
  const cook = await db.user.findUniqueOrThrow({
    where: { id: state.users.cookA.id },
    select: { id: true, organizationId: true, telegramChatId: true, notificationPrefs: true },
  });
  const manager = await db.user.findUniqueOrThrow({
    where: { id: state.users.managerA.id },
    select: { id: true, organizationId: true, telegramChatId: true, notificationPrefs: true, role: true },
  });
  const out: Record<string, unknown> = { cookTelegram: cook.telegramChatId, managerTelegram: manager.telegramChatId, managerRole: manager.role };
  const saved = { cook: cook.notificationPrefs, manager: manager.notificationPrefs, cookChat: cook.telegramChatId, managerChat: manager.telegramChatId };
  const dedupeKey = `e2e-fix-dedupe:${Date.now()}`;
  const tokens = { cook: `e2e-fix-cook-${Date.now()}`, manager: `e2e-fix-mgr-${Date.now()}` };
  try {
    // Без Telegram, без тихих часов и «отложить».
    await db.user.update({ where: { id: cook.id }, data: { telegramChatId: null, notificationPrefs: {} } });
    await db.user.update({ where: { id: manager.id }, data: { telegramChatId: null, notificationPrefs: {} } });
    await db.mobileDevice.createMany({
      data: [
        { organizationId: cook.organizationId, userId: cook.id, platform: "android", token: tokens.cook, appVersion: "1.0.0" },
        { organizationId: manager.organizationId, userId: manager.id, platform: "android", token: tokens.manager, appVersion: "1.0.0" },
      ],
    });

    // 1. Крон дважды с тем же ключом — один push, одна строка push_only.
    const opts = {
      delivery: { organizationId: cook.organizationId, kind: "e2e.fix-dedupe", dedupeKey },
      policy: { skipOnRerun: true },
    };
    await notifyEmployee(cook.id, "<b>Задачи на сегодня</b>\nГигиена, температура", { label: "Открыть", miniAppUrl: "/mini" }, opts);
    await settle();
    await notifyEmployee(cook.id, "<b>Задачи на сегодня</b>\nГигиена, температура", { label: "Открыть", miniAppUrl: "/mini" }, opts);
    await settle();
    const cookPushes = sent.filter((s) => s.token === tokens.cook);
    const rows = await db.telegramLog.findMany({ where: { dedupeKey }, select: { status: true, chatId: true, kind: true } });
    out.dedupe = { pushes: cookPushes.length, rows };
    assert.equal(cookPushes.length, 1, "повтор крона не шлёт второй push");
    assert.deepEqual(rows.map((r) => [r.status, r.chatId]), [["push_only", ""]]);

    // Без skipOnRerun строка не пишется (лог не засоряем).
    const before = await db.telegramLog.count({ where: { userId: cook.id, status: "push_only" } });
    sent.length = 0;
    await notifyEmployee(cook.id, "Напоминание без ключа");
    await settle();
    out.noPolicy = { pushes: sent.length, newRows: (await db.telegramLog.count({ where: { userId: cook.id, status: "push_only" } })) - before };
    assert.equal(sent.length, 1);
    assert.equal(out.noPolicy && (out.noPolicy as { newRows: number }).newRows, 0);

    // 2. Тревога руководству — push руководителю без Telegram.
    sent.length = 0;
    await notifyOrganization(
      manager.organizationId,
      "🔴 <b>Превышение температуры — открыт CAPA</b>\n\nХолодильник: 9.1°C (2…6°C, выше)",
      ["owner", "technologist"],
      "temperature"
    );
    await settle();
    out.alert = sent.filter((s) => s.token === tokens.manager);
    assert.equal((out.alert as Sent[]).length, 1, "тревога дошла push'ем");
    assert.equal((out.alert as Sent[])[0].title, "🔴 Превышение температуры — открыт CAPA");

    // Сводка — без push.
    sent.length = 0;
    await notifyOrganization(manager.organizationId, "<b>📊 Сводка за неделю · Кафе</b>\n\nЗаполнено: 90%", ["owner", "manager"], "compliance");
    await settle();
    out.digestPushes = sent.length;
    assert.equal(sent.length, 0, "сводка не уходит push'ем");

    // «Отложить» глушит push тревоги (не срочной).
    await db.user.update({
      where: { id: manager.id },
      data: { notificationPrefs: { snoozedUntil: new Date(Date.now() + 3600_000).toISOString() } },
    });
    sent.length = 0;
    await notifyOrganization(manager.organizationId, "🚨 <b>Сотрудник не вышел на смену?</b>\nИван не заполнил ни одного журнала", ["owner"]);
    await settle();
    out.snoozedPushes = sent.filter((s) => s.token === tokens.manager).length;
    assert.equal(out.snoozedPushes, 0);
    console.log(JSON.stringify(out, null, 2));
    console.log("OK fix-push-dedupe");
  } finally {
    await db.mobileDevice.deleteMany({ where: { token: { in: [tokens.cook, tokens.manager] } } });
    await db.telegramLog.deleteMany({ where: { OR: [{ dedupeKey }, { userId: { in: [cook.id, manager.id] }, status: "push_only" }] } });
    await db.user.update({ where: { id: cook.id }, data: { telegramChatId: saved.cookChat, notificationPrefs: saved.cook === null ? Prisma.DbNull : (saved.cook as Prisma.InputJsonValue) } });
    await db.user.update({ where: { id: manager.id }, data: { telegramChatId: saved.managerChat, notificationPrefs: saved.manager === null ? Prisma.DbNull : (saved.manager as Prisma.InputJsonValue) } });
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
