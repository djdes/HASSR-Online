// e2e Задачи 3: A4-плакаты → «сканирование» ссылки без входа → записи в журнале,
// аудит, инцидент отклонения; отказы 401/409/429; влажность с QR холодильника.
// Нужен стенд Задачи 1 (state.json) и dev на 3020 с wesetup_e2e.
// Запуск: npx tsx .agent/tasks/qr-a4-temperature-2026-09/e2e/poster-scan.ts
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { chromium, type Browser, type BrowserContext } from "playwright";

import { db } from "../../journal-responsibles-org-2026-09/e2e/db";

const BASE = process.env.BASE ?? "http://localhost:3020";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SHOTS = path.join(HERE, "..", "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const state = JSON.parse(
  fs.readFileSync(path.join(HERE, "..", "..", "journal-responsibles-org-2026-09", "e2e", "state.json"), "utf8")
);
const U = state.users as Record<string, { id: string; email: string; name: string }>;

type Check = { name: string; ok: boolean; detail?: unknown };
const checks: Check[] = [];
function check(name: string, ok: boolean, detail?: unknown) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail !== undefined ? ` :: ${JSON.stringify(detail).slice(0, 500)}` : ""}`);
}

/** Секрет подписи — тот же, что у dev-сервера (порядок как в getSecret()). Не печатается. */
function signingSecret(): string {
  const read = (file: string) => {
    try {
      return fs.readFileSync(path.join(process.cwd(), file), "utf8");
    } catch {
      return "";
    }
  };
  const files = [read(".env.local"), read(".env")];
  for (const key of ["EQUIPMENT_QR_TOKEN_SECRET", "TELEGRAM_LINK_TOKEN_SECRET", "NEXTAUTH_SECRET"]) {
    for (const content of files) {
      const match = content.match(new RegExp(`^${key}="?([^"\\r\\n]+)"?`, "m"));
      if (match?.[1] && match[1].length >= 16) return match[1];
    }
  }
  throw new Error("Секрет подписи QR не найден");
}

function mintToken(subject: string, issued: number): string {
  const payload = `${subject}.${issued}`;
  return `${payload}.${crypto.createHmac("sha256", signingSecret()).update(payload).digest("base64url")}`;
}

function todayKey(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function login(browser: Browser, email: string): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 120_000 });
  for (let i = 0; i < 30; i += 1) {
    await page.fill("#email", email);
    await page.fill("#password", state.password);
    if ((await page.inputValue("#email")) === email) break;
    await page.waitForTimeout(300);
  }
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 120_000 });
  await page.close();
  return context;
}

async function setup() {
  const orgA = state.orgA as string;
  await db.organization.update({ where: { id: orgA }, data: { timezone: "Europe/Moscow" } });
  const building = await db.building.findFirstOrThrow({ where: { organizationId: orgA } });
  const room =
    (await db.room.findFirst({ where: { buildingId: building.id, name: "Склад сухих продуктов" } })) ??
    (await db.room.create({ data: { buildingId: building.id, name: "Склад сухих продуктов", kind: "storage" } }));
  await db.room.update({
    where: { id: room.id },
    data: {
      climateNorms: {
        temperature: { enabled: true, min: 15, max: 25 },
        humidity: { enabled: true, min: 40, max: 70 },
      },
    },
  });
  const area = await db.area.findFirstOrThrow({ where: { organizationId: orgA, name: "Горячий цех" } });
  const fridge =
    (await db.equipment.findFirst({ where: { areaId: area.id, name: "Холодильник QR E2E" } })) ??
    (await db.equipment.create({ data: { areaId: area.id, name: "Холодильник QR E2E", type: "refrigerator", tempMin: 2, tempMax: 6 } }));
  const orphanFridge =
    (await db.equipment.findFirst({ where: { areaId: area.id, name: "Холодильник без журнала" } })) ??
    (await db.equipment.create({ data: { areaId: area.id, name: "Холодильник без журнала", type: "refrigerator", tempMin: 2, tempMax: 6 } }));

  const climateTemplate = await db.journalTemplate.findUniqueOrThrow({ where: { code: "climate_control" } });
  const coldTemplate = await db.journalTemplate.findUniqueOrThrow({ where: { code: "cold_equipment_control" } });
  // Чистые документы на сегодня: климат с помещением и цехом, холодильники с одним холодильником.
  await db.journalDocument.deleteMany({
    where: { organizationId: orgA, templateId: { in: [climateTemplate.id, coldTemplate.id] }, title: { startsWith: "QR E2E" } },
  });
  await db.journalDocument.updateMany({
    where: { organizationId: orgA, templateId: { in: [climateTemplate.id, coldTemplate.id] }, status: "active" },
    data: { status: "closed" },
  });
  const day = new Date(`${todayKey()}T00:00:00.000Z`);
  const climateDoc = await db.journalDocument.create({
    data: {
      organizationId: orgA,
      templateId: climateTemplate.id,
      title: "QR E2E климат",
      dateFrom: day,
      dateTo: day,
      responsibleUserId: U.cookA.id,
      config: {
        rooms: [
          { id: `room-${room.id}`, roomId: room.id, name: room.name, temperature: { enabled: true, min: 15, max: 25 }, humidity: { enabled: true, min: 40, max: 70 } },
          { id: `room-area-${area.id}`, name: "Горячий цех", temperature: { enabled: true, min: 18, max: 30 }, humidity: { enabled: true, min: 20, max: 80 } },
        ],
        controlTimes: ["10:00", "17:00"],
        skipWeekends: false,
      },
    },
  });
  const coldDoc = await db.journalDocument.create({
    data: {
      organizationId: orgA,
      templateId: coldTemplate.id,
      title: "QR E2E холодильники",
      dateFrom: day,
      dateTo: day,
      responsibleUserId: U.cookA.id,
      config: {
        equipment: [{ id: "cold-item-qr", sourceEquipmentId: fridge.id, name: fridge.name, min: 2, max: 6 }],
        skipWeekends: false,
      },
    },
  });
  await db.equipmentSensorMapping.upsert({
    where: { equipmentId_templateId_fieldKey: { equipmentId: fridge.id, templateId: climateTemplate.id, fieldKey: "humidity" } },
    update: { readingType: "humidity" },
    create: { equipmentId: fridge.id, templateId: climateTemplate.id, fieldKey: "humidity", readingType: "humidity" },
  });
  await db.auditLog.deleteMany({ where: { organizationId: orgA, action: "journal.qr_fill" } });
  await db.temperatureDeviationIncident.deleteMany({ where: { organizationId: orgA } });
  return { orgA, room, area, fridge, orphanFridge, climateDoc, coldDoc, day };
}

async function main() {
  const env = await setup();
  // Сканирование без входа проверяется в режиме «public». Стенд e2e-org-a могут
  // оставить в «auth» другие смоуки — выставляем public и возвращаем в finally.
  const orgMode = await db.organization.findUniqueOrThrow({ where: { id: env.orgA }, select: { qrFillMode: true } });
  await db.organization.update({ where: { id: env.orgA }, data: { qrFillMode: "public" } });
  // PIN повара (его ставят смоуки PIN) здесь не проверяем — снимаем и возвращаем.
  const cookPin = await db.user.findUniqueOrThrow({
    where: { id: U.cookA.id },
    select: { qrPinHash: true, qrPinEncrypted: true, qrPinFailedCount: true, qrPinLockedUntil: true },
  });
  await db.user.update({ where: { id: U.cookA.id }, data: { qrPinHash: null, qrPinEncrypted: null, qrPinFailedCount: 0, qrPinLockedUntil: null } });
  const roomFillers = await db.room.findUniqueOrThrow({ where: { id: env.room.id }, select: { fillerUserIds: true } });
  await db.room.update({ where: { id: env.room.id }, data: { fillerUserIds: [] } });
  const browser = await chromium.launch({ headless: true });
  try {
    // ── Плакаты помещений ─────────────────────────────────────────────
    const manager = await login(browser, U.managerA.email);
    const page = await manager.newPage();
    await page.goto(`${BASE}/settings/qr-posters?kind=rooms&origin=${encodeURIComponent(BASE)}`, { waitUntil: "load", timeout: 300_000 });
    const posters = page.locator("[data-qr-poster]");
    const posterCount = await posters.count();
    check("плакаты помещений: есть хотя бы один", posterCount >= 1, posterCount);
    const roomPoster = page.locator(`[data-qr-poster][data-qr-id="${env.room.id}"]`);
    const roomUrl = await roomPoster.getAttribute("data-qr-url");
    check("у плаката склада есть data-qr-url/kind", Boolean(roomUrl) && (await roomPoster.getAttribute("data-qr-kind")) === "room", roomUrl);
    // С 733d5137 экранная карточка — название, превью и «Проверить ссылку»;
    // шаги сканирования живут только в печатном дереве выбранных карточек.
    const posterText = await roomPoster.innerText();
    const checkHref = await roomPoster.locator("[data-qr-check]").getAttribute("href").catch(() => null);
    check(
      "карточка: название и «Проверить ссылку» на тот же URL, без шагов на экране",
      posterText.includes("Склад сухих продуктов") && checkHref === roomUrl && !posterText.includes("Наведите камеру телефона на код"),
      { posterText, checkHref }
    );
    // Печать A4: отмечаем карточку и выбираем формат A4.
    if ((await roomPoster.getAttribute("data-qr-selected")) !== "true") await roomPoster.locator("input[type=checkbox]").first().check();
    await roomPoster.locator('[data-qr-format-option="a4"]').first().click();
    await page.waitForFunction(
      (url) => Array.from(document.querySelectorAll("[data-qr-print-url]")).some((node) => node.getAttribute("data-qr-print-url") === url && node.getAttribute("data-qr-print-mm") === "105"),
      roomUrl,
      { timeout: 30_000 }
    ).catch(() => null);
    const printCode = page.locator(`[data-qr-print-root] [data-qr-print-url="${roomUrl}"]`).first();
    const printPoster = printCode.locator("xpath=..");
    const printText = ((await printPoster.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ");
    check(
      "печать A4: название и три шага сканирования",
      printText.includes("Склад сухих продуктов") &&
        printText.includes("Наведите камеру телефона на код") &&
        printText.includes("Выберите своё имя и введите показание") &&
        printText.includes("запись попадёт в журнал за сегодня"),
      printText
    );
    const screenPrintVisible = await printCode.isVisible().catch(() => false);
    await page.screenshot({ path: path.join(SHOTS, "posters-rooms-screen.png"), fullPage: false });
    await page.emulateMedia({ media: "print" });
    const printVisible = await printCode.isVisible().catch(() => false);
    const qrWidthPx = await printCode.locator("svg").first().evaluate((node) => node.getBoundingClientRect().width).catch(() => 0);
    const mm = qrWidthPx / (96 / 25.4);
    // A4: QR ≈ 100 мм (105 мм по разметке печати).
    check("печать: QR около 100 мм, видно только в print-медиа", !screenPrintVisible && printVisible && mm >= 95 && mm <= 110, { qrWidthPx, mm: Number(mm.toFixed(1)), screenPrintVisible, printVisible });
    await page.pdf({ path: path.join(SHOTS, "posters-rooms-a4.pdf"), format: "A4", printBackground: true, preferCSSPageSize: true });
    await page.emulateMedia({ media: "screen" });

    // Ограничение документом и вкладка оборудования.
    await page.goto(`${BASE}/settings/qr-posters?kind=equipment&doc=${env.coldDoc.id}&origin=${encodeURIComponent(BASE)}`, { waitUntil: "load", timeout: 300_000 });
    const docIds = await page
      .locator('[data-qr-poster]:not([data-qr-kind="journal"])')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-qr-id")));
    check("?doc= ограничивает список строками документа", docIds.length === 1 && docIds[0] === env.fridge.id, docIds);
    const fridgeUrl = await page.locator('[data-qr-poster]:not([data-qr-kind="journal"])').first().getAttribute("data-qr-url");

    // Входы в плакаты.
    await page.goto(`${BASE}/settings/equipment`, { waitUntil: "load", timeout: 300_000 });
    check("/settings/equipment: кнопка «Плакаты A4»", (await page.locator('a[href="/settings/qr-posters?kind=equipment"]').count()) === 1, null);
    await page.goto(`${BASE}/settings/buildings`, { waitUntil: "load", timeout: 300_000 });
    check("/settings/buildings: кнопка «QR-плакаты помещений»", (await page.locator('a[href="/settings/qr-posters?kind=rooms"]').count()) === 1, null);

    // Пункт «QR-плакаты» в меню «⋯» документов климата и холодильников.
    for (const [code, docId, kind] of [
      ["climate_control", env.climateDoc.id, "rooms"],
      ["cold_equipment_control", env.coldDoc.id, "equipment"],
    ] as const) {
      await page.goto(`${BASE}/journals/${code}/documents/${docId}`, { waitUntil: "load", timeout: 300_000 });
      await page.waitForTimeout(2500);
      const guide = page.locator('[role="dialog"][aria-labelledby="fill-guide-title"]');
      if (await guide.isVisible().catch(() => false)) {
        await guide.getByRole("button", { name: "Понятно" }).first().click().catch(() => page.keyboard.press("Escape"));
        await guide.waitFor({ state: "hidden", timeout: 15_000 }).catch(() => null);
      }
      await page.getByRole("button", { name: "Ещё действия" }).first().click();
      await page.getByRole("menuitem", { name: "QR-плакаты" }).first().click();
      await page.waitForURL(/\/settings\/qr-posters/, { timeout: 120_000 }).catch(() => null);
      const target = new URL(page.url());
      check(
        `${code}: пункт меню «QR-плакаты» ведёт на плакаты этого документа`,
        target.pathname === "/settings/qr-posters" &&
          target.searchParams.get("kind") === kind &&
          target.searchParams.get("doc") === docId,
        page.url()
      );
    }
    await manager.close();

    // ── «Сканирование»: новый контекст без cookies ───────────────────
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const scan = await phone.newPage();
    await scan.goto(roomUrl!, { waitUntil: "load", timeout: 300_000 });
    check("ссылка плаката открывает форму без входа", !new URL(scan.url()).pathname.startsWith("/login") && (await scan.locator("text=Кто снимает показания").count()) === 1, scan.url());
    await scan.screenshot({ path: path.join(SHOTS, "room-fill-form.png"), fullPage: true });

    const submit = async (temperature: string, humidity: string) => {
      // Выбор сотрудника — строка «Кто снимает показания» → лист со списком.
      const who = scan.locator('button:has-text("Выберите своё имя")');
      if (await who.isVisible().catch(() => false)) {
        await who.click();
        await scan.locator(`[role="dialog"] button:has-text("${U.cookA.name}")`).first().click();
      }
      await scan.fill("#room-fill-temperature", temperature);
      await scan.fill("#room-fill-humidity", humidity);
      // Вне нормы форма просит написать, что сделали.
      const correction = scan.locator("textarea").first();
      if (await correction.isVisible().catch(() => false)) await correction.fill("Проветрили склад, сообщили руководителю");
      const [response] = await Promise.all([
        scan.waitForResponse((res) => res.url().includes(`/api/room-fill/${env.room.id}`) && res.request().method() === "POST", { timeout: 120_000 }),
        scan.getByRole("button", { name: "Сохранить", exact: true }).click(),
      ]);
      await scan.locator("text=Записано").first().waitFor({ timeout: 60_000 });
      return { status: response.status(), json: await response.json() };
    };

    const normal = await submit("20", "55");
    check("замер в норме → 200, слот в ответе", normal.status === 200 && typeof normal.json.slot === "string" && !normal.json.temperatureOutOfRange, normal);
    const successText = await scan.locator("main").innerText();
    check("экран успеха: «Записано в бланк за сегодня, <срок>»", successText.includes(`Записано в бланк за сегодня, ${normal.json.slot}`), successText.slice(0, 300));
    await scan.screenshot({ path: path.join(SHOTS, "room-fill-saved.png"), fullPage: true });
    const remembered = await scan.evaluate(() => localStorage.getItem("wesetup.room-fill.employeeId"));
    check("имя запомнено на телефоне", remembered === U.cookA.id, remembered);

    const entry = await db.journalDocumentEntry.findUnique({
      where: { documentId_employeeId_date: { documentId: env.climateDoc.id, employeeId: U.cookA.id, date: env.day } },
    });
    const measurements = (entry?.data as { measurements?: Record<string, Record<string, { temperature: number; humidity: number }>> })?.measurements ?? {};
    check("запись легла в строку склада и срок контроля", measurements[`room-${env.room.id}`]?.[normal.json.slot]?.temperature === 20 && measurements[`room-${env.room.id}`]?.[normal.json.slot]?.humidity === 55, measurements);

    await scan.click('button:has-text("Записать ещё замер")');
    const deviation = await submit("31", "90");
    check("отклонение → флаги вне нормы", deviation.json.temperatureOutOfRange === true && deviation.json.humidityOutOfRange === true, deviation);
    await scan.screenshot({ path: path.join(SHOTS, "room-fill-deviation.png"), fullPage: true });
    const incident = await db.temperatureDeviationIncident.findFirst({ where: { organizationId: env.orgA, documentId: env.climateDoc.id } });
    check("инцидент отклонения открыт", Boolean(incident) && incident?.lastValue === 31, incident);
    const audits = await db.auditLog.count({ where: { organizationId: env.orgA, action: "journal.qr_fill", entity: "Room" } });
    check("журнал действий: 2 записи journal.qr_fill", audits === 2, audits);
    await phone.close();

    // ── Отказы API ────────────────────────────────────────────────────
    const anon = await browser.newContext();
    const api = anon.request;
    const roomToken = new URL(roomUrl!).searchParams.get("token")!;
    const fridgeToken = new URL(fridgeUrl!).searchParams.get("token")!;
    const post = (url: string, data: unknown) => api.post(`${BASE}${url}`, { data, timeout: 120_000 });

    const broken = await post(`/api/room-fill/${env.room.id}`, { token: `${roomToken.slice(0, -3)}abc`, employeeId: U.cookA.id, temperature: 20 });
    check("испорченный токен → 401", broken.status() === 401, await broken.json());
    const expired = await post(`/api/room-fill/${env.room.id}`, { token: mintToken(`room:${env.room.id}`, Date.now() - 400 * 86400_000), employeeId: U.cookA.id, temperature: 20 });
    // С b2f40be2 (решение владельца, 2026-09-19) QR-коды бессрочные: код 400-дневной давности работает.
    check("код 400-дневной давности по-прежнему принимается (коды бессрочные) → 200", expired.status() === 200, { status: expired.status(), body: await expired.text() });
    const foreignRoomToken = mintToken("room:some-other-room", Date.now());
    const foreign = await post(`/api/room-fill/${env.room.id}`, { token: foreignRoomToken, employeeId: U.cookA.id, temperature: 20 });
    check("токен другого помещения → 401", foreign.status() === 401, foreign.status());
    const roomOnEquipment = await post(`/api/equipment-fill/${env.room.id}`, { token: roomToken, employeeId: U.cookA.id, temperature: 4 });
    check("токен помещения на маршруте оборудования → 401", roomOnEquipment.status() === 401, roomOnEquipment.status());
    const foreignEmployee = await post(`/api/room-fill/${env.room.id}`, { token: roomToken, employeeId: U.cookB.id, temperature: 20 });
    check("сотрудник другой организации → 404", foreignEmployee.status() === 404, foreignEmployee.status());

    await db.journalDocument.update({ where: { id: env.climateDoc.id }, data: { status: "closed" } });
    const noDoc = await post(`/api/room-fill/${env.room.id}`, { token: roomToken, employeeId: U.cookA.id, temperature: 20 });
    const noDocJson = await noDoc.json();
    check("нет активного журнала → 409 no-active-document", noDoc.status() === 409 && noDocJson.code === "no-active-document", noDocJson);
    await db.journalDocument.update({ where: { id: env.climateDoc.id }, data: { status: "active" } });

    // ── QR холодильника: влажность в строку цеха, 409, аудит ─────────
    const fridgeResponse = await post(`/api/equipment-fill/${env.fridge.id}`, { token: fridgeToken, employeeId: U.cookA.id, temperature: 4, humidity: 50 });
    const fridgeJson = await fridgeResponse.json();
    check("QR холодильника → 200", fridgeResponse.status() === 200 && fridgeJson.touched === 1 && fridgeJson.humidityTouched === 1, fridgeJson);
    const coldEntry = await db.journalDocumentEntry.findUnique({
      where: { documentId_employeeId_date: { documentId: env.coldDoc.id, employeeId: U.cookA.id, date: env.day } },
    });
    check("температура холодильника в журнале", (coldEntry?.data as { temperatures?: Record<string, number> })?.temperatures?.["cold-item-qr"] === 4, coldEntry?.data);
    const climateEntry = await db.journalDocumentEntry.findUnique({
      where: { documentId_employeeId_date: { documentId: env.climateDoc.id, employeeId: U.cookA.id, date: env.day } },
    });
    const climateMeasurements = (climateEntry?.data as { measurements?: Record<string, Record<string, { humidity: number | null }>> })?.measurements ?? {};
    const areaRow = climateMeasurements[`room-area-${env.area.id}`] ?? {};
    check(
      "влажность с QR холодильника — в строке цеха, не под id оборудования",
      Object.values(areaRow).some((slot) => slot.humidity === 50) && !(env.fridge.id in climateMeasurements),
      climateMeasurements
    );
    const orphanToken = mintToken(env.orphanFridge.id, Date.now());
    const orphan = await post(`/api/equipment-fill/${env.orphanFridge.id}`, { token: orphanToken, employeeId: U.cookA.id, temperature: 4 });
    check("холодильник вне журналов → 409", orphan.status() === 409 && (await orphan.json()).code === "no-active-document", orphan.status());
    const equipmentAudits = await db.auditLog.count({ where: { organizationId: env.orgA, action: "journal.qr_fill", entity: "Equipment" } });
    check("журнал действий: запись QR холодильника", equipmentAudits === 1, equipmentAudits);

    // Лимит: 30 запросов в минуту на объект, 31-й — 429.
    let lastStatus = 0;
    for (let i = 0; i < 31; i += 1) {
      const response = await post("/api/room-fill/rate-limit-probe", { token: "x".repeat(20), employeeId: "nobody", temperature: 1 });
      lastStatus = response.status();
    }
    check("31-й запрос за минуту → 429", lastStatus === 429, lastStatus);
    await anon.close();
  } finally {
    await browser.close();
    await db.organization.update({ where: { id: env.orgA }, data: { qrFillMode: orgMode.qrFillMode } });
    await db.user.update({ where: { id: U.cookA.id }, data: cookPin });
    await db.room.update({ where: { id: env.room.id }, data: { fillerUserIds: roomFillers.fillerUserIds } });
  }

  fs.writeFileSync(path.join(HERE, "poster-scan.json"), JSON.stringify({ checks }, null, 2));
  const failed = checks.filter((item) => !item.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
  if (failed.length > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
