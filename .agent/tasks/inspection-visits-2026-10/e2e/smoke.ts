// E2E-смоук «Пришла проверка → журнал посещений» (AC2–AC7, AC9).
// Стенд: npx tsx .agent/tasks/inspection-visits-2026-10/e2e/setup.ts
// Запуск: BASE=http://localhost:3043 npx tsx .agent/tasks/inspection-visits-2026-10/e2e/smoke.ts
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { chromium, request as pwRequest, type Browser, type BrowserContext, type Page } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3043";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const RAW = path.join(HERE, "..", "raw");
fs.mkdirSync(RAW, { recursive: true });
const state = JSON.parse(fs.readFileSync(path.join(HERE, "state.json"), "utf8"));

const checks: Array<{ id: string; name: string; ok: boolean; detail?: unknown }> = [];
function check(id: string, name: string, ok: boolean, detail?: unknown) {
  checks.push({ id, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${name}${detail !== undefined ? ` :: ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
}

const DESKTOP = { viewport: { width: 1440, height: 900 } };
const MOBILE = { viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

function pngFile(): { name: string; mimeType: string; buffer: Buffer } {
  const canvas = createCanvas(1200, 1600);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 1200, 1600);
  ctx.fillStyle = "#1f3a8a";
  ctx.font = "60px sans-serif";
  ctx.fillText("Решение № 12-р", 120, 200);
  return { name: "решение-лист1.png", mimeType: "image/png", buffer: canvas.toBuffer("image/png") };
}

async function pdfFile(name: string): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  page.drawText("Decision 12-r scan", { x: 60, y: 760, size: 18, font: await doc.embedFont(StandardFonts.Helvetica) });
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) };
}

/** Контекст без оверлея dev-сервера Next (значок ошибок перекрывает клики и скриншоты). */
async function newContext(browser: Browser, options: typeof DESKTOP | typeof MOBILE): Promise<BrowserContext> {
  const context = await browser.newContext({ ...options, locale: "ru-RU" });
  context.setDefaultTimeout(600_000);
  await context.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal{display:none!important}";
    document.documentElement.appendChild(style);
  });
  return context;
}

async function goto(page: Page, url: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await page.goto(url, { waitUntil: "load", timeout: 300_000 }).catch(() => null);
    if (response && response.status() < 500) return response;
    await page.waitForTimeout(3_000);
  }
  return page.goto(url, { waitUntil: "load", timeout: 300_000 });
}

async function dismissModals(page: Page) {
  await page.locator('[aria-labelledby="whats-new-title"] button[aria-label="Закрыть"]').click({ timeout: 1_500 }).catch(() => {});
  await page.getByRole("button", { name: /^(Принять|Понятно|Хорошо|OK|ОК)$/ }).first().click({ timeout: 1_000 }).catch(() => {});
}

async function login(browser: Browser, email: string, options = DESKTOP): Promise<{ context: BrowserContext; page: Page }> {
  const context = await newContext(browser, options);
  const page = await context.newPage();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await goto(page, `${BASE}/login`);
    await page.waitForLoadState("networkidle").catch(() => null);
    await page.fill("#email", email);
    await page.fill("#password", state.password);
    await page.click('button[type="submit"]').catch(() => null);
    const left = await page
      .waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120_000 })
      .then(() => true)
      .catch(() => false);
    if (left) return { context, page };
  }
  throw new Error(`login failed: ${email}`);
}

async function noHorizontalScroll(page: Page) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  return { ok: r.sw <= r.cw + 1, ...r };
}

/**
 * Не кэшируется и не «угадывается» браузером. Маршрут ставит
 * `private, no-store`; общий `headers()` из next.config.ts заменяет его на ещё
 * более строгий `no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0`.
 */
function hardened(headers: Record<string, string>) {
  const cache = (headers["cache-control"] ?? "").split(",").map((part) => part.trim());
  return cache.includes("no-store") && headers["x-content-type-options"] === "nosniff";
}

async function main() {
  // PW_CHROMIUM_PATH — если установленный браузер новее, чем ждёт playwright из node_modules.
  const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
  const anon = await pwRequest.newContext({ baseURL: BASE, timeout: 600_000 });
  const portal = `${BASE}/inspector/${state.tokens.qr}`;

  // ---------- Портал проверяющего (AC6) ----------
  const pctx = await newContext(browser, DESKTOP);
  const p = await pctx.newPage();
  await goto(p, portal);
  await p.waitForSelector("[data-visit-form]", { timeout: 300_000 });
  await dismissModals(p);
  const callout = await p.getAttribute("[data-visit-callout]", "data-visit-callout");
  check("AC6a", "портал: напоминание внести запись о посещении", callout === "todo", callout);
  const ppkLinks = await p.locator('[data-portal-section="production-control"] a').evaluateAll((els) => els.map((el) => el.getAttribute("href")));
  check("AC6b", "портал: ППК/ХАССП-план — PDF и подписанный файл через токен-маршрут", ppkLinks.length === 3 && ppkLinks.every((h) => h?.startsWith(`/api/inspector/${state.tokens.qr}/production-control/`)), ppkLinks);
  const norms = await p.locator('[data-portal-section="norms"] ol li').count();
  check("AC6c", "портал: перечень нормативных документов", norms > 0, { norms });
  const checklistRows = await p.locator("[data-checklist-row]").allInnerTexts();
  check(
    "AC6d",
    "портал: итоги чек-листов за период (2 завершённые, без черновика, балл и нарушения)",
    checklistRows.length === 2 && checklistRows.some((t) => /90%/.test(t) && /нарушений: 1/.test(t)) && !checklistRows.some((t) => /Черновик/.test(t)),
    checklistRows
  );
  const medValid = (await p.textContent("[data-med-valid]"))?.trim();
  const medExpired = (await p.textContent("[data-med-expired]"))?.trim();
  const bodyText = await p.locator("body").innerText();
  const leakedNames = ["Марина Соколова", "Ольга Заведующая", "Пётр Повар"].filter((name) => bodyText.includes(name));
  check("AC6e", "портал: медкнижки — действуют 2 / просрочены 1, ФИО сотрудников на странице нет", medValid === "2" && medExpired === "1" && leakedNames.length === 0, { medValid, medExpired, leakedNames });
  await p.screenshot({ path: path.join(RAW, "portal-desktop-1440.png"), fullPage: true });

  // Сборные PDF и загруженный файл — по токену.
  const ppkPdf = await anon.get(`/api/inspector/${state.tokens.qr}/production-control/ppk`);
  const ppkFile = await anon.get(`/api/inspector/${state.tokens.qr}/production-control/ppk?file=1`);
  const haccpPdf = await anon.get(`/api/inspector/${state.tokens.qr}/production-control/haccp-plan`);
  check(
    "AC6b-api",
    "портал: собранный ППК, ХАССП-план и подписанный ППК отдаются по токену",
    ppkPdf.status() === 200 && ppkPdf.headers()["content-type"] === "application/pdf" && ppkFile.status() === 200 && haccpPdf.status() === 200 && hardened(ppkFile.headers()),
    { ppk: ppkPdf.status(), file: ppkFile.status(), haccp: haccpPdf.status() }
  );
  const revokedPpk = await anon.get(`/api/inspector/${state.tokens.revoked}/production-control/ppk`);
  check("AC6b-revoked", "ППК по отозванному токену — 410", revokedPpk.status() === 410, revokedPpk.status());

  // Запись о посещении со сканом (AC2, AC6a).
  await p.fill('[data-visit-form] input[name="inspectorName"]', "Иванова Анна Петровна");
  await p.fill('[data-visit-form] input[name="inspectorPosition"]', "Главный специалист-эксперт");
  await p.fill('[data-visit-form] input[name="authority"]', "Управление Роспотребнадзора по Московской области");
  await p.locator('[data-visit-form] input[name="kind"][value="unplanned"]').check();
  await p.fill('[data-visit-form] input[name="basisNumber"]', "12-р");
  await p.fill('[data-visit-form] input[name="basisDate"]', "2026-10-01");
  await p.setInputFiles("[data-visit-form] input[type=file]", [pngFile()]);
  await p.waitForSelector("[data-visit-files] li", { timeout: 60_000 });
  await p.screenshot({ path: path.join(RAW, "portal-form-filled-1440.png"), fullPage: false, clip: undefined });
  const [visitResponse] = await Promise.all([
    p.waitForResponse((r) => r.url().endsWith("/visits") && r.request().method() === "POST", { timeout: 120_000 }),
    p.click('[data-visit-form] button[type="submit"]'),
  ]);
  check("AC2-ui", "портал: запись внесена (201)", visitResponse.status() === 201, visitResponse.status());
  await p.waitForSelector('[data-visit-status="saved"]', { timeout: 60_000 });
  await p.waitForSelector("[data-own-visit]", { timeout: 120_000 });
  const ownFileHref = await p.locator('[data-own-visit] a[href*="/visit-files/"]').first().getAttribute("href");
  check("AC6a-list", "портал: своя запись со ссылкой на скан", !!ownFileHref, ownFileHref);
  await p.locator('[data-portal-section="visits"]').scrollIntoViewIfNeeded();
  await p.screenshot({ path: path.join(RAW, "portal-after-visit-1440.png"), fullPage: true });

  // Свой скан — из того же браузера (cookie «мои записи»).
  const ownFile = await p.request.get(`${BASE}${ownFileHref}`);
  check("AC3-token-own", "проверяющий открывает скан своей записи: 200, image/jpeg, private/no-store/nosniff", ownFile.status() === 200 && ownFile.headers()["content-type"] === "image/jpeg" && hardened(ownFile.headers()), { status: ownFile.status(), headers: ownFile.headers() });
  const noCookieFile = await anon.get(ownFileHref ?? "/");
  check("SR4-no-cookie-file", "тот же QR без cookie этого браузера: скан — 404", noCookieFile.status() === 404 && hardened(noCookieFile.headers()), noCookieFile.status());
  const fileId = ownFileHref?.split("/").pop() ?? "";
  for (const [label, token] of [
    ["отозванный", state.tokens.revoked],
    ["истёкший", state.tokens.expired],
    ["другой организации", state.tokens.qrB],
  ] as const) {
    const res = await anon.get(`/api/inspector/${token}/visit-files/${fileId}`);
    check(`AC3-token-${label}`, `скан по токену (${label}) — 404 без подсказки`, res.status() === 404 && hardened(res.headers()), res.status());
  }
  const foreign = await anon.get(`/api/inspector/${state.tokens.qr}/visit-files/${state.foreignFileId}`);
  check("AC3-token-foreign-file", "проверяющий не открывает скан чужой организации — 404", foreign.status() === 404, foreign.status());

  // Отказы записи по токену (AC2).
  const form = { inspectorName: "Тест Тестов", inspectorPosition: "Инспектор", authority: "РПН", kind: "planned" };
  const revokedPost = await anon.post(`/api/inspector/${state.tokens.revoked}/visits`, { multipart: form });
  const expiredPost = await anon.post(`/api/inspector/${state.tokens.expired}/visits`, { multipart: form });
  const unknownPost = await anon.post(`/api/inspector/${"Z".repeat(43)}/visits`, { multipart: form });
  check("AC2-tokens", "запись: неизвестный 404, отозванный 410, истёкший 410", unknownPost.status() === 404 && revokedPost.status() === 410 && expiredPost.status() === 410, [unknownPost.status(), revokedPost.status(), expiredPost.status()]);
  const heic = await anon.post(`/api/inspector/${state.tokens.qr}/visits`, {
    multipart: { ...form, file: { name: "IMG_0001.HEIC", mimeType: "image/heic", buffer: Buffer.from([0, 0, 0, 24, ...Buffer.from("ftypheic"), 0, 0, 0, 0]) } },
  });
  check("AC2-heic", "запись: HEIC — 400 с понятной причиной", heic.status() === 400 && /HEIC/.test((await heic.json()).error), heic.status());

  // Ревью безопасности: PNG-бомба, запрос без Content-Length, гонка суточного лимита.
  const bombPng = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).copy(bombPng, 0);
  bombPng.writeUInt32BE(20_000, 16);
  bombPng.writeUInt32BE(20_000, 20);
  const bomb = await anon.post(`/api/inspector/${state.tokens.qr}/visits`, {
    multipart: { ...form, file: { name: "bomb.png", mimeType: "image/png", buffer: bombPng } },
  });
  const bombBody = await bomb.json();
  check("SR1-png-bomb", "PNG 20000×20000: 400 «слишком большая картинка», сервер жив", bomb.status() === 400 && /мегапиксел/.test(bombBody.error), { status: bomb.status(), error: bombBody.error });

  const chunked = await fetch(`${BASE}/api/inspector/${state.tokens.qr}/visits`, {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=x" },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("--x--\r\n"));
        controller.close();
      },
    }),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  check("SR5-411", "запрос без Content-Length (chunked) — 411", chunked.status === 411, chunked.status);

  const raceForm = { inspectorName: "Гонка Тестовая", inspectorPosition: "Инспектор", authority: "РПН", kind: "planned" };
  const raceStatuses = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      anon
        .post(`/api/inspector/${state.tokens.qrRace}/visits`, { multipart: raceForm, headers: { "x-real-ip": `198.51.100.${i + 1}` } })
        .then((res) => res.status())
    )
  );
  check(
    "SR3-race",
    "12 одновременных записей по одному токену: создано ровно 10, остальные — 429",
    raceStatuses.filter((s) => s === 201).length === 10 && raceStatuses.filter((s) => s === 429).length === 2,
    raceStatuses
  );

  // Мобильный портал.
  const mctx = await newContext(browser, MOBILE);
  const mp = await mctx.newPage();
  await goto(mp, portal);
  await mp.waitForSelector("[data-visit-form]", { timeout: 300_000 });
  await dismissModals(mp);
  const mScroll = await noHorizontalScroll(mp);
  check("AC9-portal-390", "портал 390px без горизонтальной прокрутки", mScroll.ok, mScroll);
  // Другой браузер с тем же QR: чужих записей (ФИО, сканов) не видно.
  const otherBrowserVisits = await mp.locator("[data-own-visit]").count();
  const otherBrowserText = await mp.locator("body").innerText();
  check(
    "SR4-other-browser",
    "тот же QR в другом браузере: записи первого проверяющего не видны",
    otherBrowserVisits === 0 && !otherBrowserText.includes("Иванова Анна Петровна") && (await mp.locator("[data-own-visits-note]").count()) === 1,
    { otherBrowserVisits }
  );
  await mp.screenshot({ path: path.join(RAW, "portal-mobile-390.png"), fullPage: true });
  await mctx.close();

  // ---------- Кабинет руководителя (AC4, AC5, AC7) ----------
  const { context: mgr, page: m } = await login(browser, state.users.manager);
  await goto(m, `${BASE}/inspection`);
  await dismissModals(m);
  await m.waitForSelector("[data-inspection-visits-journal]", { timeout: 300_000 });
  const guideSteps = await m.locator("[data-guide-step]").count();
  const tips = await m.locator("[data-inspection-guide] ul li").count();
  check("AC7-guide", "«Что делать сейчас»: 5 шагов и советы", guideSteps === 5 && tips >= 4, { guideSteps, tips });
  const row = m.locator("[data-visit-row]").first();
  const rowText = await row.innerText();
  check("AC4-list", "журнал посещений: запись проверяющего (кто, орган, вид, основание, кем внесено, скан)", /Иванова Анна Петровна/.test(rowText) && /Роспотребнадзора/.test(rowText) && /Внеплановая/.test(rowText) && /12-р/.test(rowText) && /по QR/.test(rowText) && (await row.locator("[data-visit-file]").count()) === 1, rowText);
  const cabinetHref = await row.locator("[data-visit-file]").first().getAttribute("href");
  const cabinetFile = await m.request.get(`${BASE}${cabinetHref}`);
  check("AC3-cabinet", "руководство открывает скан своей организации: 200, private/no-store/nosniff", cabinetFile.status() === 200 && hardened(cabinetFile.headers()), cabinetFile.status());
  const cabinetForeign = await m.request.get(`${BASE}/api/inspection/visit-files/${state.foreignFileId}`);
  check("AC3-cabinet-foreign", "скан чужой организации из кабинета — 404", cabinetForeign.status() === 404 && hardened(cabinetForeign.headers()), cabinetForeign.status());

  // Приложить скан к записи.
  const [chooser] = await Promise.all([m.waitForEvent("filechooser"), row.locator("[data-attach-visit]").click()]);
  const [attachResponse] = await Promise.all([
    m.waitForResponse((r) => /\/api\/inspection\/visits\/[^/]+\/files$/.test(r.url()), { timeout: 120_000 }),
    chooser.setFiles([await pdfFile("решение-лист2.pdf")]),
  ]);
  check("AC4-attach", "приложить скан к записи — 201", attachResponse.status() === 201, attachResponse.status());
  await m.waitForFunction(() => document.querySelectorAll("[data-visit-row]:first-child [data-visit-file]").length === 2, null, { timeout: 60_000 });

  // Добавить запись со сканом.
  await m.click("[data-add-visit]");
  const dialog = m.locator("[data-add-visit-dialog]");
  await dialog.waitFor();
  await dialog.locator('input[name="inspectorName"]').fill("Петров Сергей Николаевич");
  await dialog.locator('input[name="inspectorPosition"]').fill("Ведущий специалист-эксперт");
  await dialog.locator('input[name="authority"]').fill("Территориальный отдел Роспотребнадзора");
  await dialog.locator('input[name="kind"][value="other"]').check();
  await dialog.locator('input[name="kindNote"]').fill("профилактический визит");
  await dialog.locator('input[name="basisNumber"]').fill("77");
  await dialog.locator("input[type=file]").setInputFiles([await pdfFile("решение-77.pdf")]);
  await dialog.locator("li", { hasText: "решение-77.pdf" }).waitFor({ timeout: 30_000 });
  await m.screenshot({ path: path.join(RAW, "cabinet-add-visit-dialog-1440.png") });
  const [addResponse] = await Promise.all([
    m.waitForResponse((r) => r.url().endsWith("/api/inspection/visits") && r.request().method() === "POST", { timeout: 120_000 }),
    dialog.locator('button[type="submit"]').click(),
  ]);
  check("AC4-add", "руководство добавляет запись со сканом — 201", addResponse.status() === 201, addResponse.status());
  await m.waitForFunction(() => document.querySelectorAll("[data-visit-row]").length === 2, null, { timeout: 60_000 });
  const managerRow = await m.locator("[data-visit-row]", { hasText: "Петров Сергей" }).innerText();
  check("AC4-add-row", "новая запись: «Иное: профилактический визит», внесено руководителем, скан", /Иное: профилактический визит/.test(managerRow) && /Марина Соколова/.test(managerRow) && /Скан 1/.test(managerRow), managerRow);

  // Спецрежим, нормативка, эксперты.
  const special = m.locator("[data-inspection-special-mode]");
  const switchEnabled = await special.getByRole("switch").isEnabled();
  check("AC7-special", "«Спецрежим»: руководитель может переключить", switchEnabled, switchEnabled);
  const normPdfHref = await m.locator("[data-inspection-norms] [data-norm-pdf]").first().getAttribute("href");
  const normPdf = await m.request.get(`${BASE}${normPdfHref}`);
  check("AC7-norms", "«Нормативка»: PDF ППК открывается", normPdf.status() === 200 && normPdf.headers()["content-type"] === "application/pdf", { href: normPdfHref, status: normPdf.status() });
  const experts = await m.locator("[data-expert-service]").evaluateAll((els) => els.map((el) => el.getAttribute("href")));
  check("AC7-experts", "кнопки «Подготовка с экспертом» и «Выезд специалиста» ведут на заказ услуг", experts.includes("/settings/services?order=pre-inspection-audit") && experts.includes("/settings/services?order=site-visit"), experts);
  await m.screenshot({ path: path.join(RAW, "cabinet-inspection-desktop-1440.png"), fullPage: true });

  // Архив проверки (AC5).
  const today = new Date().toISOString().slice(0, 10);
  const zipResponse = await m.request.get(`${BASE}/api/reports/compliance-bundle?from=${today.slice(0, 8)}01&to=${today}`, { timeout: 600_000 });
  const zip = await JSZip.loadAsync(await zipResponse.body());
  const names = Object.keys(zip.files);
  const visitFiles = names.filter((n) => n.startsWith("Посещения проверяющих/") && !zip.files[n].dir);
  const manifest = zip.files["ОТЧЁТ.txt"] ? await zip.files["ОТЧЁТ.txt"].async("string") : "";
  check(
    "AC5-zip",
    "архив: «Журнал посещений.pdf» + 3 скана посещений периода, строка в ОТЧЁТ.txt",
    zipResponse.status() === 200 && visitFiles.includes("Посещения проверяющих/Журнал посещений.pdf") && visitFiles.length === 4 && /Посещения проверяющих: записей 2, сканов оснований 3/.test(manifest),
    { status: zipResponse.status(), visitFiles, manifestLine: manifest.split(/\r?\n/).find((l) => l.includes("Посещения")) }
  );
  fs.writeFileSync(path.join(RAW, "compliance-bundle-visits.json"), JSON.stringify({ visitFiles, manifest }, null, 2));

  // Ревью безопасности: «Скрыть как ошибочную» (запись проверяющего).
  const inspectorRow = m.locator("[data-visit-row]", { hasText: "Иванова Анна Петровна" });
  await inspectorRow.locator("[data-hide-visit]").click();
  await m.locator("[data-hide-reason]").fill("тестовая запись при проверке");
  await m.screenshot({ path: path.join(RAW, "cabinet-hide-dialog-1440.png") });
  const [hideResponse] = await Promise.all([
    m.waitForResponse((r) => /\/api\/inspection\/visits\/[^/]+\/hidden$/.test(r.url()), { timeout: 120_000 }),
    m.getByRole("button", { name: "Скрыть запись" }).click(),
  ]);
  await m.waitForFunction(() => document.querySelectorAll("[data-visit-row]").length === 1, null, { timeout: 60_000 });
  const toggleText = (await m.locator("[data-toggle-hidden]").innerText()).trim();
  check("SR3-hide", "руководитель скрыл запись через диалог: из списка пропала, есть «Показать скрытые (1)»", hideResponse.status() === 200 && /\(1\)/.test(toggleText), { status: hideResponse.status(), toggleText });

  const zip2Response = await m.request.get(`${BASE}/api/reports/compliance-bundle?from=${today.slice(0, 8)}01&to=${today}`, { timeout: 600_000 });
  const zip2 = await JSZip.loadAsync(await zip2Response.body());
  const manifest2 = zip2.files["ОТЧЁТ.txt"] ? await zip2.files["ОТЧЁТ.txt"].async("string") : "";
  check("SR3-zip-hidden", "скрытая запись не попадает в архив", /Посещения проверяющих: записей 1, сканов оснований 1/.test(manifest2), manifest2.split(/\r?\n/).find((l) => l.includes("Посещения")));

  await goto(p, portal);
  await p.waitForSelector("[data-visit-form]", { timeout: 300_000 });
  const portalAfterHide = await p.locator("[data-own-visit]").count();
  const hiddenFile = await p.request.get(`${BASE}${ownFileHref}`);
  check("SR3-portal-hidden", "скрытая запись пропала с портала и её скан — 404 даже своему браузеру", portalAfterHide === 0 && hiddenFile.status() === 404, { portalAfterHide, file: hiddenFile.status() });

  await m.locator("[data-toggle-hidden]").click();
  const hiddenRow = m.locator('[data-visit-row][data-visit-hidden="true"]');
  await hiddenRow.waitFor({ timeout: 30_000 });
  const hiddenRowText = await hiddenRow.innerText();
  await m.screenshot({ path: path.join(RAW, "cabinet-hidden-shown-1440.png"), fullPage: true });
  check("SR3-show-hidden", "«Показать скрытые»: запись видна с причиной и тем, кто скрыл", /тестовая запись при проверке/.test(hiddenRowText) && /Марина Соколова/.test(hiddenRowText), hiddenRowText);
  const [restoreResponse] = await Promise.all([
    m.waitForResponse((r) => /\/api\/inspection\/visits\/[^/]+\/hidden$/.test(r.url()), { timeout: 120_000 }),
    hiddenRow.locator("[data-restore-visit]").click(),
  ]);
  await m.waitForFunction(() => document.querySelectorAll('[data-visit-row][data-visit-hidden="true"]').length === 0, null, { timeout: 60_000 });
  check("SR3-restore", "«Вернуть»: запись снова в журнале", restoreResponse.status() === 200 && (await m.locator("[data-visit-row]").count()) === 2, restoreResponse.status());
  await pctx.close();

  // «Реквизиты»: ссылка на блок вместо переключателя.
  await goto(m, `${BASE}/settings/organization`);
  await dismissModals(m);
  const moved = m.locator("[data-special-mode-moved]");
  await moved.waitFor({ timeout: 300_000 });
  const movedHref = await moved.locator("a").getAttribute("href");
  check("AC7-requisites", "«Реквизиты»: ссылка на блок «Спецрежим»", movedHref === "/inspection#special-mode", movedHref);
  await moved.scrollIntoViewIfNeeded();
  await m.screenshot({ path: path.join(RAW, "requisites-special-mode-link-1440.png") });
  await mgr.close();

  // Мобильный кабинет.
  const { context: mgrMobile, page: mm } = await login(browser, state.users.manager, MOBILE);
  await goto(mm, `${BASE}/inspection`);
  await dismissModals(mm);
  await mm.waitForSelector("[data-inspection-visits-journal]", { timeout: 300_000 });
  const cScroll = await noHorizontalScroll(mm);
  check("AC9-cabinet-390", "/inspection 390px без горизонтальной прокрутки", cScroll.ok, cScroll);
  await mm.screenshot({ path: path.join(RAW, "cabinet-inspection-mobile-390.png"), fullPage: true });
  await mm.click("[data-add-visit]");
  await mm.locator("[data-add-visit-dialog]").waitFor();
  await mm.screenshot({ path: path.join(RAW, "cabinet-add-visit-dialog-mobile-390.png") });
  await mgrMobile.close();

  // ---------- Заведующая с tasks.verify ----------
  const { context: head, page: h } = await login(browser, state.users.headChef);
  await goto(h, `${BASE}/inspection`);
  await dismissModals(h);
  await h.waitForSelector("[data-inspection-visits-journal]", { timeout: 300_000 });
  const headSwitch = await h.locator("[data-inspection-special-mode]").getByRole("switch").isDisabled();
  const headExperts = await h.locator("[data-inspection-experts]").count();
  const headNormPdf = await h.request.get(`${BASE}/api/production-control/haccp-plan/pdf`);
  const headFile = await h.request.get(`${BASE}${cabinetHref}`);
  check("AC7-head", "заведующая: спецрежим только статус, без услуг, PDF ХАССП-плана и скан открываются", headSwitch && headExperts === 0 && headNormPdf.status() === 200 && headFile.status() === 200, { headSwitch, headExperts, pdf: headNormPdf.status(), file: headFile.status() });
  const headHideButtons = await h.locator("[data-hide-visit]").count();
  const anyVisitId = await h.locator("[data-visit-row]").first().getAttribute("data-visit-row");
  const headHide = await h.request.post(`${BASE}/api/inspection/visits/${anyVisitId}/hidden`, { data: { hidden: true, reason: "попытка заведующей" } });
  check("SR3-head", "заведующая не скрывает записи: кнопок нет, API — 403", headHideButtons === 0 && headHide.status() === 403, { headHideButtons, status: headHide.status() });
  await h.screenshot({ path: path.join(RAW, "cabinet-inspection-head-chef-1440.png"), fullPage: true });
  await head.close();

  // ---------- Повар без прав ----------
  const { context: cookCtx, page: c } = await login(browser, state.users.cook);
  const cookPost = await c.request.post(`${BASE}/api/inspection/visits`, { multipart: form });
  const cookFile = await c.request.get(`${BASE}${cabinetHref}`);
  const cookPage = await goto(c, `${BASE}/inspection`);
  check("AC4-cook", "повар: POST 403, скан 404, страница недоступна", cookPost.status() === 403 && cookFile.status() === 404 && !new URL(c.url()).pathname.startsWith("/inspection"), { post: cookPost.status(), file: cookFile.status(), url: c.url(), page: cookPage?.status() });
  await cookCtx.close();

  await anon.dispose();
  await browser.close();
  const failed = checks.filter((item) => !item.ok);
  // Сырые токены стенда в отчёт не пишем.
  let report = JSON.stringify({ at: new Date().toISOString(), base: BASE, failed: failed.length, checks }, null, 2);
  for (const [name, value] of Object.entries(state.tokens as Record<string, string>)) report = report.split(value).join(`<token:${name}>`);
  fs.writeFileSync(path.join(HERE, "smoke-result.json"), report);
  console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  // Браузер остался открытым — без явного выхода процесс не завершится.
  process.exit(1);
});
