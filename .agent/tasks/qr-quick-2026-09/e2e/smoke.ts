// Смоук G-quick: галка успеха, пропуск PIN на 30 минут в cookie организации, «Следующий QR».
// Запуск (dev на 3025 с wesetup_e2e): BASE=http://localhost:3025 npx tsx .agent/tasks/qr-quick-2026-09/e2e/smoke.ts
// Своя организация e2e-org-gq (+ e2e-org-gq2 для проверки «чужая организация»), e2e-org-a не трогаем.
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { chromium, type BrowserContext, type Page } from "playwright";

import { db } from "../../journal-responsibles-org-2026-09/e2e/db";

const BASE = process.env.BASE ?? "http://localhost:3025";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ROOT = path.resolve(HERE, "..", "..", "..", "..");
const SHOTS = path.join(HERE, "..", "shots");
for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^(EQUIPMENT_QR_TOKEN_SECRET|TELEGRAM_LINK_TOKEN_SECRET|NEXTAUTH_SECRET)=(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const ORG = "e2e-org-gq";
const ORG2 = "e2e-org-gq2";
const PASS_COOKIE = `wesetup.qr.pass.${ORG}`;
const PIN_A = "4821";
const PIN_B = "5937";
const IDS = {
  cookA: "e2e-gq-cook-a",
  cookB: "e2e-gq-cook-b",
  area: "e2e-gq-area",
  fridge: "e2e-gq-fridge",
  fridge2: "e2e-gq-fridge-2",
  lamp: "e2e-gq-uv",
  building: "e2e-gq-building",
  room: "e2e-gq-room",
  coldDoc: "e2e-gq-cold-doc",
  climateDoc: "e2e-gq-climate-doc",
  org2Cook: "e2e-gq2-cook",
  org2Area: "e2e-gq2-area",
  org2Fridge: "e2e-gq2-fridge",
  org2ColdDoc: "e2e-gq2-cold-doc",
};

const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail !== undefined ? ` :: ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
};

async function setup() {
  const [cold, climate] = await Promise.all([
    db.journalTemplate.findFirstOrThrow({ where: { code: "cold_equipment_control" }, select: { id: true } }),
    db.journalTemplate.findFirstOrThrow({ where: { code: "climate_control" }, select: { id: true } }),
  ]);
  const from = new Date("2026-09-01T00:00:00.000Z");
  const to = new Date("2026-09-30T00:00:00.000Z");
  const hashA = await bcrypt.hash(PIN_A, 10);
  const hashB = await bcrypt.hash(PIN_B, 10);
  for (const [id, name] of [
    [ORG, "Школа «Смоук G»"],
    [ORG2, "Соседняя организация G2"],
  ] as const) {
    await db.organization.upsert({
      where: { id },
      create: { id, name, type: "school", qrFillMode: "pin", timezone: "Europe/Moscow" },
      update: { name, qrFillMode: "pin", timezone: "Europe/Moscow" },
    });
  }
  const users = [
    { id: IDS.cookA, org: ORG, name: "Анна Смоукова", hash: hashA },
    { id: IDS.cookB, org: ORG, name: "Борис Смоуков", hash: hashB },
    { id: IDS.org2Cook, org: ORG2, name: "Вера Соседова", hash: hashA },
  ];
  for (const u of users) {
    const data = {
      name: u.name,
      organizationId: u.org,
      role: "cook",
      isActive: true,
      archivedAt: null,
      qrPinHash: u.hash,
      qrPinEncrypted: null,
      qrPinFailedCount: 0,
      qrPinLockedUntil: null,
    };
    await db.user.upsert({ where: { id: u.id }, create: { id: u.id, email: `${u.id}@e2e.local`, passwordHash: "x", ...data }, update: data });
  }
  await db.area.upsert({ where: { id: IDS.area }, create: { id: IDS.area, name: "Пищеблок", organizationId: ORG }, update: {} });
  await db.area.upsert({ where: { id: IDS.org2Area }, create: { id: IDS.org2Area, name: "Кухня G2", organizationId: ORG2 }, update: {} });
  for (const eq of [
    { id: IDS.fridge, name: "Холодильник №1", areaId: IDS.area, type: "refrigerator" },
    { id: IDS.fridge2, name: "Холодильник №2", areaId: IDS.area, type: "refrigerator" },
    { id: IDS.org2Fridge, name: "Холодильник G2", areaId: IDS.org2Area, type: "refrigerator" },
  ]) {
    await db.equipment.upsert({
      where: { id: eq.id },
      create: { ...eq, tempMin: 2, tempMax: 6, fillerUserIds: [] },
      update: { tempMin: 2, tempMax: 6, fillerUserIds: [] },
    });
  }
  await db.equipment.upsert({
    where: { id: IDS.lamp },
    create: { id: IDS.lamp, name: "УФ-облучатель", areaId: IDS.area, type: "uv_lamp", lampLifetimeHours: 8000, lampUsedHours: 10, fillerUserIds: [IDS.cookA, IDS.cookB] },
    update: { runningSince: null, fillerUserIds: [IDS.cookA, IDS.cookB] },
  });
  await db.equipmentRunSession.deleteMany({ where: { equipmentId: IDS.lamp } });
  await db.building.upsert({ where: { id: IDS.building }, create: { id: IDS.building, name: "Корпус 1", organizationId: ORG }, update: {} });
  await db.room.upsert({ where: { id: IDS.room }, create: { id: IDS.room, name: "Склад сухих продуктов", buildingId: IDS.building, fillerUserIds: [] }, update: { fillerUserIds: [] } });
  const coldItems = (ids: string[]) => ({
    equipment: ids.map((id, i) => ({ id: `cold-${id}`, name: `Холодильник ${i + 1}`, min: 2, max: 6, sourceEquipmentId: id })),
    skipWeekends: false,
  });
  for (const doc of [
    { id: IDS.coldDoc, org: ORG, templateId: cold.id, title: "Смоук G холодильники", config: coldItems([IDS.fridge, IDS.fridge2]), buildingId: null as string | null },
    { id: IDS.org2ColdDoc, org: ORG2, templateId: cold.id, title: "G2 холодильники", config: coldItems([IDS.org2Fridge]), buildingId: null },
    {
      id: IDS.climateDoc,
      org: ORG,
      templateId: climate.id,
      title: "Смоук G климат",
      buildingId: IDS.building,
      config: {
        rooms: [
          {
            id: `room-${IDS.room}`,
            name: "Склад сухих продуктов",
            roomId: IDS.room,
            temperature: { min: 15, max: 25, enabled: true },
            humidity: { min: 40, max: 70, enabled: true },
          },
        ],
        controlTimes: ["10:00", "17:00"],
        skipWeekends: false,
      },
    },
  ]) {
    await db.journalDocumentEntry.deleteMany({ where: { documentId: doc.id } });
    const data = { templateId: doc.templateId, organizationId: doc.org, title: doc.title, dateFrom: from, dateTo: to, status: "active", config: doc.config, buildingId: doc.buildingId };
    await db.journalDocument.upsert({ where: { id: doc.id }, create: { id: doc.id, ...data }, update: data });
  }
}

async function open(page: Page, url: string) {
  // Общий dev-сервер пересобирается от правок других исполнителей — навигацию иногда обрывает (ERR_ABORTED).
  for (let attempt = 0; ; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "load", timeout: 240_000 });
      break;
    } catch (err) {
      if (attempt >= 3 || !/ERR_ABORTED|interrupted/.test(String(err))) throw err;
      await page.waitForTimeout(1500);
    }
  }
  await page.waitForLoadState("networkidle").catch(() => null);
}

async function passCookie(ctx: BrowserContext) {
  return (await ctx.cookies()).find((c) => c.name === PASS_COOKIE) ?? null;
}

async function main() {
  const { mintQrFillToken } = await import("../../../../src/lib/qr-fill-token");
  await setup();
  const fridgeUrl = `${BASE}/equipment-fill/${IDS.fridge}?token=${encodeURIComponent(mintQrFillToken("equipment", IDS.fridge))}`;
  const fridge2Url = `${BASE}/equipment-fill/${IDS.fridge2}?token=${encodeURIComponent(mintQrFillToken("equipment", IDS.fridge2))}`;
  const lampUrl = `${BASE}/equipment-fill/${IDS.lamp}?token=${encodeURIComponent(mintQrFillToken("equipment", IDS.lamp))}`;
  const roomToken = mintQrFillToken("room", IDS.room);
  const roomUrl = `${BASE}/room-fill/${IDS.room}?token=${encodeURIComponent(roomToken)}`;
  const fridgeToken = mintQrFillToken("equipment", IDS.fridge);
  const org2Token = mintQrFillToken("equipment", IDS.org2Fridge);

  const browser = await chromium.launch({ channel: "chrome" });
  const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
  const withEmployee = async (id: string) => {
    const ctx = await browser.newContext(mobile);
    await ctx.addInitScript((employeeId) => {
      try {
        if (!sessionStorage.getItem("e2e-init")) {
          localStorage.setItem("wesetup.qr-fill.employeeId", employeeId);
          sessionStorage.setItem("e2e-init", "1");
        }
      } catch {}
    }, id);
    return ctx;
  };
  try {
    // ---- 1. PIN на наклейке холодильника → галка → cookie на 30 минут
    const ctx = await withEmployee(IDS.cookA);
    const page = await ctx.newPage();
    await open(page, fridgeUrl);
    check("холодильник: шаг PIN до формы", await page.getByTestId("qr-pin-step").isVisible().catch(() => false));
    await page.fill(".qp-pin", PIN_A);
    await page.click('[data-testid="qr-pin-step"] button[type="submit"]');
    await page.locator(".qp-ok .qc").waitFor({ timeout: 30_000 }).catch(() => null);
    // Галка сама схлопывается через ~0,9 с — для замера и снимка останавливаем анимации в конечном кадре появления.
    await page.addStyleTag({ content: ".qp-ok,.qc,.qc-m,.qp-rise{animation:none!important;stroke-dashoffset:0!important}" });
    await page.locator(".qp-ok").scrollIntoViewIfNeeded().catch(() => null);
    await page.screenshot({ path: path.join(SHOTS, "after-pin-ok-390.png") });
    const okBox = await page.locator(".qp-ok .qc").boundingBox().catch(() => null);
    const okStyle = await page
      .locator(".qp-ok .qc")
      .evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, border: getComputedStyle(el).borderTopWidth, shadow: getComputedStyle(el).boxShadow }))
      .catch(() => null);
    const okClip = await page
      .locator(".qp-ok")
      .evaluate((el) => {
        const box = el.getBoundingClientRect();
        const qc = el.querySelector(".qc")!.getBoundingClientRect();
        // ореол 10px должен помещаться в .qp-ok (overflow:hidden)
        return { top: qc.top - 10 - box.top, bottom: box.bottom - (qc.bottom + 10) };
      })
      .catch(() => null);
    check(
      "«PIN верный»: залитый круг #059669 ~120px без контура, ореол не режется",
      Boolean(okBox && okBox.width >= 110 && okStyle?.bg === "rgb(5, 150, 105)" && okStyle.border === "0px" && /rgba\(5, 150, 105, 0\.14\)/.test(okStyle.shadow) && okClip && okClip.top >= 0 && okClip.bottom >= 0),
      { okBox, okStyle, okClip }
    );
    const c1 = await passCookie(ctx);
    const ttl = c1 ? c1.expires - Date.now() / 1000 : 0;
    check("cookie пропуска организации: HttpOnly, Lax, путь /, ~30 минут", Boolean(c1 && c1.httpOnly && c1.sameSite === "Lax" && c1.path === "/" && ttl > 1700 && ttl <= 1810), { c1, ttl });

    await page.locator("#equipment-fill-temperature").waitFor({ timeout: 30_000 });
    await page.fill("#equipment-fill-temperature", "4");
    await page.getByRole("button", { name: /Сохранить/ }).click();
    const recorded = await page.getByText("Записано").first().waitFor({ timeout: 60_000 }).then(() => true).catch(() => false);
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(SHOTS, "after-fridge-saved-390.png"), fullPage: true });
    check("холодильник: записано по пропуску", recorded);
    const doneBox = await page.locator('[role="status"].qc').first().boundingBox().catch(() => null);
    check("«Записано»: новая галка ~112px", Boolean(doneBox && doneBox.width >= 105 && doneBox.width <= 120), doneBox);
    const nextBtn = page.getByTestId("next-qr");
    check("«Записано»: главная кнопка «Следующий QR» и второстепенная «Записать ещё замер»", (await nextBtn.isVisible()) && (await page.getByRole("button", { name: "Записать ещё замер" }).isVisible()));
    const doneHtml = await page.content();
    check("на экране «Записано» нет ссылок/токенов других объектов", !doneHtml.includes(IDS.fridge2) && !doneHtml.includes(IDS.room) && !doneHtml.includes(IDS.lamp));
    await nextBtn.click();
    const sheet = page.getByRole("dialog", { name: "Сканирование QR-кода" });
    const sheetOpen = await sheet.waitFor({ timeout: 15_000 }).then(() => true).catch(() => false);
    await page.waitForTimeout(2500);
    const sheetText = sheetOpen ? await sheet.innerText() : "";
    await page.screenshot({ path: path.join(SHOTS, "after-next-qr-camera-390.png") });
    check("«Следующий QR» открывает сканер (в dev без камеры — понятная ошибка)", sheetOpen && /Наведите на QR-код/.test(sheetText), sheetText);
    await page.getByRole("button", { name: "Закрыть сканер" }).click().catch(() => null);

    // ---- 2. F5 и соседние наклейки — без PIN
    await open(page, fridgeUrl);
    const f5 = (await page.getByTestId("qr-pin-step").count()) === 0 && (await page.locator("#equipment-fill-temperature").isVisible().catch(() => false));
    await page.screenshot({ path: path.join(SHOTS, "after-f5-no-pin-390.png"), fullPage: true });
    check("F5 на холодильнике — без PIN, поля сразу", f5);
    check("под «Кто снимает» — «PIN подтверждён» и «Не вы? Сменить»", await page.getByTestId("qr-pass-logout").isVisible().catch(() => false));

    await open(page, fridge2Url);
    check("другой холодильник той же организации — без PIN", (await page.getByTestId("qr-pin-step").count()) === 0 && (await page.locator("#equipment-fill-temperature").isVisible().catch(() => false)));

    await open(page, roomUrl);
    const roomNoPin = (await page.getByTestId("qr-pin-step").count()) === 0 && (await page.locator("#room-fill-temperature").isVisible().catch(() => false));
    check("склад той же организации — без PIN", roomNoPin);
    if (roomNoPin) {
      await page.fill("#room-fill-temperature", "20");
      await page.fill("#room-fill-humidity", "50");
      await page.getByRole("button", { name: /^Сохранить$/ }).click();
      const roomSaved = await page.getByText("Записано").first().waitFor({ timeout: 60_000 }).then(() => true).catch(() => false);
      await page.waitForTimeout(700);
      await page.screenshot({ path: path.join(SHOTS, "after-room-saved-390.png"), fullPage: true });
      check("склад: записано по cookie-пропуску, есть «Следующий QR»", roomSaved && (await page.getByTestId("next-qr").isVisible()));
    }

    await open(page, lampUrl);
    check(
      "УФ-лампа той же организации — без PIN, кнопка активна",
      (await page.getByTestId("qr-pin-step").count()) === 0 && (await page.getByTestId("uv-toggle").isEnabled().catch(() => false))
    );

    // ---- 3. Другой сотрудник — PIN
    await open(page, fridgeUrl);
    await page.getByRole("button", { name: /Кто снимает показания/ }).click();
    await page.getByRole("dialog").getByText("Борис Смоуков").click();
    check("другой сотрудник на том же телефоне — PIN снова", await page.getByTestId("qr-pin-step").isVisible().catch(() => false));
    const otherApi = await ctx.request.post(`${BASE}/api/equipment-fill/${IDS.fridge}`, { data: { token: fridgeToken, employeeId: IDS.cookB, temperature: 4 } });
    check("API: cookie Анны не пишет за Бориса", otherApi.status() >= 400 && otherApi.status() < 500, { status: otherApi.status() });

    // ---- 4. Чужая организация
    const cookie = await passCookie(ctx);
    const cross = await browser.newContext();
    if (cookie) await cross.addCookies([{ ...cookie, name: `wesetup.qr.pass.${ORG2}` }]);
    const crossRes = await cross.request.post(`${BASE}/api/equipment-fill/${IDS.org2Fridge}`, { data: { token: org2Token, employeeId: IDS.org2Cook, temperature: 4 } });
    check("пропуск одной организации не открывает другую", crossRes.status() >= 400 && crossRes.status() < 500, { status: crossRes.status() });
    await cross.close();

    // ---- 5. «Не вы? Сменить» гасит пропуск
    await open(page, fridgeUrl);
    await page.getByTestId("qr-pass-logout").click();
    await page.waitForTimeout(1500);
    check("«Не вы? Сменить» снимает cookie пропуска", (await passCookie(ctx)) === null);
    await open(page, fridgeUrl);
    await page.screenshot({ path: path.join(SHOTS, "after-logout-390.png"), fullPage: true });
    // Как и раньше до выбора имени: «Выберите своё имя», сохранить нельзя; пропуска нет.
    check(
      "после «Не вы?» — имя не выбрано, пропуска нет, сохранить нельзя",
      (await page.getByText("Выберите своё имя").isVisible().catch(() => false)) &&
        (await page.getByTestId("qr-pass-note").count()) === 0 &&
        (await page.getByRole("button", { name: /Сохранить/ }).isDisabled().catch(() => false))
    );
    await ctx.close();

    // ---- 6. «Запомнить» выключено — пропуск не сохраняется
    const ctxNo = await withEmployee(IDS.cookA);
    const pageNo = await ctxNo.newPage();
    await open(pageNo, fridgeUrl);
    await pageNo.getByTestId("qr-remember").uncheck();
    await pageNo.fill(".qp-pin", PIN_A);
    await pageNo.click('[data-testid="qr-pin-step"] button[type="submit"]');
    await pageNo.locator("#equipment-fill-temperature").waitFor({ timeout: 30_000 }).catch(() => null);
    check("«Запомнить» выключено — cookie пропуска нет", (await passCookie(ctxNo)) === null);
    await open(pageNo, fridgeUrl);
    check("«Запомнить» выключено — после F5 снова PIN", await pageNo.getByTestId("qr-pin-step").isVisible().catch(() => false));
    // JSON-пропуск (память вкладки) по-прежнему работает
    const jsonPass = await ctxNo.request.post(`${BASE}/api/qr-fill/pass`, { data: { kind: "equipment", objectId: IDS.fridge, token: fridgeToken, employeeId: IDS.cookA, pin: PIN_A, remember: false } });
    const jsonBody = (await jsonPass.json()) as { pass?: string };
    const bare = await browser.newContext();
    const withJson = await bare.request.post(`${BASE}/api/equipment-fill/${IDS.fridge}`, { data: { token: fridgeToken, employeeId: IDS.cookA, temperature: 5, pass: jsonBody.pass } });
    check("JSON-пропуск без cookie (совместимость) — сохраняет", withJson.status() === 200, { status: withJson.status(), body: await withJson.text() });
    await bare.close();
    await ctxNo.close();

    // ---- 7. Сброс PIN руководителем гасит пропуск
    const ctxR = await browser.newContext(mobile);
    const got = await ctxR.request.post(`${BASE}/api/qr-fill/pass`, { data: { kind: "equipment", objectId: IDS.fridge, token: fridgeToken, employeeId: IDS.cookA, pin: PIN_A, remember: true } });
    check("API /pass с remember=true ставит cookie", got.status() === 200 && (await passCookie(ctxR)) !== null);
    const okBefore = await ctxR.request.post(`${BASE}/api/equipment-fill/${IDS.fridge}`, { data: { token: fridgeToken, employeeId: IDS.cookA, temperature: 4 } });
    check("сохранение только по cookie — 200", okBefore.status() === 200, await okBefore.text());
    await db.user.update({ where: { id: IDS.cookA }, data: { qrPinHash: await bcrypt.hash("7315", 10) } });
    const afterReset = await ctxR.request.post(`${BASE}/api/equipment-fill/${IDS.fridge}`, { data: { token: fridgeToken, employeeId: IDS.cookA, temperature: 4 } });
    check("сброс PIN руководителем — cookie-пропуск больше не действует", afterReset.status() >= 400 && afterReset.status() < 500, { status: afterReset.status() });
    const pageR = await ctxR.newPage();
    await ctxR.addInitScript((id) => localStorage.setItem("wesetup.qr-fill.employeeId", id), IDS.cookA);
    await open(pageR, fridgeUrl);
    check("сброс PIN — страница снова спрашивает PIN", await pageR.getByTestId("qr-pin-step").isVisible().catch(() => false));
    await db.user.update({ where: { id: IDS.cookA }, data: { qrPinHash: await bcrypt.hash(PIN_A, 10) } });
    await ctxR.close();

    // ---- 8. Блокировка не обходится
    const ctxL = await browser.newContext();
    await ctxL.request.post(`${BASE}/api/qr-fill/pass`, { data: { kind: "equipment", objectId: IDS.fridge, token: fridgeToken, employeeId: IDS.cookA, pin: PIN_A, remember: true } });
    await db.user.update({ where: { id: IDS.cookA }, data: { qrPinLockedUntil: new Date(Date.now() + 10 * 60_000) } });
    const locked = await ctxL.request.post(`${BASE}/api/equipment-fill/${IDS.fridge}`, { data: { token: fridgeToken, employeeId: IDS.cookA, temperature: 4 } });
    check("сотрудник заблокирован — пропуск не принимается (423)", locked.status() === 423, { status: locked.status(), body: await locked.text() });
    await db.user.update({ where: { id: IDS.cookA }, data: { qrPinLockedUntil: null, qrPinFailedCount: 0 } });
    await ctxL.close();

    // ---- 9. reduced-motion: галка без анимации
    const ctxM = await browser.newContext({ ...mobile, reducedMotion: "reduce" });
    await ctxM.addInitScript((id) => localStorage.setItem("wesetup.qr-fill.employeeId", id), IDS.cookA);
    const pageM = await ctxM.newPage();
    await open(pageM, fridgeUrl);
    await pageM.fill(".qp-pin", PIN_A);
    await pageM.click('[data-testid="qr-pin-step"] button[type="submit"]');
    await pageM.locator(".qp-ok .qc").waitFor({ timeout: 30_000 }).catch(() => null);
    const anim = await pageM.locator(".qp-ok .qc").evaluate((el) => getComputedStyle(el).animationName).catch(() => "missing");
    check("prefers-reduced-motion — галка без анимации", anim === "none", anim);
    await ctxM.close();
  } finally {
    await browser.close();
    await db.user.updateMany({ where: { id: { in: [IDS.cookA, IDS.cookB] } }, data: { qrPinLockedUntil: null, qrPinFailedCount: 0 } });
    await db.$disconnect();
  }
  const passed = checks.filter((c) => c.ok).length;
  fs.writeFileSync(path.join(HERE, "smoke.json"), JSON.stringify({ passed, total: checks.length, checks }, null, 2));
  console.log(`\n${passed}/${checks.length} PASS`);
  process.exit(passed === checks.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
