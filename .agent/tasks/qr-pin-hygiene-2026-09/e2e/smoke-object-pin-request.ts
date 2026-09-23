// Смоук: «Запросить доступ» / «Запросить смену PIN» на наклейках объектов —
// холодильник, помещение, УФ-лампа (React-страницы), 390×844.
// Своя e2e-организация `e2e-org-qrpin` — общую `e2e-org-a` не трогаем.
// Запуск (dev на 3020 с ЛОКАЛЬНОЙ wesetup_e2e):
//   npx tsx .agent/tasks/qr-pin-hygiene-2026-09/e2e/smoke-object-pin-request.ts
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { chromium, type Page } from "playwright";

import { db } from "../../journal-responsibles-org-2026-09/e2e/db";

const BASE = process.env.BASE ?? "http://localhost:3020";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ROOT = path.resolve(HERE, "..", "..", "..", "..");
const SHOTS = path.join(HERE, "..", "shots");
const ORG = "e2e-org-qrpin";
const OLD_PIN = "4821";
for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^(EQUIPMENT_QR_TOKEN_SECRET|TELEGRAM_LINK_TOKEN_SECRET|NEXTAUTH_SECRET)=(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
fs.mkdirSync(SHOTS, { recursive: true });

const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail !== undefined ? ` :: ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
};

async function upsertUser(email: string, name: string, role: string, passwordHash: string) {
  const data = { name, role, organizationId: ORG, isActive: true, archivedAt: null, isRoot: false, passwordHash, phone: "+79990000009" };
  return db.user.upsert({ where: { email }, update: data, create: { email, ...data } });
}

async function setup() {
  await db.organization.upsert({
    where: { id: ORG },
    update: { qrFillMode: "pin", journalResponsibleUsersJson: {}, timezone: "Europe/Moscow" },
    create: {
      id: ORG,
      name: "Кафе «Пин»",
      type: "restaurant",
      phone: "+79990000009",
      subscriptionPlan: "pro",
      subscriptionEnd: new Date(Date.now() + 365 * 86400_000),
      isDemo: false,
      qrFillMode: "pin",
      timezone: "Europe/Moscow",
    },
  });
  const passwordHash = await bcrypt.hash("E2eTest2026!", 10);
  const manager = await upsertUser("qrpin-manager@e2e.local", "Марина Управляющая", "manager", passwordHash);
  const resp = await upsertUser("qrpin-resp@e2e.local", "Роман Ответственный", "cook", passwordHash);
  const cook = await upsertUser("qrpin-cook@e2e.local", "Нина Новенькая", "cook", passwordHash);
  const veteran = await upsertUser("qrpin-veteran@e2e.local", "Виктор Опытный", "cook", passwordHash);
  const noPin = { qrPinHash: null, qrPinEncrypted: null, qrPinFailedCount: 0, qrPinLockedUntil: null };
  await db.user.updateMany({ where: { id: { in: [manager.id, resp.id, cook.id] } }, data: noPin });
  await db.user.update({ where: { id: veteran.id }, data: { ...noPin, qrPinHash: await bcrypt.hash(OLD_PIN, 10) } });
  await db.qrPinRequest.deleteMany({ where: { organizationId: ORG } });
  await db.notification.deleteMany({ where: { organizationId: ORG, kind: "qr_pin_request" } });

  const area = (await db.area.findFirst({ where: { organizationId: ORG, name: "Кухня" } })) ?? (await db.area.create({ data: { organizationId: ORG, name: "Кухня" } }));
  const fridge =
    (await db.equipment.findFirst({ where: { areaId: area.id, name: "Холодильник PIN E2E" } })) ??
    (await db.equipment.create({ data: { areaId: area.id, name: "Холодильник PIN E2E", type: "refrigerator", tempMin: 2, tempMax: 6 } }));
  const lamp =
    (await db.equipment.findFirst({ where: { areaId: area.id, name: "УФ-лампа PIN E2E" } })) ??
    (await db.equipment.create({ data: { areaId: area.id, name: "УФ-лампа PIN E2E", type: "uv_lamp", lampLifetimeHours: 8000 } }));
  await db.equipment.updateMany({ where: { id: { in: [fridge.id, lamp.id] } }, data: { fillerUserIds: [], runningSince: null, runningUserId: null } });
  const building = (await db.building.findFirst({ where: { organizationId: ORG } })) ?? (await db.building.create({ data: { organizationId: ORG, name: "Точка PIN" } }));
  const room =
    (await db.room.findFirst({ where: { buildingId: building.id, name: "Склад PIN E2E" } })) ??
    (await db.room.create({ data: { buildingId: building.id, name: "Склад PIN E2E", kind: "storage" } }));
  await db.room.update({ where: { id: room.id }, data: { fillerUserIds: [] } });

  // Холодильный журнал на сегодня с этим холодильником: ответственный — Роман.
  await db.journalDocument.deleteMany({ where: { organizationId: ORG } });
  const template = await db.journalTemplate.findFirst({ where: { code: "cold_equipment_control" }, select: { id: true } });
  const coldDoc = template
    ? await db.journalDocument.create({
        data: {
          organizationId: ORG,
          templateId: template.id,
          title: "Температура холодильников · PIN E2E",
          dateFrom: new Date(Date.now() - 3 * 86400_000),
          dateTo: new Date(Date.now() + 30 * 86400_000),
          status: "active",
          responsibleUserId: resp.id,
          config: { equipment: [{ id: "pin-e2e-item", sourceEquipmentId: fridge.id, name: "Холодильник PIN E2E", min: 2, max: 6 }] },
        },
        select: { id: true },
      })
    : null;
  return { manager, resp, cook, veteran, fridge, lamp, room, coldDocId: coldDoc?.id ?? null };
}

async function openAs(page: Page, url: string) {
  await page.goto(url, { waitUntil: "load", timeout: 240_000 });
  await page.waitForLoadState("networkidle").catch(() => null);
}

async function main() {
  const { mintQrFillToken } = await import("../../../../src/lib/qr-fill-token");
  const s = await setup();
  const fridgeToken = mintQrFillToken("equipment", s.fridge.id);
  const lampToken = mintQrFillToken("equipment", s.lamp.id);
  const roomToken = mintQrFillToken("room", s.room.id);
  const fridgeUrl = `${BASE}/equipment-fill/${s.fridge.id}?token=${encodeURIComponent(fridgeToken)}`;
  const lampUrl = `${BASE}/equipment-fill/${s.lamp.id}?token=${encodeURIComponent(lampToken)}`;
  const roomUrl = `${BASE}/room-fill/${s.room.id}?token=${encodeURIComponent(roomToken)}`;
  const api = `${BASE}/api/qr-fill/pin-request`;
  const post = (body: Record<string, unknown>) =>
    fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(async (res) => ({ status: res.status, body: await res.json().catch(() => null) }));
  const fridgeTarget = { kind: "equipment", objectId: s.fridge.id, token: fridgeToken };

  // Страховка: dev-сервер должен видеть ту же e2e-базу (на другой базе такого холодильника нет → 404).
  const guard = await fetch(fridgeUrl);
  const guardHtml = await guard.text();
  if (guard.status !== 200 || !guardHtml.includes("Холодильник PIN E2E")) {
    throw new Error(`dev-сервер ${BASE} смотрит не в e2e-базу (status ${guard.status}) — смоук остановлен`);
  }

  // ---- API: наклейка, чужие, «Кто заполняет», режим входа, проверка ввода
  const badToken = await fetch(`${api}?${new URLSearchParams({ ...fridgeTarget, token: roomToken, employeeId: s.cook.id })}`);
  check("GET с чужой наклейкой — 401", badToken.status === 401, { status: badToken.status });
  const otherOrg = await db.user.findFirst({ where: { organizationId: { not: ORG }, isRoot: false }, select: { id: true } });
  if (otherOrg) {
    const foreign = await post({ ...fridgeTarget, employeeId: otherOrg.id, pin: "5937", pin2: "5937" });
    check("POST за сотрудника другой организации — 404", foreign.status === 404, foreign);
  }
  await db.equipment.update({ where: { id: s.fridge.id }, data: { fillerUserIds: [s.veteran.id] } });
  const denied = await post({ ...fridgeTarget, employeeId: s.resp.id, pin: "5937", pin2: "5937" });
  await db.equipment.update({ where: { id: s.fridge.id }, data: { fillerUserIds: [] } });
  check("POST не из «Кто заполняет» — 403", denied.status === 403, denied);
  await db.organization.update({ where: { id: ORG }, data: { qrFillMode: "auth" } });
  const authMode = await post({ ...fridgeTarget, employeeId: s.cook.id, pin: "5937", pin2: "5937" });
  await db.organization.update({ where: { id: ORG }, data: { qrFillMode: "pin" } });
  check("POST в режиме «через кабинет» — 409", authMode.status === 409, authMode);
  const mismatch = await post({ ...fridgeTarget, employeeId: s.cook.id, pin: "5937", pin2: "5938" });
  check("POST: PIN и повтор не совпадают — 400 с понятным текстом", mismatch.status === 400 && /не совпадают/.test(String(mismatch.body?.error)), mismatch);
  check("после отказов запросов в базе нет", (await db.qrPinRequest.count({ where: { organizationId: ORG } })) === 0);

  const browser = await chromium.launch({ channel: "chrome" });
  const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
  try {
    // ---- холодильник, режим «имя + PIN», у Нины PIN нет → «Запросить доступ»
    const ctx = await browser.newContext(mobile);
    await ctx.addInitScript((id) => {
      try {
        localStorage.setItem("wesetup.qr-fill.employeeId", id);
      } catch {}
    }, s.cook.id);
    const page = await ctx.newPage();
    await openAs(page, fridgeUrl);
    const noAccess = page.locator('[data-testid="qr-pin-no-access"]');
    await noAccess.waitFor({ timeout: 60_000 }).catch(() => null);
    check(
      "нет PIN: крупная жёлтая плашка и «Запросить доступ», полей и шага PIN нет",
      (await noAccess.isVisible()) &&
        /Нужен личный PIN/.test((await noAccess.locator(".qp-note").textContent()) ?? "") &&
        (await page.getByRole("button", { name: "Запросить доступ" }).isVisible()) &&
        (await page.locator("#equipment-fill-temperature").count()) === 0 &&
        (await page.locator('[data-testid="qr-pin-step"]').count()) === 0
    );
    const noteFont = await noAccess.locator(".qp-note").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    check("плашка крупная (≥ 21px)", noteFont >= 21, { noteFont });
    await page.screenshot({ path: path.join(SHOTS, "10-fridge-no-access.png"), fullPage: true });

    await page.getByRole("button", { name: "Запросить доступ" }).click();
    const form = page.locator('[data-testid="qr-pin-request"]');
    await form.waitFor({ timeout: 10_000 });
    const pins = form.locator(".qp-pin");
    check("форма: «Придумайте PIN» + «Повторите PIN», цифровая клавиатура", (await pins.count()) === 2 && (await pins.first().getAttribute("inputmode")) === "numeric" && /Придумайте PIN/.test((await form.textContent()) ?? ""));
    // «Простые» PIN разрешены с 69035650 (любые 4–6 цифр); короткий не отправить — кнопка неактивна.
    await pins.nth(0).fill("123");
    await pins.nth(1).fill("123");
    check("короткий PIN — «Отправить запрос» неактивна", await form.getByRole("button", { name: "Отправить запрос" }).isDisabled());
    await pins.nth(0).fill("5937");
    await pins.nth(1).fill("5938");
    await form.getByRole("button", { name: "Отправить запрос" }).click();
    check(
      "повтор не совпал — ошибка, стёрт только повтор",
      /не совпадают/.test((await form.locator(".qp-err").textContent().catch(() => "")) ?? "") && (await pins.nth(0).inputValue()) === "5937" && (await pins.nth(1).inputValue()) === ""
    );
    await page.screenshot({ path: path.join(SHOTS, "11-fridge-request-form.png"), fullPage: true });
    await pins.nth(1).fill("5937");
    await form.getByRole("button", { name: "Отправить запрос" }).click();
    const sent = page.locator('[data-testid="qr-pin-request-sent"]');
    await sent.waitFor({ timeout: 60_000 }).catch(() => null);
    check("запрос отправлен — «войдите с этим PIN»", (await sent.isVisible()) && /войдите с этим PIN/.test((await sent.textContent()) ?? ""));
    await page.waitForTimeout(1200); // галка дорисовывается ~0,8 с
    await page.screenshot({ path: path.join(SHOTS, "12-fridge-request-sent.png"), fullPage: true });
    const issued = await db.qrPinRequest.findFirst({ where: { organizationId: ORG, userId: s.cook.id }, orderBy: { createdAt: "desc" } });
    check(
      "в базе: запрос «выдать PIN» ждёт, из наклейки холодильника, журнал и документ холодильника",
      issued?.kind === "issue" &&
        issued.status === "pending" &&
        issued.source === "equipment-fill" &&
        issued.journalCode === "cold_equipment_control" &&
        issued.documentId === s.coldDocId &&
        Boolean(issued.pinHash) &&
        (await bcrypt.compare("5937", issued.pinHash ?? "")),
      issued && { kind: issued.kind, status: issued.status, source: issued.source, journalCode: issued.journalCode, documentId: issued.documentId, coldDocId: s.coldDocId }
    );
    const notified = await db.notification.findMany({ where: { organizationId: ORG, kind: "qr_pin_request" }, select: { userId: true } }).catch(() => []);
    const notifiedIds = new Set(notified.map((item) => item.userId));
    check("сигнал получили ответственный журнала и руководитель", notifiedIds.has(s.resp.id) && notifiedIds.has(s.manager.id), [...notifiedIds]);

    await page.getByRole("button", { name: "Готово" }).click();
    check("«Готово» — снова экран доступа со строкой «ждёт подтверждения»", /ждёт подтверждения/.test((await noAccess.locator(".qp-ok-note").textContent().catch(() => "")) ?? ""));
    await openAs(page, fridgeUrl);
    await noAccess.locator(".qp-ok-note").waitFor({ timeout: 30_000 }).catch(() => null);
    check("после перезагрузки статус запроса виден", /ждёт подтверждения/.test((await noAccess.locator(".qp-ok-note").textContent().catch(() => "")) ?? ""));
    check(
      "при ожидании — подсказка про повторную отправку",
      /заменит прежний/.test((await noAccess.textContent()) ?? "")
    );
    await page.screenshot({ path: path.join(SHOTS, "13-fridge-pending-status.png"), fullPage: true });

    // ---- руководитель одобрил (как decideQrPinRequest): PIN = придуманный
    if (issued) {
      await db.user.update({ where: { id: s.cook.id }, data: { qrPinHash: issued.pinHash, qrPinEncrypted: issued.pinEncrypted, qrPinFailedCount: 0, qrPinLockedUntil: null } });
      await db.qrPinRequest.update({ where: { id: issued.id }, data: { status: "approved", pinHash: null, pinEncrypted: null, decidedById: s.manager.id, decidedAt: new Date() } });
    }
    // Страница открыта со «старым» hasPin=false: сменили сотрудника туда-обратно — шаг сам узнал, что PIN уже есть.
    await page.getByRole("button", { name: /Нина Новенькая/ }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: /Виктор Опытный/ }).click();
    await page.locator('[data-testid="qr-pin-step"]').waitFor({ timeout: 30_000 }).catch(() => null);
    await page.getByRole("button", { name: /Виктор Опытный/ }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: /Нина Новенькая/ }).click();
    const pinStep = page.locator('[data-testid="qr-pin-step"]');
    await pinStep.locator(".qp-ok-note").waitFor({ timeout: 30_000 }).catch(() => null);
    check(
      "одобрено, пока страница открыта: вместо «Запросить доступ» — «Ваш PIN» и зелёное «одобрил»",
      (await pinStep.isVisible()) && /одобрил/.test((await pinStep.locator(".qp-ok-note").textContent().catch(() => "")) ?? "")
    );

    await openAs(page, fridgeUrl);
    await pinStep.waitFor({ timeout: 30_000 }).catch(() => null);
    await pinStep.locator(".qp-ok-note").waitFor({ timeout: 30_000 }).catch(() => null);
    check("после перезагрузки: шаг PIN и «Руководитель одобрил ваш PIN»", /одобрил ваш PIN/.test((await pinStep.locator(".qp-ok-note").textContent().catch(() => "")) ?? ""));
    // Без вложенных функций в evaluate: tsx оборачивает их в __name, которого нет в браузере.
    const widths = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
    const title = await pinStep.locator(".qp-k").boundingBox();
    const link = await page.locator('[data-testid="qr-pin-change"]').boundingBox();
    const card = await pinStep.boundingBox();
    check(
      "390px: «Запросить смену PIN» справа в строке «Ваш PIN», без горизонтального скролла",
      Boolean(title && link && card) &&
        widths.scrollWidth <= widths.innerWidth &&
        link!.x + link!.width <= card!.x + card!.width &&
        link!.x > title!.x + title!.width &&
        link!.y < title!.y + title!.height,
      { widths, title, link, card }
    );
    await page.screenshot({ path: path.join(SHOTS, "14-fridge-pin-step-approved.png"), fullPage: true });

    // ---- «Запросить смену PIN» с шага PIN
    await page.locator('[data-testid="qr-pin-change"]').click();
    const changeForm = page.locator('[data-testid="qr-pin-request"][data-kind="change"]');
    await changeForm.waitFor({ timeout: 10_000 });
    check("смена PIN: текст «ответственный получит запрос… уведомление»", /ответственный получит запрос, после одобрения вы получите уведомление/.test((await changeForm.textContent()) ?? ""));
    await page.screenshot({ path: path.join(SHOTS, "15-fridge-change-form.png"), fullPage: true });
    await changeForm.locator(".qp-pin").nth(0).fill("6284");
    await changeForm.locator(".qp-pin").nth(1).fill("6284");
    await changeForm.getByRole("button", { name: "Отправить запрос" }).click();
    await sent.waitFor({ timeout: 60_000 }).catch(() => null);
    check("смена: запрос отправлен, «пока действует старый»", /Пока действует старый/.test((await sent.textContent().catch(() => "")) ?? ""));
    const changed = await db.qrPinRequest.findFirst({ where: { organizationId: ORG, userId: s.cook.id, status: "pending" } });
    check("в базе: запрос смены PIN ждёт одобрения", changed?.kind === "change" && changed.source === "equipment-fill", changed && { kind: changed.kind, source: changed.source });
    await page.getByRole("button", { name: "Вернуться к вводу PIN" }).click();
    await pinStep.waitFor({ timeout: 10_000 });
    await pinStep.locator(".qp-pin").fill("5937");
    await pinStep.getByRole("button", { name: "Продолжить" }).click();
    const fieldShown = await page.locator("#equipment-fill-temperature").waitFor({ timeout: 30_000 }).then(() => true).catch(() => false);
    check("до одобрения смены действует прежний (одобренный) PIN — поля открылись", fieldShown);
    await ctx.close();

    // ---- помещение: у Романа PIN нет
    const ctxRoom = await browser.newContext(mobile);
    await ctxRoom.addInitScript((id) => {
      try {
        localStorage.setItem("wesetup.qr-fill.employeeId", id);
      } catch {}
    }, s.resp.id);
    const roomPage = await ctxRoom.newPage();
    await openAs(roomPage, roomUrl);
    const roomNoAccess = roomPage.locator('[data-testid="qr-pin-no-access"]');
    await roomNoAccess.waitFor({ timeout: 60_000 }).catch(() => null);
    check("помещение: без PIN — «Запросить доступ», полей нет", (await roomNoAccess.isVisible()) && (await roomPage.locator("#room-fill-temperature, #room-fill-humidity").count()) === 0);
    await roomPage.getByRole("button", { name: "Запросить доступ" }).click();
    await roomPage.locator('[data-testid="qr-pin-request"] .qp-pin').nth(0).fill("7392");
    await roomPage.locator('[data-testid="qr-pin-request"] .qp-pin').nth(1).fill("7392");
    await roomPage.getByRole("button", { name: "Отправить запрос" }).click();
    await roomPage.locator('[data-testid="qr-pin-request-sent"]').waitFor({ timeout: 60_000 }).catch(() => null);
    await roomPage.waitForTimeout(1200);
    await roomPage.screenshot({ path: path.join(SHOTS, "20-room-request-sent.png"), fullPage: true });
    const roomReq = await db.qrPinRequest.findFirst({ where: { organizationId: ORG, userId: s.resp.id }, orderBy: { createdAt: "desc" } });
    check("помещение: запрос в базе — room-fill, журнал климата", roomReq?.source === "room-fill" && roomReq.journalCode === "climate_control" && roomReq.status === "pending", roomReq && { source: roomReq.source, journalCode: roomReq.journalCode });
    await ctxRoom.close();

    // ---- УФ-лампа: у Марины PIN нет
    const ctxLamp = await browser.newContext(mobile);
    await ctxLamp.addInitScript((id) => {
      try {
        localStorage.setItem("wesetup.qr-fill.employeeId", id);
      } catch {}
    }, s.manager.id);
    const lampPage = await ctxLamp.newPage();
    await openAs(lampPage, lampUrl);
    const lampNoAccess = lampPage.locator('[data-testid="qr-pin-no-access"]');
    await lampNoAccess.waitFor({ timeout: 60_000 }).catch(() => null);
    check("УФ-лампа: без PIN — «Запросить доступ», кнопки лампы нет", (await lampNoAccess.isVisible()) && (await lampPage.locator('[data-testid="uv-toggle"]').count()) === 0);
    await lampPage.screenshot({ path: path.join(SHOTS, "30-lamp-no-access.png"), fullPage: true });
    await lampPage.getByRole("button", { name: "Запросить доступ" }).click();
    await lampPage.locator('[data-testid="qr-pin-request"] .qp-pin').nth(0).fill("8461");
    await lampPage.locator('[data-testid="qr-pin-request"] .qp-pin').nth(1).fill("8461");
    await lampPage.getByRole("button", { name: "Отправить запрос" }).click();
    await lampPage.locator('[data-testid="qr-pin-request-sent"]').waitFor({ timeout: 60_000 }).catch(() => null);
    const lampReq = await db.qrPinRequest.findFirst({ where: { organizationId: ORG, userId: s.manager.id }, orderBy: { createdAt: "desc" } });
    check("УФ-лампа: запрос в базе — equipment-fill, журнал УФ-ламп", lampReq?.source === "equipment-fill" && lampReq.journalCode === "uv_lamp_runtime", lampReq && { source: lampReq.source, journalCode: lampReq.journalCode });
    await ctxLamp.close();

    // ---- публичный режим: без PIN — как раньше, сразу форма; с PIN — шаг PIN и «Запросить смену PIN»
    await db.organization.update({ where: { id: ORG }, data: { qrFillMode: "public" } });
    const ctxPublic = await browser.newContext(mobile);
    await ctxPublic.addInitScript((id) => {
      try {
        localStorage.setItem("wesetup.qr-fill.employeeId", id);
      } catch {}
    }, s.resp.id);
    const publicPage = await ctxPublic.newPage();
    await openAs(publicPage, fridgeUrl);
    const openField = await publicPage.locator("#equipment-fill-temperature").waitFor({ timeout: 60_000 }).then(() => true).catch(() => false);
    check("публичный режим, без PIN — поля сразу, «Запросить доступ» нет", openField && (await publicPage.locator('[data-testid="qr-pin-no-access"]').count()) === 0);
    await ctxPublic.close();
    const ctxVeteran = await browser.newContext(mobile);
    await ctxVeteran.addInitScript((id) => {
      try {
        localStorage.setItem("wesetup.qr-fill.employeeId", id);
      } catch {}
    }, s.veteran.id);
    const veteranPage = await ctxVeteran.newPage();
    await openAs(veteranPage, roomUrl);
    await veteranPage.locator('[data-testid="qr-pin-step"]').waitFor({ timeout: 60_000 }).catch(() => null);
    check("публичный режим, с PIN — шаг PIN и ссылка «Запросить смену PIN»", await veteranPage.locator('[data-testid="qr-pin-change"]').isVisible().catch(() => false));
    await veteranPage.screenshot({ path: path.join(SHOTS, "40-room-public-pin-step.png"), fullPage: true });
    await ctxVeteran.close();
  } finally {
    await browser.close();
    await db.organization.update({ where: { id: ORG }, data: { qrFillMode: "pin" } }).catch(() => null);
  }
  const passed = checks.filter((c) => c.ok).length;
  fs.writeFileSync(path.join(HERE, "smoke-object-pin-request.json"), JSON.stringify({ passed, total: checks.length, checks }, null, 2));
  console.log(`\n${passed}/${checks.length} PASS`);
  await db.$disconnect();
  process.exit(passed === checks.length ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect().catch(() => null);
  process.exit(1);
});
