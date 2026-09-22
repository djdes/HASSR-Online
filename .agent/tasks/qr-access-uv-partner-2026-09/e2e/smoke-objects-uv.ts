// Смоук: наклейки объектов без смены объекта, «Кто заполняет», УФ-лампа «включил/выключил» с ресурсом.
// Запуск (dev на 3020 с wesetup_e2e): npx tsx .agent/tasks/qr-access-uv-partner-2026-09/e2e/smoke-objects-uv.ts
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";

import { db } from "../../journal-responsibles-org-2026-09/e2e/db";

const BASE = process.env.BASE ?? "http://localhost:3020";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ROOT = path.resolve(HERE, "..", "..", "..", "..");
const SHOTS = path.join(HERE, "..", "shots");
const state = JSON.parse(
  fs.readFileSync(path.join(HERE, "..", "..", "journal-responsibles-org-2026-09", "e2e", "state.json"), "utf8")
);
const ORG = "e2e-org-a";
for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^(EQUIPMENT_QR_TOKEN_SECRET|TELEGRAM_LINK_TOKEN_SECRET|NEXTAUTH_SECRET)=(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail !== undefined ? ` :: ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
};

async function login(page: Page, email: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 240_000 });
    await page.waitForLoadState("networkidle").catch(() => null);
    await page.fill("#email", email);
    await page.fill("#password", state.password);
    await page.click('button[type="submit"]').catch(() => null);
    if (await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 }).then(() => true).catch(() => false)) return;
  }
  throw new Error("login failed");
}

async function main() {
  const { mintQrFillToken } = await import("../../../../src/lib/qr-fill-token");
  const cook = state.users.cookA as { id: string; name: string };
  const cleaner = state.users.cleanerA as { id: string; name: string };
  const fridge = await db.equipment.findFirstOrThrow({
    where: { area: { organizationId: ORG }, type: { in: ["refrigerator", "freezer"] } },
    select: { id: true, name: true, fillerUserIds: true, areaId: true },
  });
  const org = await db.organization.findUniqueOrThrow({ where: { id: ORG }, select: { qrFillMode: true } });
  const pins = await db.user.findMany({ where: { id: { in: [cook.id, cleaner.id] } }, select: { id: true, qrPinHash: true, qrPinEncrypted: true } });
  const browser = await chromium.launch({ channel: "chrome" });
  const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
  let lampId: string | null = null;
  try {
    await db.organization.update({ where: { id: ORG }, data: { qrFillMode: "public" } });
    await db.user.updateMany({ where: { id: { in: [cook.id, cleaner.id] } }, data: { qrPinHash: null, qrPinEncrypted: null } });
    await db.equipment.update({ where: { id: fridge.id }, data: { fillerUserIds: [cook.id] } });

    // ---- наклейка холодильника
    const token = mintQrFillToken("equipment", fridge.id);
    const ctx = await browser.newContext(mobile);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/equipment-fill/${fridge.id}?token=${encodeURIComponent(token)}`, { waitUntil: "load", timeout: 240_000 });
    await page.waitForLoadState("networkidle").catch(() => null);
    const html = await page.content();
    await page.screenshot({ path: path.join(SHOTS, "40-fridge-sticker.png"), fullPage: true });
    check("наклейка: нет «Сменить» и «Дальше» к другим холодильникам", !/>Сменить<|Дальше:/.test(html));
    check("на наклейке нет ссылок-токенов на другие объекты", (html.match(/equipment-fill\/[a-z0-9]+\?token=/g) ?? []).length === 0);
    check("в выборе — закреплённый повар, нет уборщицы", html.includes(cook.name) && !html.includes(cleaner.name), { cook: html.includes(cook.name), cleaner: html.includes(cleaner.name) });

    const denied = await ctx.request.post(`${BASE}/api/equipment-fill/${fridge.id}`, { data: { token, employeeId: cleaner.id, temperature: 4 } });
    check("чужой сотрудник — отказ сервера (403)", denied.status() === 403, await denied.text());

    // ---- УФ-лампа: создание руководителем
    const manager = await (await browser.newContext()).newPage();
    await login(manager, state.users.managerA.email);
    const created = await manager.context().request.post(`${BASE}/api/equipment`, {
      data: { name: "УФ смоук", type: "uv_lamp", areaId: fridge.areaId, lampModel: "Philips TUV 15W / 30W / 36W", lampLifetimeHours: 100, lampUsedHours: 91, fillerUserIds: [cook.id] },
    });
    const createdBody = (await created.json()) as { equipment?: { id: string; lampLifetimeHours: number; lampUsedHours: number } };
    lampId = createdBody.equipment?.id ?? null;
    check("УФ-лампа создаётся (раньше 400), ресурс и наработка сохранены", created.status() === 201 && createdBody.equipment?.lampLifetimeHours === 100 && createdBody.equipment?.lampUsedHours === 91, createdBody);
    if (!lampId) throw new Error("lamp not created");

    const lampToken = mintQrFillToken("equipment", lampId);
    const lampPage = await ctx.newPage();
    await lampPage.goto(`${BASE}/equipment-fill/${lampId}?token=${encodeURIComponent(lampToken)}`, { waitUntil: "load", timeout: 240_000 });
    await lampPage.getByTestId("uv-toggle").waitFor({ timeout: 60_000 });
    check("наклейка лампы: кнопка «Я включил облучатель»", (await lampPage.getByTestId("uv-toggle").innerText()).includes("Я включил"));
    const lampHtml = await lampPage.content();
    check("в выборе лампы — только список журнала (закреплённый повар)", lampHtml.includes(cook.name) && !lampHtml.includes(cleaner.name));
    await lampPage.screenshot({ path: path.join(SHOTS, "41-uv-lamp-off.png"), fullPage: true });

    const deniedOn = await ctx.request.post(`${BASE}/api/equipment-fill/${lampId}/uv`, { data: { token: lampToken, employeeId: cleaner.id, action: "on" } });
    check("чужой не может включить лампу (403)", deniedOn.status() === 403, await deniedOn.text());

    const on = await ctx.request.post(`${BASE}/api/equipment-fill/${lampId}/uv`, { data: { token: lampToken, employeeId: cook.id, action: "on" } });
    const onBody = (await on.json()) as { ok?: boolean; action?: string };
    check("«Я включил» — записано", on.status() === 200 && onBody.action === "on", onBody);
    const twice = await ctx.request.post(`${BASE}/api/equipment-fill/${lampId}/uv`, { data: { token: lampToken, employeeId: cook.id, action: "on" } });
    check("второй раз «включил» — понятный отказ (409)", twice.status() === 409, await twice.text());

    await lampPage.reload({ waitUntil: "load" });
    await lampPage.getByTestId("uv-running").waitFor({ timeout: 60_000 });
    check("после включения кнопка стала «Я выключил облучатель»", (await lampPage.getByTestId("uv-toggle").innerText()).includes("Я выключил"));
    await lampPage.screenshot({ path: path.join(SHOTS, "42-uv-lamp-on.png"), fullPage: true });

    // Сеанс «длился» 30 минут: сдвигаем время включения назад.
    await db.equipment.update({ where: { id: lampId }, data: { runningSince: new Date(Date.now() - 30 * 60_000) } });
    await db.equipmentRunSession.updateMany({ where: { equipmentId: lampId, endedAt: null }, data: { startedAt: new Date(Date.now() - 30 * 60_000) } });
    const off = await ctx.request.post(`${BASE}/api/equipment-fill/${lampId}/uv`, { data: { token: lampToken, employeeId: cook.id, action: "off" } });
    const offBody = (await off.json()) as { action?: string; durationLabel?: string; warn?: string | null; remainingHours?: number };
    check("«Я выключил» — длительность 30 мин, ресурс почти исчерпан", off.status() === 200 && offBody.durationLabel === "30 мин" && offBody.warn === "warn", offBody);
    const lamp = await db.equipment.findUniqueOrThrow({ where: { id: lampId }, select: { lampUsedHours: true, runningSince: true, lampWarnLevel: true } });
    check("наработка выросла на 0,5 ч, лампа выключена", Math.abs(lamp.lampUsedHours - 91.5) < 0.02 && lamp.runningSince === null && lamp.lampWarnLevel === "warn", lamp);
    const docs = await db.journalDocument.findMany({ where: { organizationId: ORG, template: { code: "uv_lamp_runtime" }, status: "active" }, select: { id: true, config: true } });
    const lampDoc = docs.find((doc) => (doc.config as { equipmentId?: string } | null)?.equipmentId === lampId);
    const entry = lampDoc
      ? await db.journalDocumentEntry.findFirst({ where: { documentId: lampDoc.id, employeeId: cook.id }, select: { data: true } })
      : null;
    const entryData = entry?.data as { startTime?: string; endTime?: string } | undefined;
    check("сеанс записан в журнал учёта работы этой лампы", Boolean(lampDoc) && Boolean(entryData?.startTime) && Boolean(entryData?.endTime), { lampDoc: lampDoc?.id, entryData });
    const warnNote = await db.notification.findFirst({ where: { organizationId: ORG, kind: "uv-lamp-resource" }, select: { title: true, userId: true } });
    check("ответственному — уведомление «пора заказать лампу»", Boolean(warnNote) && /заказать/.test(warnNote?.title ?? ""), warnNote);

    await lampPage.reload({ waitUntil: "load" });
    await lampPage.getByTestId("uv-toggle").waitFor({ timeout: 60_000 });
    check("после выключения снова «Я включил облучатель»", (await lampPage.getByTestId("uv-toggle").innerText()).includes("Я включил"));
  } finally {
    await browser.close();
    if (lampId) {
      const docs = await db.journalDocument.findMany({ where: { organizationId: ORG, template: { code: "uv_lamp_runtime" } }, select: { id: true, config: true } });
      const lampDocIds = docs.filter((doc) => (doc.config as { equipmentId?: string } | null)?.equipmentId === lampId).map((doc) => doc.id);
      await db.journalDocumentEntry.deleteMany({ where: { documentId: { in: lampDocIds } } });
      await db.journalDocument.deleteMany({ where: { id: { in: lampDocIds } } });
      await db.equipment.delete({ where: { id: lampId } }).catch(() => null);
    }
    await db.notification.deleteMany({ where: { organizationId: ORG, kind: "uv-lamp-resource" } });
    await db.equipment.update({ where: { id: fridge.id }, data: { fillerUserIds: fridge.fillerUserIds } });
    for (const pin of pins) await db.user.update({ where: { id: pin.id }, data: { qrPinHash: pin.qrPinHash, qrPinEncrypted: pin.qrPinEncrypted } });
    await db.organization.update({ where: { id: ORG }, data: { qrFillMode: org.qrFillMode } });
    fs.writeFileSync(path.join(HERE, "smoke-objects-uv.json"), JSON.stringify(checks, null, 2));
    await db.$disconnect();
  }
  const failed = checks.filter((item) => !item.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
