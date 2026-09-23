// E2E-смоук «QR для проверяющих» (AC1–AC7) на своей организации e2e-org-insp.
// Стенд: npx tsx .agent/tasks/inspector-qr-2026-09/e2e/setup.ts
// Запуск: BASE=http://localhost:3025 npx tsx .agent/tasks/inspector-qr-2026-09/e2e/smoke.ts
import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";

import { db } from "../../journal-responsibles-org-2026-09/e2e/db";

const BASE = process.env.BASE ?? "http://localhost:3025";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SHOTS = path.join(HERE, "..", "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const state = JSON.parse(fs.readFileSync(path.join(HERE, "state.json"), "utf8"));
const ORG: string = state.org;
const TODAY: string = state.today;

const checks: Array<{ id: string; name: string; ok: boolean; detail?: unknown }> = [];
function check(id: string, name: string, ok: boolean, detail?: unknown) {
  checks.push({ id, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${name}${!ok && detail !== undefined ? ` :: ${JSON.stringify(detail).slice(0, 600)}` : ""}`);
}

const MOBILE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESKTOP = { viewport: { width: 1280, height: 900 } };

async function goto(page: Page, url: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await page.goto(url, { waitUntil: "load", timeout: 240_000 }).catch(() => null);
    if (response && response.status() < 500) return response;
    await page.waitForTimeout(3_000);
  }
  return page.goto(url, { waitUntil: "load", timeout: 240_000 });
}

async function dismissModals(page: Page) {
  await page.locator('[aria-labelledby="whats-new-title"] button[aria-label="Закрыть"]').click({ timeout: 2_000 }).catch(() => {});
  const terms = page.getByRole("button", { name: "Принять и продолжить" });
  if (await terms.isVisible().catch(() => false)) {
    await page.locator("div.fixed.inset-0 input[type=checkbox]").first().check().catch(() => {});
    await terms.click().catch(() => {});
    await terms.waitFor({ state: "hidden", timeout: 15_000 }).catch(() => null);
  }
  // Баннер cookies на публичных страницах закрывает низ экрана.
  await page.getByRole("button", { name: /^(Принять|Понятно|Хорошо|OK|ОК)$/ }).first().click({ timeout: 1_500 }).catch(() => {});
}

async function login(context: BrowserContext, email: string): Promise<Page> {
  const page = await context.newPage();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await goto(page, `${BASE}/login`);
    await page.waitForLoadState("networkidle").catch(() => null);
    await page.fill("#email", email);
    await page.fill("#password", state.password);
    await page.click('button[type="submit"]').catch(() => null);
    const left = await page
      .waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 90_000 })
      .then(() => true)
      .catch(() => false);
    if (left) return page;
  }
  throw new Error(`login failed: ${email}`);
}

async function noHorizontalScroll(page: Page): Promise<{ ok: boolean; sw: number; cw: number }> {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  return { ok: r.sw <= r.cw + 1, ...r };
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableWorker: true } as never).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n";
  }
  return text;
}

async function main() {
  const browser = await chromium.launch({ channel: "chrome" });
  const managerDesk = await browser.newContext({ ...DESKTOP, acceptDownloads: true });
  const anonMob = await browser.newContext(MOBILE);
  const anonDesk = await browser.newContext(DESKTOP);
  try {
    // ---------- AC1: QR в кабинете
    const cab = await login(managerDesk, state.users.manager.email);
    await goto(cab, `${BASE}/settings/inspector-portal`);
    await cab.waitForSelector("[data-inspector-qr-card]", { timeout: 120_000 });
    await dismissModals(cab);
    await cab.screenshot({ path: path.join(SHOTS, "01-cabinet-empty-1280.png"), fullPage: true });
    await cab.click('[data-ttl="7d"]');
    await cab.fill("#qr-label", "Плановая проверка РПН");
    await cab.click("[data-create-qr-submit]");
    await cab.waitForSelector("[data-active-qr]", { timeout: 60_000 });
    const tokenId = (await cab.getAttribute("[data-active-qr]", "data-active-qr")) ?? "";
    const qrUrlRaw = (await cab.inputValue("[data-qr-url]")) ?? "";
    const rawToken = qrUrlRaw.split("/inspector/")[1] ?? "";
    fs.writeFileSync(path.join(HERE, "last-token.txt"), rawToken);
    const qrUrl = `${BASE}/inspector/${rawToken}`;
    const svgOk = (await cab.locator("[data-qr-svg] svg").count()) === 1;
    check("AC1-1", "QR создан в кабинете, есть превью SVG и адрес /inspector/<токен>", Boolean(tokenId) && rawToken.length === 43 && svgOk, { tokenId, qrUrlRaw, svgOk });
    await cab.screenshot({ path: path.join(SHOTS, "02-cabinet-qr-1280.png"), fullPage: true });
    const row = await db.inspectorToken.findUnique({ where: { id: tokenId } });
    check("AC1-2", "Строка токена: открытый период 2099-12-31, окно 12 месяцев, срок 7 дней", Boolean(row) && row!.periodTo.toISOString().startsWith("2099-12-31") && row!.periodFrom.toISOString().slice(0, 10) === `${Number(TODAY.slice(0, 4)) - 1}${TODAY.slice(4)}` && Math.abs(row!.expiresAt.getTime() - Date.now() - 7 * 86400_000) < 3600_000, row);

    // Печать листа A4 — дважды, QR тот же.
    const sheet = await managerDesk.newPage();
    await goto(sheet, `${BASE}/inspector-sheet/${tokenId}`);
    await sheet.waitForSelector("[data-inspector-sheet]", { timeout: 120_000 });
    const sheetUrl1 = (await sheet.textContent("[data-sheet-url]"))?.trim();
    await sheet.screenshot({ path: path.join(SHOTS, "03-print-sheet-screen.png"), fullPage: true });
    await sheet.emulateMedia({ media: "print" });
    await sheet.screenshot({ path: path.join(SHOTS, "04-print-sheet-print.png"), fullPage: true });
    const sheetPdf = await sheet.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
    fs.writeFileSync(path.join(SHOTS, "04-print-sheet.pdf"), sheetPdf);
    const sheetText = await pdfText(new Uint8Array(sheetPdf));
    await sheet.emulateMedia({ media: "screen" });
    await goto(sheet, `${BASE}/inspector-sheet/${tokenId}`);
    const sheetUrl2 = (await sheet.textContent("[data-sheet-url]"))?.trim();
    const sheetPages = (sheetPdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    check("AC1-3", "Лист A4 печатается повторно с тем же QR (1 страница, кириллица в PDF)", sheetUrl1 === qrUrlRaw && sheetUrl2 === qrUrlRaw && sheetPages === 1 && sheetText.includes("Для проверяющих органов") && sheetText.includes("Проверка"), { sheetUrl1, sheetUrl2, sheetPages, sheetText: sheetText.slice(0, 200) });
    await sheet.close();

    // ---------- AC2: скан без входа
    const insp = await anonMob.newPage();
    const landing = await goto(insp, qrUrl);
    await dismissModals(insp);
    const title = await insp.textContent("[data-org-title]").catch(() => null);
    const req = (await insp.textContent("[data-requisites]").catch(() => "")) ?? "";
    check("AC2-1", "Скан открывает страницу без входа и PIN, реквизиты на месте", landing?.status() === 200 && !insp.url().includes("/login") && title?.includes("Проверка") === true && req.includes("7701234567") && req.includes("Соколова") && req.includes("Тверская"), { status: landing?.status(), url: insp.url(), title, req });
    const codes = await insp.$$eval("[data-journal]", (n) => n.map((x) => x.getAttribute("data-journal")));
    check("AC2-2", "Отключённого журнала (fryer_oil) нет в описи, включённые есть", !codes.includes("fryer_oil") && codes.includes("hygiene") && codes.includes("finished_product"), codes);
    const groups = await insp.$$eval("[data-group]", (n) => n.map((x) => x.getAttribute("data-group")));
    check("AC2-3", "Опись сгруппирована: СанПиН / ХАССП / прочие", groups[0] === "sanpin" && groups.length >= 2, groups);
    const hygMonth = (await insp.textContent('[data-journal="hygiene"]')) ?? "";
    check("AC2-4", "Счётчики за период (по умолчанию — месяц)", /\d+ зап\./.test(hygMonth) && /док\./.test(hygMonth), hygMonth);
    const scrollMobLanding = await noHorizontalScroll(insp);
    await insp.screenshot({ path: path.join(SHOTS, "05-landing-390.png"), fullPage: true });
    // Пресеты
    await insp.click('[data-period-picker] a[href$="?p=today"]');
    await insp.waitForURL(/p=today/);
    const hygToday = (await insp.textContent('[data-journal="hygiene"]')) ?? "";
    const todayEntries = Number(/(\d+) зап\./.exec(hygToday)?.[1] ?? 0);
    check("AC2-5", "Пресет «Сегодня» меняет счётчики (2 записи гигиены за день)", todayEntries === 2, hygToday);
    // Свои даты — зажимаются окном
    await goto(insp, `${qrUrl}?p=custom&from=2000-01-01&to=2099-01-01`);
    const fromVal = await insp.inputValue('[data-period-picker] input[name="from"]');
    const toVal = await insp.inputValue('[data-period-picker] input[name="to"]');
    check("AC2-6", "Свои даты зажимаются окном (12 месяцев … сегодня)", fromVal === `${Number(TODAY.slice(0, 4)) - 1}${TODAY.slice(4)}` && toVal === TODAY, { fromVal, toVal });
    const inspDesk = await anonDesk.newPage();
    await goto(inspDesk, `${qrUrl}?p=quarter`);
    await dismissModals(inspDesk);
    const scrollDeskLanding = await noHorizontalScroll(inspDesk);
    await inspDesk.screenshot({ path: path.join(SHOTS, "06-landing-1280.png"), fullPage: true });

    // Кто смотрит
    await insp.fill("#wsi-viewer", "Иванова А. П., специалист-эксперт");
    await insp.click('[data-viewer-form] button[type="submit"]');
    await insp.getByText("Отмечено.").waitFor({ timeout: 30_000 });
    check("AC5-1", "«Кто смотрит» сохраняется", true);

    // ---------- AC3/AC4: журнал листами
    await goto(insp, `${qrUrl}/hygiene?p=quarter`);
    await insp.waitForSelector("[data-document]", { timeout: 240_000 });
    const docIds = await insp.$$eval("[data-document]", (n) => n.map((x) => x.getAttribute("data-document")));
    await insp.waitForFunction(() => Array.from(document.querySelectorAll("[data-sheet] img")).slice(0, 2).every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0), null, { timeout: 240_000 }).catch(() => null);
    // Листы lazy — прокручиваем, чтобы подгрузились все.
    await insp.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 600) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
      }
    });
    await insp.waitForFunction(() => Array.from(document.querySelectorAll("[data-sheet] img")).every((i) => (i as HTMLImageElement).complete), null, { timeout: 240_000 }).catch(() => null);
    const imgs = await insp.$$eval("[data-sheet] img", (n) => n.map((i) => ({ w: (i as HTMLImageElement).naturalWidth, src: (i as HTMLImageElement).getAttribute("src") })));
    check("AC3-1", "Журнал открывается листами печатной формы (PNG загружены)", docIds.includes(state.docs.hygieneCur) && docIds.includes(state.docs.hygienePrev) && !docIds.includes(state.docs.outOfWindow) && imgs.length >= 2 && imgs.every((i) => i.w >= 1000), { docIds, bad: imgs.filter((i) => i.w < 1000), total: imgs.length });
    const marks = await insp.$$eval("[data-electronic-mark]", (n) => n.map((x) => x.textContent ?? ""));
    const codesOnPage = await insp.$$eval("[data-control-code]", (n) => n.map((x) => x.textContent?.trim()));
    check("AC4-1", "После листов — электронная отметка с контрольным кодом, без печати организации", marks.length === docIds.length && marks.every((t) => t.includes("ДОКУМЕНТ СФОРМИРОВАН В ЭЛЕКТРОННОМ ВИДЕ") && t.includes("не печать организации")) && codesOnPage.every((c) => /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(c ?? "")), { codesOnPage });
    const scrollMobJournal = await noHorizontalScroll(insp);
    await insp.evaluate(() => window.scrollTo(0, 0));
    await insp.screenshot({ path: path.join(SHOTS, "07-journal-390.png"), fullPage: false });
    await insp.locator("[data-electronic-mark]").first().scrollIntoViewIfNeeded();
    await insp.screenshot({ path: path.join(SHOTS, "08-journal-mark-390.png"), fullPage: false });
    await insp.locator("[data-sheet] a").first().click();
    await insp.waitForSelector('[role="dialog"] img', { timeout: 30_000 });
    await insp.waitForTimeout(800);
    await insp.screenshot({ path: path.join(SHOTS, "09-sheet-zoom-390.png") });
    await insp.keyboard.press("Escape");
    await goto(inspDesk, `${qrUrl}/cold_equipment_control?p=month`);
    if (!(await inspDesk.waitForSelector("[data-sheet] img", { timeout: 120_000 }).catch(() => null))) {
      fs.writeFileSync(path.join(HERE, "cold-fail.html"), await inspDesk.content());
      await goto(inspDesk, `${qrUrl}/cold_equipment_control?p=month`);
      await inspDesk.waitForSelector("[data-sheet] img", { timeout: 240_000 });
    }
    await inspDesk.waitForFunction(() => Array.from(document.querySelectorAll("[data-sheet] img")).slice(0, 1).every((i) => (i as HTMLImageElement).naturalWidth > 0), null, { timeout: 240_000 }).catch(() => null);
    const scrollDeskJournal = await noHorizontalScroll(inspDesk);
    await inspDesk.screenshot({ path: path.join(SHOTS, "10-journal-1280.png"), fullPage: true });
    await goto(inspDesk, `${qrUrl}/finished_product?p=month`);
    await inspDesk.waitForSelector("[data-sheet] img", { timeout: 240_000 });
    await inspDesk.waitForTimeout(1500);
    await inspDesk.screenshot({ path: path.join(SHOTS, "11-brakerage-1280.png"), fullPage: false });

    // PDF документа
    const api = anonMob.request;
    let docPdf = await api.get(`${BASE}/api/inspector/${rawToken}/documents/${state.docs.hygieneCur}/pdf`, { timeout: 240_000 });
    // dev-сервер общий: пока другие правки перекомпилируют маршруты, он
    // может кратко отвечать 404 — одна повторная попытка.
    if (docPdf.status() !== 200) {
      await new Promise((r) => setTimeout(r, 5_000));
      docPdf = await api.get(`${BASE}/api/inspector/${rawToken}/documents/${state.docs.hygieneCur}/pdf`, { timeout: 240_000 });
    }
    const docPdfBody = await docPdf.body();
    const docPdfText = docPdf.status() === 200 ? await pdfText(new Uint8Array(docPdfBody)) : "";
    check("AC3-2", "PDF документа скачивается (та же форма, кириллица)", docPdf.status() === 200 && docPdf.headers()["content-type"] === "application/pdf" && docPdfBody.subarray(0, 4).toString() === "%PDF" && /гигиен/i.test(docPdfText), { status: docPdf.status(), text: docPdfText.slice(0, 160), body: docPdf.status() === 200 ? "" : docPdfBody.toString("utf8").slice(0, 200) });

    const status = async (url: string) => (await api.get(url)).status();
    const s = {
      foreignPdf: state.foreignDoc ? await status(`${BASE}/api/inspector/${rawToken}/documents/${state.foreignDoc}/pdf`) : 404,
      foreignPng: state.foreignDoc ? await status(`${BASE}/api/inspector/${rawToken}/documents/${state.foreignDoc}/pages/1.png`) : 404,
      outPdf: await status(`${BASE}/api/inspector/${rawToken}/documents/${state.docs.outOfWindow}/pdf`),
      outPng: await status(`${BASE}/api/inspector/${rawToken}/documents/${state.docs.outOfWindow}/pages/1.png`),
      disabledPdf: await status(`${BASE}/api/inspector/${rawToken}/documents/${state.docs.disabled}/pdf`),
      disabledPng: await status(`${BASE}/api/inspector/${rawToken}/documents/${state.docs.disabled}/pages/1.png`),
      disabledPage: await status(`${BASE}/inspector/${rawToken}/fryer_oil`),
      badPage: await status(`${BASE}/api/inspector/${rawToken}/documents/${state.docs.hygieneCur}/pages/999.png`),
      badToken: await status(`${BASE}/api/inspector/${"x".repeat(43)}/documents/${state.docs.hygieneCur}/pdf`),
    };
    check("AC3-3", "Чужой документ, вне окна, отключённый журнал, несуществующий лист и токен — 404", Object.values(s).every((v) => v === 404), s);

    // ---------- AC6: сводный PDF и сертификат
    const summary = await api.get(`${BASE}/api/inspector/${rawToken}/pdf?p=quarter`);
    const summaryText = summary.status() === 200 ? await pdfText(new Uint8Array(await summary.body())) : "";
    fs.writeFileSync(path.join(SHOTS, "12-summary.pdf"), await summary.body());
    check("AC6-1", "Сводный PDF с читаемой кириллицей", summary.status() === 200 && summaryText.includes("Гигиенический журнал") && summaryText.includes("Проверка") && summaryText.includes("ДОКУМЕНТ СФОРМИРОВАН В ЭЛЕКТРОННОМ ВИДЕ") && !summaryText.includes("Журнал учета использования фритюрных"), summaryText.slice(0, 300));
    const before = await db.inspectorToken.count({ where: { organizationId: ORG } });
    const from = state.periods.prevMonthFrom;
    const cert1 = await managerDesk.request.get(`${BASE}/api/certificate?from=${from}&to=${TODAY}`, { timeout: 240_000 });
    const afterFirst = await db.inspectorToken.count({ where: { organizationId: ORG } });
    const cert2 = await managerDesk.request.get(`${BASE}/api/certificate?from=${from}&to=${TODAY}`, { timeout: 240_000 });
    const afterSecond = await db.inspectorToken.count({ where: { organizationId: ORG } });
    const certBody = await cert2.body();
    fs.writeFileSync(path.join(SHOTS, "13-certificate.pdf"), certBody);
    const certText = cert2.status() === 200 ? await pdfText(new Uint8Array(certBody)) : "";
    check("AC6-2", "Сертификат с кириллицей и не плодит токены", cert1.status() === 200 && cert2.status() === 200 && certText.includes("СЕРТИФИКАТ") && certText.includes("Кафе «Проверка»") && afterFirst - before <= 1 && afterSecond === afterFirst, { before, afterFirst, afterSecond, certText: certText.slice(0, 200) });

    // ---------- AC5: журнал действий, визиты в кабинете, лимит
    const logs = await db.auditLog.findMany({ where: { organizationId: ORG, entityId: tokenId }, select: { action: true, details: true, userName: true, ipAddress: true } });
    const kinds = new Set(logs.map((l) => (l.details as { kind?: string })?.kind));
    const named = logs.some((l) => (l.userName ?? "").includes("Иванова") && (l.details as { kind?: string })?.kind === "document");
    check("AC5-2", "Каждый просмотр пишется в журнал действий (страница, журнал, документ, PDF, представился)", ["summary_page", "journal_page", "document", "document_pdf", "summary_pdf", "introduce"].every((k) => kinds.has(k)) && named, { kinds: [...kinds], count: logs.length });
    const tokenRow = await db.inspectorToken.findUnique({ where: { id: tokenId }, select: { accessCount: true, lastAccessedAt: true } });
    const visits = await db.inspectorVisit.count({ where: { tokenId } });
    check("AC5-3", "Счётчик просмотров растёт, визит записан", (tokenRow?.accessCount ?? 0) >= 5 && Boolean(tokenRow?.lastAccessedAt) && visits === 1, { tokenRow, visits });
    await goto(cab, `${BASE}/settings/inspector-portal`);
    await cab.waitForSelector("[data-visits]", { timeout: 120_000 });
    const visitRows = await cab.$$eval("[data-visit-row]", (n) => n.map((x) => x.textContent ?? ""));
    check("AC5-4", "Визиты видны в кабинете (время, что открывали, кто)", visitRows.length > 3 && visitRows.some((t) => t.includes("Иванова")) && visitRows.some((t) => t.includes("Просмотрел документ")), visitRows.slice(0, 4));
    await cab.screenshot({ path: path.join(SHOTS, "14-cabinet-visits-1280.png"), fullPage: true });
    const cabMob = await managerDesk.newPage();
    await cabMob.setViewportSize({ width: 390, height: 844 });
    await goto(cabMob, `${BASE}/settings/inspector-portal`);
    await cabMob.waitForSelector("[data-inspector-qr-card]", { timeout: 120_000 });
    const scrollMobCabinet = await noHorizontalScroll(cabMob);
    await cabMob.screenshot({ path: path.join(SHOTS, "15-cabinet-390.png"), fullPage: true });
    await cabMob.close();

    const codesSeen: number[] = [];
    for (let i = 0; i < 26; i += 1) codesSeen.push(await status(`${BASE}/api/inspector/${rawToken}/documents/nonexistent-doc/pdf`));
    check("AC5-5", "Лимит запросов срабатывает (429)", codesSeen.includes(429) && codesSeen[0] === 404, codesSeen);

    // ---------- AC7: вёрстка
    check("AC7-1", "390 и 1280 без горизонтального скролла", [scrollMobLanding, scrollDeskLanding, scrollMobJournal, scrollDeskJournal, scrollMobCabinet].every((r) => r.ok), { scrollMobLanding, scrollDeskLanding, scrollMobJournal, scrollDeskJournal, scrollMobCabinet });

    // ---------- AC1: отзыв
    if (process.env.KEEP) throw new Error("KEEP: стоп перед отзывом");
    await cab.click(`[data-active-qr="${tokenId}"] [data-revoke-qr]`);
    const dialog = cab.locator('[role="dialog"]').filter({ hasText: "Отозвать доступ" });
    await dialog.waitFor({ timeout: 30_000 });
    await dialog.getByRole("button", { name: "Отозвать", exact: true }).click();
    await cab.waitForSelector("[data-active-qr]", { state: "detached", timeout: 60_000 }).catch(() => null);
    await goto(insp, qrUrl);
    const revokedText = (await insp.textContent("h1")) ?? "";
    const revokedApi = await status(`${BASE}/api/inspector/${rawToken}/documents/${state.docs.hygieneCur}/pages/1.png`);
    await insp.screenshot({ path: path.join(SHOTS, "16-revoked-390.png") });
    check("AC1-4", "После «Отозвать» — экран «Доступ отозван», листы 410", revokedText.includes("Доступ отозван") && revokedApi === 410, { revokedText, revokedApi });
  } finally {
    await managerDesk.close().catch(() => null);
    await anonMob.close().catch(() => null);
    await anonDesk.close().catch(() => null);
    await browser.close().catch(() => null);
  }
  fs.writeFileSync(path.join(HERE, "smoke.json"), JSON.stringify(checks, null, 2));
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  fs.writeFileSync(path.join(HERE, "smoke.json"), JSON.stringify([...checks, { id: "CRASH", ok: false, detail: String(err) }], null, 2));
  process.exit(1);
});
