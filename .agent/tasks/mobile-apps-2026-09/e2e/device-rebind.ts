// Review Focus 2: телефон передали другому сотруднику — ключ устройства
// переезжает на последнего вошедшего, а не задваивается.
// Запуск (стенд на 3021): node --import tsx .agent/tasks/mobile-apps-2026-09/e2e/device-rebind.ts
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { APP_UA, BASE, USERS, db, signIn } from "./server-db";

const TOKEN = `e2e-rebind-${Date.now()}-${"x".repeat(40)}`;

async function main() {
  const browser = await chromium.launch({ headless: true });
  const results: Record<string, unknown> = {};
  try {
    const anon = await browser.newContext({ userAgent: APP_UA("1.0.0") });
    const post401 = await anon.request.post(`${BASE}/api/mobile/devices`, {
      data: { token: TOKEN, platform: "android" },
    });
    const del401 = await anon.request.delete(`${BASE}/api/mobile/devices`, { data: { token: TOKEN } });
    results.anonPost = post401.status();
    results.anonDelete = del401.status();
    assert.equal(post401.status(), 401);
    assert.equal(del401.status(), 401);

    const cook = await browser.newContext({ userAgent: APP_UA("1.0.0") });
    await signIn(cook, USERS.cookA);
    const bad = await cook.request.post(`${BASE}/api/mobile/devices`, {
      data: { token: "short", platform: "android" },
    });
    results.badToken = bad.status();
    assert.equal(bad.status(), 400);
    const r1 = await cook.request.post(`${BASE}/api/mobile/devices`, {
      data: { token: TOKEN, platform: "android" },
    });
    results.cookPost = r1.status();
    assert.equal(r1.status(), 200);
    const cookUser = await db.user.findUniqueOrThrow({ where: { email: USERS.cookA }, select: { id: true } });
    let rows = await db.mobileDevice.findMany({ where: { token: TOKEN } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].userId, cookUser.id);
    assert.equal(rows[0].appVersion, "1.0.0");
    // Повар выключил уведомления на телефоне; новый запуск приложения
    // (повторная регистрация того же человека) выбор не сбрасывает.
    await db.mobileDevice.update({ where: { token: TOKEN }, data: { pushEnabled: false } });
    await cook.request.post(`${BASE}/api/mobile/devices`, { data: { token: TOKEN, platform: "android" } });
    rows = await db.mobileDevice.findMany({ where: { token: TOKEN } });
    assert.equal(rows[0].pushEnabled, false);

    const cleaner = await browser.newContext({ userAgent: APP_UA("1.0.1") });
    await signIn(cleaner, USERS.cleanerA);
    const r2 = await cleaner.request.post(`${BASE}/api/mobile/devices`, {
      data: { token: TOKEN, platform: "android" },
    });
    results.cleanerPost = r2.status();
    assert.equal(r2.status(), 200);
    const cleanerUser = await db.user.findUniqueOrThrow({
      where: { email: USERS.cleanerA },
      select: { id: true },
    });
    rows = await db.mobileDevice.findMany({ where: { token: TOKEN } });
    results.rowsAfterRebind = rows.map((r) => ({
      userId: r.userId,
      appVersion: r.appVersion,
      pushEnabled: r.pushEnabled,
    }));
    assert.equal(rows.length, 1, "одна запись на ключ");
    assert.equal(rows[0].userId, cleanerUser.id, "ключ переехал на уборщицу");
    assert.equal(rows[0].appVersion, "1.0.1");
    assert.equal(rows[0].pushEnabled, true, "выбор прошлого владельца сброшен");

    // Прошлый владелец отвязать уже чужой телефон не может.
    const d1 = await cook.request.delete(`${BASE}/api/mobile/devices`, { data: { token: TOKEN } });
    results.cookDelete = await d1.json();
    assert.deepEqual(results.cookDelete, { ok: true, removed: 0 });
    const d2 = await cleaner.request.delete(`${BASE}/api/mobile/devices`, { data: { token: TOKEN } });
    results.cleanerDelete = await d2.json();
    assert.deepEqual(results.cleanerDelete, { ok: true, removed: 1 });
    assert.equal(await db.mobileDevice.count({ where: { token: TOKEN } }), 0);
    console.log(JSON.stringify({ ok: true, ...results }, null, 2));
  } finally {
    await db.mobileDevice.deleteMany({ where: { token: TOKEN } });
    await browser.close();
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error("FAIL", error);
  process.exit(1);
});
