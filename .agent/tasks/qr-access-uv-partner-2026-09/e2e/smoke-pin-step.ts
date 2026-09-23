// Смоук: единые правила PIN на наклейках объектов — PIN шагом до формы, пропуск визита, «Запомнить выбор».
// Запуск (dev на 3020 с wesetup_e2e): npx tsx .agent/tasks/qr-access-uv-partner-2026-09/e2e/smoke-pin-step.ts
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { chromium } from "playwright";

import { db } from "../../journal-responsibles-org-2026-09/e2e/db";

const BASE = process.env.BASE ?? "http://localhost:3020";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ROOT = path.resolve(HERE, "..", "..", "..", "..");
const SHOTS = path.join(HERE, "..", "shots");
const state = JSON.parse(
  fs.readFileSync(path.join(HERE, "..", "..", "journal-responsibles-org-2026-09", "e2e", "state.json"), "utf8")
);
const ORG = "e2e-org-a";
const PIN = "4821";
for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^(EQUIPMENT_QR_TOKEN_SECRET|TELEGRAM_LINK_TOKEN_SECRET|NEXTAUTH_SECRET)=(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail !== undefined ? ` :: ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
};

async function main() {
  const { mintQrFillToken } = await import("../../../../src/lib/qr-fill-token");
  const cook = state.users.cookA as { id: string; name: string };
  const fridge = await db.equipment.findFirstOrThrow({
    where: { area: { organizationId: ORG }, type: { in: ["refrigerator", "freezer"] } },
    select: { id: true, fillerUserIds: true, tempMin: true, tempMax: true },
  });
  // Замер внутри нормы объекта (холодильник или морозилка), чтобы не требовалось «что сделали».
  const inNorm = String(Math.round(((fridge.tempMin ?? 2) + (fridge.tempMax ?? 6)) / 2));
  const room = await db.room.findFirst({ where: { building: { organizationId: ORG } }, select: { id: true, fillerUserIds: true } });
  const org = await db.organization.findUniqueOrThrow({ where: { id: ORG }, select: { qrFillMode: true } });
  const saved = await db.user.findUniqueOrThrow({
    where: { id: cook.id },
    select: { qrPinHash: true, qrPinEncrypted: true, qrPinFailedCount: true, qrPinLockedUntil: true },
  });
  // Самодостаточность: морозилка/холодильник должны входить в активный документ
  // холодильников на сегодня, иначе «Сохранить» неактивна (данные стенда меняют
  // другие смоуки). Нет такого документа — создаём временный и удаляем в finally.
  const tz = (await db.organization.findUniqueOrThrow({ where: { id: ORG }, select: { timezone: true } })).timezone || "Europe/Moscow";
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const today = new Date(`${todayKey}T00:00:00.000Z`);
  const coldTemplate = await db.journalTemplate.findUniqueOrThrow({ where: { code: "cold_equipment_control" }, select: { id: true } });
  const activeCold = await db.journalDocument.findMany({
    where: { organizationId: ORG, templateId: coldTemplate.id, status: "active", dateFrom: { lte: today }, dateTo: { gte: today } },
    select: { id: true, config: true },
  });
  const covered = activeCold.some((doc) =>
    ((doc.config as { equipment?: Array<{ sourceEquipmentId?: string; equipmentId?: string }> } | null)?.equipment ?? []).some(
      (item) => item.sourceEquipmentId === fridge.id || item.equipmentId === fridge.id
    )
  );
  let tempColdDocId: string | null = null;
  if (!covered) {
    const fridgeRow = await db.equipment.findUniqueOrThrow({ where: { id: fridge.id }, select: { name: true } });
    const created = await db.journalDocument.create({
      data: {
        organizationId: ORG,
        templateId: coldTemplate.id,
        title: "PIN E2E холодильники",
        dateFrom: today,
        dateTo: today,
        responsibleUserId: cook.id,
        config: {
          equipment: [{ id: "pin-e2e-cold", sourceEquipmentId: fridge.id, name: fridgeRow.name, min: fridge.tempMin ?? 2, max: fridge.tempMax ?? 6 }],
          skipWeekends: false,
        },
      },
    });
    tempColdDocId = created.id;
  }
  console.log(`холодильник ${fridge.id}: ${covered ? "уже в активном документе" : `создан временный документ ${tempColdDocId}`}`);
  const browser = await chromium.launch({ channel: "chrome" });
  const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
  try {
    await db.organization.update({ where: { id: ORG }, data: { qrFillMode: "public" } });
    await db.user.update({
      where: { id: cook.id },
      data: { qrPinHash: await bcrypt.hash(PIN, 10), qrPinEncrypted: null, qrPinFailedCount: 0, qrPinLockedUntil: null },
    });
    await db.equipment.update({ where: { id: fridge.id }, data: { fillerUserIds: [cook.id] } });

    const token = mintQrFillToken("equipment", fridge.id);
    const url = `${BASE}/equipment-fill/${fridge.id}?token=${encodeURIComponent(token)}`;

    // ---- API: без пропуска PIN не обойти
    const api = await browser.newContext();
    const noPass = await api.request.post(`${BASE}/api/equipment-fill/${fridge.id}`, { data: { token, employeeId: cook.id, temperature: 4 } });
    check("сохранение без PIN/пропуска — отказ", noPass.status() >= 400 && noPass.status() < 500, { status: noPass.status(), body: await noPass.text() });
    const fakePass = await api.request.post(`${BASE}/api/equipment-fill/${fridge.id}`, { data: { token, employeeId: cook.id, temperature: 4, pass: "fake.pass" } });
    check("поддельный пропуск — отказ", fakePass.status() >= 400 && fakePass.status() < 500, { status: fakePass.status() });

    // ---- страница: выбран повар → сначала шаг PIN, полей нет
    const ctx = await browser.newContext(mobile);
    await ctx.addInitScript((id) => {
      try {
        localStorage.setItem("wesetup.qr-fill.employeeId", id);
      } catch {}
    }, cook.id);
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "load", timeout: 240_000 });
    await page.waitForLoadState("networkidle").catch(() => null);
    const stepVisible = await page.locator('[data-testid="qr-pin-step"]').isVisible().catch(() => false);
    const fieldBefore = await page.locator("#equipment-fill-temperature").count();
    await page.screenshot({ path: path.join(SHOTS, "60-pin-step.png"), fullPage: true });
    check("PIN — отдельный шаг до формы (полей ещё нет)", stepVisible && fieldBefore === 0, { stepVisible, fieldBefore });
    check("галка «Запомнить выбор» на месте", await page.locator('[data-testid="qr-remember"]').isChecked().catch(() => false));

    await page.fill(".qp-pin", "0000");
    await page.click('[data-testid="qr-pin-step"] button[type="submit"]');
    await page.locator(".qp-err").waitFor({ timeout: 30_000 }).catch(() => null);
    check("неверный PIN — понятная ошибка, поля закрыты", (await page.locator(".qp-err").count()) === 1 && (await page.locator("#equipment-fill-temperature").count()) === 0);

    await page.fill(".qp-pin", PIN);
    await page.click('[data-testid="qr-pin-step"] button[type="submit"]');
    await page.locator("#equipment-fill-temperature").waitFor({ timeout: 30_000 }).catch(() => null);
    const okShown = (await page.locator(".qp-ok").count()) > 0;
    await page.screenshot({ path: path.join(SHOTS, "61-pin-ok.png"), fullPage: true });
    check("верный PIN — зелёная галка и поля показались", okShown && (await page.locator("#equipment-fill-temperature").count()) === 1, { okShown });
    const cookies = await ctx.cookies();
    check("выбор запомнен в cookie организации", cookies.some((c) => c.name === `wesetup.qr.who.${ORG}`), cookies.map((c) => c.name));

    await page.fill("#equipment-fill-temperature", inNorm);
    await page.screenshot({ path: path.join(SHOTS, "63-before-save.png"), fullPage: true });
    await page.getByRole("button", { name: /Сохранить/ }).click({ timeout: 30_000 });
    const recorded = await page.getByText("Записано").first().waitFor({ timeout: 60_000 }).then(() => true).catch(() => false);
    check("замер сохранён с пропуском визита", recorded, recorded ? undefined : (await page.content()).slice(0, 300));

    // ---- новое устройство с той же cookie (без localStorage): повар выбран, PIN спрашивается снова
    const ctx2 = await browser.newContext(mobile);
    await ctx2.addCookies(cookies.filter((c) => c.name.startsWith("wesetup.qr.who.")));
    const page2 = await ctx2.newPage();
    await page2.goto(url, { waitUntil: "load", timeout: 240_000 });
    await page2.waitForLoadState("networkidle").catch(() => null);
    check(
      "cookie «Запомнить выбор» подставляет сотрудника, PIN — снова",
      (await page2.locator('[data-testid="qr-pin-step"]').isVisible().catch(() => false)) && (await page2.content()).includes(cook.name.split(" ")[0])
    );

    // ---- пропуск на 30 минут (cookie wesetup.qr.pass.<org>) переезжает вместе с выбором: PIN не спрашивается
    const passCookie = cookies.find((c) => c.name === `wesetup.qr.pass.${ORG}`);
    check("после верного PIN с «Запомнить выбор» выдан пропуск wesetup.qr.pass.<org>", Boolean(passCookie), cookies.map((c) => c.name));
    const ctx3 = await browser.newContext(mobile);
    await ctx3.addCookies(cookies.filter((c) => c.name.startsWith("wesetup.qr.who.") || c.name === `wesetup.qr.pass.${ORG}`));
    const page4 = await ctx3.newPage();
    await page4.goto(url, { waitUntil: "load", timeout: 240_000 });
    await page4.waitForLoadState("networkidle").catch(() => null);
    const passStep = await page4.locator('[data-testid="qr-pin-step"]').isVisible().catch(() => false);
    const passField = await page4.locator("#equipment-fill-temperature").count();
    check("с копией пропуска wesetup.qr.pass.<org> PIN НЕ спрашивается, поля сразу", !passStep && passField === 1, { passStep, passField });
    await ctx3.close();

    // ---- помещение: тот же шаг PIN
    if (room) {
      await db.room.update({ where: { id: room.id }, data: { fillerUserIds: [] } });
      const roomToken = mintQrFillToken("room", room.id);
      // Пропуск на 30 минут у ctx уже есть — PIN на помещении спрашиваем в контексте
      // без пропуска (ctx2: только запомненный выбор).
      const withPass = await ctx.newPage();
      await withPass.goto(`${BASE}/room-fill/${room.id}?token=${encodeURIComponent(roomToken)}`, { waitUntil: "load", timeout: 240_000 });
      await withPass.waitForLoadState("networkidle").catch(() => null);
      check(
        "помещение с действующим пропуском (30 минут) — PIN не спрашивается",
        !(await withPass.locator('[data-testid="qr-pin-step"]').isVisible().catch(() => false)) &&
          (await withPass.locator("#room-fill-temperature, #room-fill-humidity").count()) > 0
      );
      await withPass.close();
      const page3 = await ctx2.newPage();
      await page3.goto(`${BASE}/room-fill/${room.id}?token=${encodeURIComponent(roomToken)}`, { waitUntil: "load", timeout: 240_000 });
      await page3.waitForLoadState("networkidle").catch(() => null);
      await page3.screenshot({ path: path.join(SHOTS, "62-room-pin-step.png"), fullPage: true });
      check(
        "помещение: PIN шагом до формы",
        (await page3.locator('[data-testid="qr-pin-step"]').isVisible().catch(() => false)) && (await page3.locator("#room-fill-temperature").count()) === 0
      );
      await page3.fill(".qp-pin", PIN);
      await page3.click('[data-testid="qr-pin-step"] button[type="submit"]');
      const roomField = await page3.locator("#room-fill-temperature, #room-fill-humidity").first().waitFor({ timeout: 30_000 }).then(() => true).catch(() => false);
      check("помещение: после PIN поля показались", roomField);
    } else {
      check("помещение в e2e-организации найдено", false);
    }
  } finally {
    await browser.close();
    if (tempColdDocId) {
      await db.journalDocumentEntry.deleteMany({ where: { documentId: tempColdDocId } });
      await db.journalDocument.delete({ where: { id: tempColdDocId } }).catch(() => null);
    }
    await db.organization.update({ where: { id: ORG }, data: { qrFillMode: org.qrFillMode } });
    await db.user.update({ where: { id: cook.id }, data: saved });
    await db.equipment.update({ where: { id: fridge.id }, data: { fillerUserIds: fridge.fillerUserIds } });
    if (room) await db.room.update({ where: { id: room.id }, data: { fillerUserIds: room.fillerUserIds } });
  }
  const passed = checks.filter((c) => c.ok).length;
  fs.writeFileSync(path.join(HERE, "smoke-pin-step.json"), JSON.stringify({ passed, total: checks.length, checks }, null, 2));
  console.log(`\n${passed}/${checks.length} PASS`);
  process.exit(passed === checks.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
