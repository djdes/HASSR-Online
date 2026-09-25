// e2e qr-forms-polish-2026-09: «обсл»/«рем» у холодильников, подсказка под кнопкой,
// комментарий по умолчанию, экран PIN, камера для приказов (сайт и QR).
// Запуск: dev на 3041 (webpack) + фикстуры `.e2e-tmp/setup.json` (seed-restaurant + setup.ts):
//   npx tsx --env-file=.env .agent/tasks/qr-forms-polish-2026-09/e2e/qr-forms.ts
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import { db } from "@/lib/db";
import { normalizeColdEquipmentDocumentConfig, normalizeColdEquipmentEntryData } from "@/lib/cold-equipment-document";

const BASE = process.env.BASE ?? "http://localhost:3041";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SHOTS = path.join(HERE, "..", "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const setup = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".e2e-tmp", "setup.json"), "utf8"));
const ADMIN = { email: "admin@haccp.local", password: "admin1234" };

const checks: Array<{ ac: string; name: string; ok: boolean; detail?: unknown }> = [];
const check = (ac: string, name: string, ok: boolean, detail?: unknown) => {
  checks.push({ ac, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${ac}] ${name}${detail !== undefined ? ` :: ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
};

function todayKey(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: "ru-RU" };
const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "ru-RU" };

async function login(context: BrowserContext) {
  const page = await context.newPage();
  const csrf = await (await page.request.get(`${BASE}/api/auth/csrf`, { timeout: 240_000 })).json();
  const res = await page.request.post(`${BASE}/api/auth/callback/credentials`, {
    form: { email: ADMIN.email, password: ADMIN.password, csrfToken: csrf.csrfToken, json: "true", callbackUrl: `${BASE}/dashboard` },
    maxRedirects: 0,
    timeout: 240_000,
  });
  const session = await (await page.request.get(`${BASE}/api/auth/session`, { timeout: 240_000 })).json();
  if (!session?.user) throw new Error(`login failed: ${res.status()}`);
  // Окно «Мы обновили условия» закрывало бы страницу на снимках.
  await page.request.post(`${BASE}/api/legal/accept`, { data: { consent: true }, timeout: 240_000 });
  return page;
}

async function shot(page: Page, name: string, fullPage = false) {
  await page.screenshot({ path: path.join(SHOTS, name), fullPage, type: "jpeg", quality: 60 } as Parameters<Page["screenshot"]>[0]);
}

/** «Снимок камеры» — настоящий JPEG (скриншот листа с текстом приказа). */
let JPEG: Buffer = Buffer.alloc(0);

async function fridgeQr(browser: Browser) {
  // Повторный прогон: сегодняшние записи холодильников — с чистого листа.
  await db.journalDocumentEntry.deleteMany({ where: { documentId: setup.coldDocId, date: new Date(`${todayKey()}T00:00:00.000Z`) } });
  const context = await browser.newContext(PHONE);
  const page = await context.newPage();
  await page.goto(`${BASE}${setup.fridgeUrl}`, { waitUntil: "networkidle", timeout: 240_000 });
  // AC2: без сотрудника — кнопка неактивна, под ней причина.
  const save = page.getByRole("button", { name: /Сохранить замер/ });
  await save.waitFor({ timeout: 180_000 });
  check("AC2", "без сотрудника кнопка неактивна", await save.isDisabled());
  const reason = await page.locator('[data-testid="qr-save-reason"]').textContent().catch(() => null);
  check("AC2", "под кнопкой «Не выбран сотрудник»", reason?.trim() === "Не выбран сотрудник", reason);
  await shot(page, "01-fridge-no-employee-390.jpg");

  // AC4: ручной выбор сотрудника с PIN → шаг PIN, без «Запомнили…», кнопка «Войти».
  await page.getByText("Выберите своё имя").click();
  await page.getByRole("dialog").getByText(setup.cook.name, { exact: true }).click();
  await page.locator('[data-testid="qr-pin-step"]').waitFor({ timeout: 180_000 });
  check("AC4", "после ручного выбора нет «Запомнили с прошлого раза»", (await page.getByText("Запомнили с прошлого раза").count()) === 0);
  const submit = page.locator('[data-testid="qr-pin-step"] button[type="submit"]');
  check("AC4", "кнопка шага PIN — «Войти»", (await submit.textContent())?.trim() === "Войти", await submit.textContent());
  const geo = await page.evaluate(() => {
    const card = document.querySelector("button span.rounded-full")?.closest("button") as HTMLElement | null;
    const change = card?.querySelector("span.rounded-full") as HTMLElement | null;
    const remember = document.querySelector('[data-testid="qr-remember"]')?.closest("label") as HTMLElement | null;
    const pin = document.querySelector('[data-testid="qr-pin-step"]') as HTMLElement | null;
    const whoWrap = card?.parentElement as HTMLElement | null;
    if (!card || !change || !remember || !pin || !whoWrap) return null;
    const c = card.getBoundingClientRect();
    const b = change.getBoundingClientRect();
    const r = remember.getBoundingClientRect();
    const p = pin.getBoundingClientRect();
    const w = whoWrap.getBoundingClientRect();
    return {
      changeText: change.textContent,
      changeH: Math.round(b.height),
      changeFont: getComputedStyle(change).fontSize,
      centerDelta: Math.abs((b.top + b.bottom) / 2 - (c.top + c.bottom) / 2),
      gapAbove: Math.round(r.top - w.bottom),
      gapBelow: Math.round(p.top - r.bottom),
    };
  });
  check("AC4", "«Сменить» крупнее (≥ 44px, 16px) и по центру карточки", Boolean(geo && geo.changeH >= 44 && geo.changeFont === "16px" && geo.centerDelta <= 1), geo);
  check("AC4", "«Запомнить выбор» — отступы сверху и снизу равны", Boolean(geo && Math.abs(geo.gapAbove - geo.gapBelow) <= 1 && geo.gapBelow > 0), geo);
  await shot(page, "02-fridge-pin-390.jpg");

  await page.locator(".qp-pin").fill("2580");
  await submit.click();
  await save.waitFor({ timeout: 180_000 }).catch(async (err) => {
    console.log("PIN step:", await page.locator(".qp-err, [role=status]").allTextContents());
    await shot(page, "debug-pin.jpg");
    throw err;
  });
  await page.waitForTimeout(3000);
  check("AC4", "после ручного выбора и PIN «Запомнили…» не появляется", (await page.getByText("Запомнили с прошлого раза").count()) === 0);
  const reasonTemp = await page.locator('[data-testid="qr-save-reason"]').textContent().catch(() => null);
  check("AC2", "без температуры — «Не указана температура»", reasonTemp?.trim() === "Не указана температура", reasonTemp);

  // AC3: вне нормы → по умолчанию «Повторю через 30 минут.»
  await page.locator("#equipment-fill-temperature").fill(String(setup.fridge.max + 5));
  const chip = page.getByRole("button", { name: "Повторю через 30 минут." });
  await chip.waitFor({ timeout: 10_000 });
  check("AC3", "чип «Повторю через 30 минут.» выбран", (await chip.getAttribute("aria-pressed")) === "true");
  const textarea = await page.locator("textarea").inputValue();
  check("AC3", "комментарий по умолчанию в поле", textarea === "Повторю через 30 минут.", textarea);
  check("AC2", "с комментарием по умолчанию кнопка активна", await save.isEnabled());
  await shot(page, "03-fridge-deviation-default-390.jpg", true);

  // AC1: «Ремонт» вместо температуры.
  await page.locator('[data-testid="equipment-status-repair"]').click();
  check("AC1", "после «Ремонт» поле температуры скрыто", (await page.locator("#equipment-fill-temperature").count()) === 0);
  check("AC1", "блок «вне нормы» не показывается", (await page.getByText("Температура вне нормы").count()) === 0);
  check("AC1", "кнопка активна без температуры", await save.isEnabled());
  await shot(page, "04-fridge-repair-390.jpg", true);
  await save.click();
  await page.getByText("Записано").waitFor({ timeout: 180_000 });
  const doneText = await page.locator("p").filter({ hasText: "в журнале" }).first().textContent();
  check("AC1", "экран «Записано» говорит «рем»", /«рем»/.test(doneText ?? ""), doneText);

  const day = new Date(`${todayKey()}T00:00:00.000Z`);
  const doc = await db.journalDocument.findUniqueOrThrow({ where: { id: setup.coldDocId }, select: { config: true } });
  const item = normalizeColdEquipmentDocumentConfig(doc.config).equipment.find((e) => e.sourceEquipmentId === setup.fridge.id)!;
  const entries = await db.journalDocumentEntry.findMany({ where: { documentId: setup.coldDocId, date: day }, select: { data: true } });
  const merged = entries.map((e) => normalizeColdEquipmentEntryData(e.data));
  const stored = merged.find((d) => d.statuses?.[item.id]);
  check("AC1", "в БД statuses[слот]=repair, температура null, без комментария", Boolean(stored && stored.statuses?.[item.id] === "repair" && stored.temperatures[item.id] === null && !stored.corrections?.[item.id]), stored);

  // AC4: повторный вход — выбор восстановлен → «Запомнили…»; ручная смена — пропадает.
  await page.goto(`${BASE}${setup.fridgeUrl}`, { waitUntil: "networkidle" });
  await page.getByText(setup.cook.name).first().waitFor({ timeout: 180_000 });
  const restoredHint = await page.getByText("Запомнили с прошлого раза").count();
  check("AC4", "при входе с восстановленным выбором есть «Запомнили…»", restoredHint === 1);
  check("AC1", "сегодняшняя отметка «Ремонт» подставлена в форму", (await page.locator('[data-testid="equipment-status-repair"]').getAttribute("aria-pressed")) === "true");
  await shot(page, "05-fridge-restored-390.jpg");
  const other = await page.evaluate(() => null);
  void other;
  await page.getByText("Сменить").first().click();
  const dialog = page.getByRole("dialog");
  const names = await dialog.locator("ul li button span.block.text-\\[18px\\]").allTextContents();
  const pick = names.find((name) => name !== setup.cook.name)!;
  await dialog.getByText(pick, { exact: true }).click();
  await page.waitForTimeout(300);
  check("AC4", "после ручной смены «Запомнили…» нет", (await page.getByText("Запомнили с прошлого раза").count()) === 0, pick);
  await context.close();
}

async function sitePages(browser: Browser) {
  // Повторный прогон: приказы гигиены — с чистого листа.
  await db.journalOrderScan.deleteMany({ where: { organizationId: setup.orgId } });
  const context = await browser.newContext(DESKTOP);
  const page = await login(context);
  // AC1: ячейка на сайте — «рем» из QR и ввод «обсл» руками.
  await page.goto(`${BASE}/journals/cold_equipment_control/documents/${setup.coldDocId}`, { waitUntil: "load", timeout: 240_000 });
  const cells = page.locator("td input[type=text]");
  await cells.first().waitFor({ timeout: 120_000 });
  const values = await cells.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
  check("AC1", "в таблице на сайте ячейка показывает «рем»", values.includes("рем"), values.filter(Boolean));
  const doc = await db.journalDocument.findUniqueOrThrow({ where: { id: setup.coldDocId }, select: { config: true, dateFrom: true } });
  const items = normalizeColdEquipmentDocumentConfig(doc.config).equipment;
  const target = items.find((e) => e.sourceEquipmentId !== setup.fridge.id)!;
  // Строка другого холодильника, колонка сегодняшнего дня.
  const dayIndex = Math.round((new Date(`${todayKey()}T00:00:00Z`).getTime() - new Date(doc.dateFrom).getTime()) / 86400000);
  const row = page.locator("tr", { hasText: target.name }).first();
  const cell = row.locator("td[data-grid-day]").nth(dayIndex).locator("input");
  await cell.scrollIntoViewIfNeeded();
  await cell.evaluate((el) => (el as HTMLInputElement).focus());
  await cell.fill("обсл", { force: true });
  await cell.evaluate((el) => (el as HTMLInputElement).blur());
  const day = new Date(`${todayKey()}T00:00:00.000Z`);
  let svc: ReturnType<typeof normalizeColdEquipmentEntryData> | undefined;
  for (let attempt = 0; attempt < 120 && !svc; attempt += 1) {
    await page.waitForTimeout(1000);
    const entries = await db.journalDocumentEntry.findMany({ where: { documentId: setup.coldDocId, date: day }, select: { data: true } });
    svc = entries.map((e) => normalizeColdEquipmentEntryData(e.data)).find((d) => d.statuses?.[target.id] === "service");
  }
  check("AC1", "ячейка на сайте принимает «обсл» → statuses=service", Boolean(svc && svc.temperatures[target.id] === null), svc?.statuses);
  await page.reload({ waitUntil: "load", timeout: 240_000 });
  await page.locator("td input[type=text]").first().waitFor({ timeout: 120_000 });
  const after = await page.locator("tr", { hasText: target.name }).first().locator("td[data-grid-day]").nth(dayIndex).locator("input").inputValue();
  check("AC1", "после перезагрузки ячейка — «обсл»", after === "обсл", after);
  await page.locator("tr", { hasText: target.name }).first().scrollIntoViewIfNeeded();
  await shot(page, "06-site-cold-table-1440.jpg");

  // AC1: печать.
  const pdf = await page.request.get(`${BASE}/api/journal-documents/${setup.coldDocId}/pdf`, { timeout: 240_000 });
  const bytes = new Uint8Array(await pdf.body());
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loaded = await pdfjs.getDocument({ data: bytes, useSystemFonts: false }).promise;
  let text = "";
  for (let n = 1; n <= loaded.numPages; n += 1) {
    const content = await (await loaded.getPage(n)).getTextContent();
    text += content.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n";
  }
  check("AC1", "в печати есть «обсл» и «рем»", pdf.ok() && /обсл/.test(text) && /рем(?!о)/.test(text), { status: pdf.status(), hasObsl: /обсл/.test(text), hasRem: /\bрем\b|рем /.test(text) });

  // AC5: «Камера» у приказов — на 1440 скрыта.
  const hygieneDoc = await db.journalDocument.findFirstOrThrow({ where: { organizationId: setup.orgId, template: { code: "hygiene" } }, select: { id: true } });
  await page.goto(`${BASE}/journals/hygiene/documents/${hygieneDoc.id}`, { waitUntil: "load", timeout: 240_000 });
  await page.locator("[data-order-scans]").waitFor({ timeout: 120_000 });
  check("AC5", "на компьютере кнопки «Камера» не видно", !(await page.locator("[data-order-scan-camera]").isVisible()));
  await context.close();

  // AC5: телефон — «Камера» видна, фото загружается как скан JPG.
  const phone = await browser.newContext(PHONE);
  const p2 = await login(phone);
  // Телефон: карточки «Сегодня» — отметки «обсл»/«рем» плашкой, меню «вместо температуры».
  await p2.goto(`${BASE}/journals/cold_equipment_control/documents/${setup.coldDocId}`, { waitUntil: "load", timeout: 240_000 });
  await p2.locator('[data-testid="cold-cell-status"]').first().waitFor({ timeout: 180_000 }).catch(() => null);
  const pills = await p2.locator('[data-testid="cold-cell-status"]').allTextContents();
  check("AC1", "телефон: карточки показывают «рем» и «обсл» плашкой", pills.some((t) => t.startsWith("рем")) && pills.some((t) => t.startsWith("обсл")), pills);
  check("AC1", "телефон: у пустых ячеек есть меню «Обслуживание/Ремонт»", (await p2.getByRole("button", { name: "Обслуживание или ремонт вместо температуры" }).count()) > 0);
  await shot(p2, "09-site-cold-cards-390.jpg");
  await p2.goto(`${BASE}/journals/hygiene/documents/${hygieneDoc.id}`, { waitUntil: "load", timeout: 240_000 });
  await p2.locator("[data-order-scans]").scrollIntoViewIfNeeded();
  const camera = p2.locator("[data-order-scan-camera]");
  check("AC5", "на телефоне есть кнопка «Камера»", await camera.isVisible());
  const cameraInput = p2.locator("[data-order-scan-camera-input]");
  check("AC5", "input камеры: accept image, capture=environment", (await cameraInput.getAttribute("capture")) === "environment" && /image/.test((await cameraInput.getAttribute("accept")) ?? ""));
  const before = await db.journalOrderScan.count({ where: { organizationId: setup.orgId, journalCode: "hygiene" } });
  await cameraInput.setInputFiles({ name: "IMG_0001.jpg", mimeType: "image/jpeg", buffer: JPEG });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if ((await db.journalOrderScan.count({ where: { organizationId: setup.orgId, journalCode: "hygiene" } })) > before) break;
    await p2.waitForTimeout(1000);
  }
  await p2.locator("[data-order-scan]").nth(before).waitFor({ timeout: 180_000 });
  const created = await db.journalOrderScan.findFirst({ where: { organizationId: setup.orgId, journalCode: "hygiene" }, orderBy: { createdAt: "desc" }, select: { title: true, mimeType: true, fileName: true } });
  const after2 = await db.journalOrderScan.count({ where: { organizationId: setup.orgId, journalCode: "hygiene" } });
  check("AC5", "фото с камеры на сайте загружено как скан JPG", after2 === before + 1 && created?.mimeType === "image/jpeg" && /^Приказ — фото/.test(created?.title ?? ""), created);
  await p2.locator("[data-order-scans]").scrollIntoViewIfNeeded();
  await shot(p2, "07-site-order-camera-390.jpg");
  await phone.close();
}

async function qrOrderCamera(browser: Browser) {
  // Руководитель вошёл в кабинет на телефоне, заполняет по QR сотрудник с PIN.
  const context = await browser.newContext(PHONE);
  const page = await login(context);
  await page.goto(`${BASE}${setup.hygieneUrl}`, { waitUntil: "networkidle", timeout: 240_000 });
  const pickCook = page.locator(`button[name="employee"][value="${setup.cook.id}"]`);
  if (await pickCook.count()) { await pickCook.first().evaluate((el) => (el as HTMLButtonElement).click()); await page_wait(); }
  await page.locator("#qp-pin").waitFor({ timeout: 180_000 });
  const pinBtn = await page.locator("#qr-pin button[type=submit]").textContent();
  check("AC4", "HTML-шаг PIN: кнопка «Войти»", pinBtn?.trim() === "Войти", pinBtn);
  const whoA = await page.evaluate(() => {
    const a = document.querySelector(".who a") as HTMLElement | null;
    const who = a?.closest(".who") as HTMLElement | null;
    if (!a || !who) return null;
    const ra = a.getBoundingClientRect();
    const rw = who.getBoundingClientRect();
    return { h: Math.round(ra.height), font: getComputedStyle(a).fontSize, centerDelta: Math.abs((ra.top + ra.bottom) / 2 - (rw.top + rw.bottom) / 2) };
  });
  check("AC4", "HTML «Сменить» ≥ 44px, 16px, по центру", Boolean(whoA && whoA.h >= 44 && whoA.font === "16px" && whoA.centerDelta <= 1), whoA);
  await page.fill("#qp-pin", "2580");
  await page.click("#qr-pin button[type=submit]");
  await page.waitForLoadState("networkidle");
  const block = page.locator("#order-scans");
  check("AC5", "QR гигиены: руководителю в сессии виден блок «Приказы» с камерой", (await block.count()) === 1 && (await page.locator("#oscan-file").getAttribute("capture")) === "environment");
  const before = await db.journalOrderScan.count({ where: { organizationId: setup.orgId, journalCode: "hygiene" } });
  await page.locator("#oscan-file").setInputFiles({ name: "IMG_0002.jpg", mimeType: "image/jpeg", buffer: JPEG });
  await page.locator("#oscan-status").filter({ hasText: "добавлен" }).waitFor({ timeout: 180_000 });
  const after = await db.journalOrderScan.count({ where: { organizationId: setup.orgId, journalCode: "hygiene" } });
  check("AC5", "QR: фото приказа загружено тем же API", after === before + 1, { before, after });
  await block.scrollIntoViewIfNeeded();
  await shot(page, "08-qr-hygiene-order-camera-390.jpg");

  // БЖГП (бракераж готовой продукции).
  await page.goto(`${BASE}${setup.finishedUrl}`, { waitUntil: "networkidle", timeout: 240_000 });
  const pick2 = page.locator(`button[name="employee"][value="${setup.cook.id}"]`);
  if (await pick2.count()) { await pick2.first().evaluate((el) => (el as HTMLButtonElement).click()); await page_wait(); }
  if (await page.locator("#qp-pin").count()) {
    await page.fill("#qp-pin", "2580");
    await page.click("#qr-pin button[type=submit]");
    await page.waitForLoadState("networkidle");
  }
  check("AC5", "QR БЖГП: блок «Приказы» с камерой есть", (await page.locator("#order-scans[data-code=finished_product] #oscan-file").count()) === 1);
  const bodyHtml = await page.content();
  if (bodyHtml.includes('name="__correction"')) {
    check("AC3", "HTML-форма: комментарий по умолчанию «Повторю через 30 минут.»", /<textarea[^>]*name="__correction"[^>]*>Повторю через 30 минут\.<\/textarea>/.test(bodyHtml));
  }
  await context.close();

  // Без входа в кабинет — блока нет, API отказывает.
  const anon = await browser.newContext(PHONE);
  const p3 = await anon.newPage();
  await p3.goto(`${BASE}${setup.hygieneUrl}`, { waitUntil: "networkidle", timeout: 240_000 });
  const pick3 = p3.locator(`button[name="employee"][value="${setup.cook.id}"]`);
  if (await pick3.count()) { await pick3.first().evaluate((el) => (el as HTMLButtonElement).click()); await page_wait(); }
  await p3.locator("#qp-pin").waitFor({ timeout: 180_000 });
  await p3.fill("#qp-pin", "2580");
  await p3.click("#qr-pin button[type=submit]");
  await p3.waitForLoadState("networkidle");
  check("AC5", "QR без сессии руководителя: блока «Приказы» нет", (await p3.locator("#order-scans").count()) === 0 && (await p3.locator(".qp-pin, #qp-pin").count()) === 0);
  const api = await p3.request.post(`${BASE}/api/journal-order-scans`, { multipart: { code: "hygiene", file: { name: "x.jpg", mimeType: "image/jpeg", buffer: JPEG } }, timeout: 240_000 });
  check("AC5", "API без сессии — 401", api.status() === 401, api.status());
  await anon.close();
}

const page_wait = () => new Promise((r) => setTimeout(r, 1500));

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const tmp = await browser.newPage({ viewport: { width: 600, height: 800 } });
    await tmp.setContent('<div style="padding:40px;font:20px serif">ПРИКАЗ № 12<br>о назначении ответственного за гигиенический журнал</div>');
    JPEG = await tmp.screenshot({ type: "jpeg", quality: 70 });
    await tmp.close();
    await fridgeQr(browser);
    await sitePages(browser);
    await qrOrderCamera(browser);
  } catch (err) {
    check("run", "сценарий без исключений", false, String(err instanceof Error ? err.stack : err));
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(HERE, "qr-forms.json"), JSON.stringify({ at: new Date().toISOString(), checks }, null, 2));
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
  process.exit(failed.length ? 1 : 0);
}

void main();
