/**
 * E2E «Свои названия разделов и журналов» на своей базе (wesetup_wt_blanks)
 * и своём dev-сервере (http://localhost:3043).
 *
 * Запуск (из C:/wt/blanks, dev-сервер уже поднят):
 *   npx tsx .agent/tasks/custom-names-2026-09/e2e/setup.ts > .agent/tasks/custom-names-2026-09/e2e/setup-output.json
 *   npx tsx .agent/tasks/custom-names-2026-09/e2e/names-e2e.ts
 *
 * Пишет результаты проверок в evidence/e2e-results.json и снимки
 * 1440×900 / 390×844 в evidence/.
 */
import "dotenv/config";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";

const BASE = process.env.E2E_BASE ?? "http://localhost:3043";
const TASK_DIR = path.resolve(".agent/tasks/custom-names-2026-09");
const EVIDENCE = path.join(TASK_DIR, "evidence");
const setup = JSON.parse(readFileSync(path.join(TASK_DIR, "e2e/setup-output.json"), "utf8")) as {
  password: string;
  a: { organizationId: string; userId: string; email: string };
  b: { organizationId: string; userId: string; email: string };
  qrCleaningToken: string;
  qrHubToken: string;
};

const CHROME =
  process.env.E2E_CHROME ??
  path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright/chromium-1232/chrome-win64/chrome.exe");

const OFFICIAL_HYGIENE = "Гигиенический журнал (сотрудники)";
const CUSTOM = {
  section: "Документы",
  hygiene: "Гигиена персонала",
  cleaning: "Уборка кухни",
  finished: "Бракераж блюд",
};

type Check = { id: string; ac: string; ok: boolean; detail: string };
const checks: Check[] = [];
function check(id: string, ac: string, ok: boolean, detail: string) {
  checks.push({ id, ac, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${ac}] ${id} — ${detail}`);
}

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const NAV_TIMEOUT = 240_000;

const consoleErrors: string[] = [];
function watchConsole(page: Page, label: string) {
  const where = () => page.url().replace(BASE, "");
  page.on("pageerror", (error) =>
    consoleErrors.push(`${label} ${where()} pageerror: ${(error.stack ?? error.message).slice(0, 600)}`)
  );
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // У предупреждения гидратации важна не шапка, а строки «- / +» — какой атрибут не совпал.
    const diff = text
      .split("\n")
      .filter((line) => /^\s*[-+]\s/.test(line))
      .slice(0, 6)
      .map((line) => line.trim())
      .join(" | ");
    consoleErrors.push(`${label} ${where()} console: ${text.slice(0, 160)}${diff ? ` [diff: ${diff.slice(0, 400)}]` : ""}`);
  });
}

/** Снимок экрана. По умолчанию курсор уводится в пустое поле слева —
 *  иначе выпадающее меню шапки, открытое наведением, закрывает страницу. */
async function shot(page: Page, name: string, options: { keepHover?: boolean } = {}) {
  if (!options.keepHover) {
    await page.mouse.move(4, 420);
    await page.waitForTimeout(350);
  }
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  // Значок dev-сервера Next.js (есть только в dev) закрывал низ кадра.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }).catch(() => {});
  await page.waitForTimeout(300);
  const file = path.join(EVIDENCE, name);
  await page.screenshot({ path: file, animations: "disabled" });
  const size = statSync(file).size;
  check(`shot:${name}`, "AC5", size > 15_000, `${name} — ${Math.round(size / 1024)} КБ`);
}

async function go(page: Page, url: string) {
  const res = await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  return res;
}

async function login(context: BrowserContext, email: string) {
  const res = await context.request.post(`${BASE}/api/auth/login`, {
    data: { email, password: setup.password },
    timeout: NAV_TIMEOUT,
  });
  if (!res.ok()) throw new Error(`login ${email}: ${res.status()} ${await res.text()}`);
}

async function text(page: Page, selector = "body"): Promise<string> {
  return (await page.locator(selector).first().innerText({ timeout: 30_000 })).replace(/\s+/g, " ");
}

/**
 * Окно «Инструкция» само открывается при первом заходе в журнал и в
 * документ. В нём тоже своё название журнала: проверяем и закрываем,
 * чтобы оно не закрывало кадр.
 */
async function closeGuide(page: Page, where: string, expected: string) {
  const guide = page.getByRole("dialog").first();
  await guide.waitFor({ state: "visible", timeout: 4_000 }).catch(() => {});
  if (!(await guide.isVisible().catch(() => false))) return;
  const guideText = (await guide.innerText()).replace(/\s+/g, " ");
  check(`guide-dialog:${where}`, "AC2", guideText.includes(expected), `окно «Инструкция» (${where}): ${guideText.slice(0, 60)}`);
  await page.keyboard.press("Escape");
  await guide.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
}

async function pdfText(bytes: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerFileUrl();
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: false,
    standardFontDataUrl: standardFontsDir(),
  } as Parameters<typeof pdfjs.getDocument>[0]);
  try {
    const doc = await task.promise;
    const parts: string[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const content = await (await doc.getPage(n)).getTextContent();
      parts.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
    }
    return parts.join(" ").replace(/\s+/g, " ");
  } finally {
    await task.destroy();
  }
}

async function main() {
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  if (!String(process.env.DATABASE_URL).includes("wesetup_wt_blanks")) throw new Error("Только своя база");
  const browser: Browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    // ---------------------------------------------------------------- A: вход
    const ctxA = await browser.newContext({ viewport: DESKTOP, locale: "ru-RU" });
    await login(ctxA, setup.a.email);
    const pageA = await ctxA.newPage();
    watchConsole(pageA, "A");

    // Документ гигиены на текущий месяц — для страницы документа и PDF.
    const created = await ctxA.request.post(`${BASE}/api/journal-documents`, {
      data: {
        templateCode: "hygiene",
        title: `${OFFICIAL_HYGIENE} — сентябрь 2026`,
        dateFrom: "2026-09-01",
        dateTo: "2026-09-30",
      },
      timeout: NAV_TIMEOUT,
    });
    const docA = ((await created.json()) as { document?: { id: string } }).document?.id ?? "";
    check("doc-created", "setup", created.status() === 201 && Boolean(docA), `POST /api/journal-documents → ${created.status()}`);

    // ------------------------------------------------ AC1: страница «Названия»
    await go(pageA, "/settings/names");
    await pageA.getByRole("heading", { name: "Названия" }).waitFor({ timeout: 60_000 });
    const namesText = await text(pageA);
    check(
      "names-page-lists",
      "AC1",
      namesText.includes("Разделы меню") && namesText.includes("Журналы") && namesText.includes(OFFICIAL_HYGIENE),
      "страница показывает «Разделы меню», «Журналы» и официальные названия серым"
    );

    await pageA.locator("#custom-name-journal-hygiene").fill("Г");
    const tooShort = await pageA.getByText("От 2 до 80 символов").first().isVisible();
    const saveDisabledOnError = await pageA.getByRole("button", { name: "Сохранить" }).isDisabled().catch(() => false);
    check("names-validation", "AC1", tooShort, `1 символ → «От 2 до 80 символов» (кнопка disabled=${saveDisabledOnError})`);

    await pageA.locator("#custom-name-section-journals").fill(`  ${CUSTOM.section}  `);
    await pageA.locator("#custom-name-journal-hygiene").fill(CUSTOM.hygiene);
    await pageA.locator("#custom-name-journal-cleaning").fill(CUSTOM.cleaning);
    await pageA.locator("#custom-name-journal-finished_product").fill(CUSTOM.finished);
    // Поиск по журналам находит и по своему, и по официальному.
    await pageA.getByLabel("Найти журнал").fill("персонала");
    const byCustom = await pageA.locator("#custom-name-journal-hygiene").isVisible();
    await pageA.getByLabel("Найти журнал").fill("гигиенический");
    const byOfficial = await pageA.locator("#custom-name-journal-hygiene").isVisible();
    await pageA.getByLabel("Найти журнал").fill("");
    check("names-search", "AC1", byCustom && byOfficial, `поиск: по своему=${byCustom}, по официальному=${byOfficial}`);

    const counter = await text(pageA, "div.sticky");
    check("names-dirty-counter", "AC1", /Изменено: 4/.test(counter), `липкая панель: «${counter.trim()}»`);
    await pageA.evaluate(() => window.scrollTo(0, 0));
    await shot(pageA, "01-settings-names-filled-1440.png");

    const [saveRes] = await Promise.all([
      pageA.waitForResponse((r) => r.url().includes("/api/settings/custom-names") && r.request().method() === "PUT", { timeout: NAV_TIMEOUT }),
      pageA.getByRole("button", { name: "Сохранить" }).click(),
    ]);
    const saveBody = (await saveRes.json()) as { names?: unknown; changed?: number };
    check("names-save-api", "AC1", saveRes.status() === 200 && saveBody.changed === 4, `PUT → ${saveRes.status()}, changed=${saveBody.changed}`);
    await pageA.getByText(/Сохранено: 4 названия/).first().waitFor({ timeout: 30_000 }).catch(() => {});

    const stored = await db.query(`select "customNamesJson" from "Organization" where id = $1`, [setup.a.organizationId]);
    const storedJson = stored.rows[0]?.customNamesJson;
    check(
      "names-stored",
      "AC1",
      JSON.stringify(storedJson) ===
        JSON.stringify({
          journals: { hygiene: CUSTOM.hygiene, cleaning: CUSTOM.cleaning, finished_product: CUSTOM.finished },
          sections: { journals: CUSTOM.section },
        }),
      `Organization.customNamesJson = ${JSON.stringify(storedJson)}`
    );

    // Телефон: та же страница после сохранения.
    await pageA.setViewportSize(PHONE);
    await go(pageA, "/settings/names");
    await pageA.locator("#custom-name-journal-hygiene").waitFor({ timeout: 60_000 });
    const phoneValue = await pageA.locator("#custom-name-journal-hygiene").inputValue();
    check("names-phone", "AC1", phoneValue === CUSTOM.hygiene, `390px: поле «${phoneValue}»`);
    await pageA.locator("#custom-name-journal-hygiene").scrollIntoViewIfNeeded();
    await shot(pageA, "02-settings-names-390.png");
    await pageA.setViewportSize(DESKTOP);

    // ------------------------------------------------ AC2: меню и главная
    await go(pageA, "/dashboard");
    await pageA.getByText(CUSTOM.hygiene).first().waitFor({ timeout: 90_000 });
    const dashText = await text(pageA);
    check("dashboard-card", "AC2", dashText.includes(CUSTOM.hygiene) && !dashText.includes(OFFICIAL_HYGIENE), "«Обязательные журналы»: своё название, официального в карточках нет");
    const menuLinks = await pageA.locator('header [role="menu"] a').allTextContents();
    check("menu-section", "AC2", menuLinks.some((t) => t.trim() === CUSTOM.section), `меню шапки: ${menuLinks.map((t) => t.trim()).join(" | ")}`);
    await pageA.locator("header .group\\/nav").first().hover();
    await pageA.waitForTimeout(400);
    await shot(pageA, "03-dashboard-menu-1440.png", { keepHover: true });

    // Поиск на главной — по официальному названию тоже.
    await pageA.getByPlaceholder(/Найти/).first().fill("гигиенический").catch(() => {});
    await pageA.waitForTimeout(500);
    const dashSearch = await text(pageA, "main");
    check("dashboard-search-official", "AC2", dashSearch.includes(CUSTOM.hygiene), "поиск на главной по «гигиенический» находит «Гигиена персонала»");

    // ------------------------------------------------ AC2: список журналов
    await go(pageA, "/journals");
    await pageA.getByRole("heading", { name: CUSTOM.section, exact: true }).first().waitFor({ timeout: 90_000 });
    const listText = await text(pageA, "main");
    const cardTitle = await pageA.getByText(CUSTOM.hygiene, { exact: true }).first().getAttribute("title");
    check(
      "journals-list",
      "AC2",
      listText.includes(CUSTOM.hygiene) && listText.includes(CUSTOM.cleaning) && cardTitle === `Официальное название: ${OFFICIAL_HYGIENE}`,
      `H1 «${CUSTOM.section}», карточки со своими названиями, подсказка: «${cardTitle}»`
    );
    await shot(pageA, "04-journals-list-1440.png");

    // ------------------------------------------------ AC2: страница журнала
    await go(pageA, "/journals/hygiene");
    const h1 = pageA.locator("h1").first();
    await h1.waitFor({ timeout: 90_000 });
    const h1Text = (await h1.innerText()).replace(/\s+/g, " ");
    const crumbs = await text(pageA, "nav[aria-label]").catch(() => "");
    check(
      "journal-page-heading",
      "AC2",
      h1Text.includes(CUSTOM.hygiene) && h1Text.includes(`Официальное название: ${OFFICIAL_HYGIENE}`),
      `H1: «${h1Text}»; крошки: «${crumbs}»`
    );
    await closeGuide(pageA, "журнал", CUSTOM.hygiene);
    await shot(pageA, "05-journal-page-1440.png");

    // ------------------------------------------------ AC2: страница документа
    await go(pageA, `/journals/hygiene/documents/${docA}`);
    const note = pageA.locator("[data-official-name]").first();
    await note.waitFor({ timeout: 120_000 });
    const noteText = (await note.innerText()).replace(/\s+/g, " ");
    const docCrumbs = await text(pageA, "nav[aria-label]").catch(() => "");
    check(
      "document-note",
      "AC2",
      noteText.includes(CUSTOM.hygiene) && noteText.includes(`Официальное название: ${OFFICIAL_HYGIENE}`) && docCrumbs.includes(CUSTOM.hygiene) && docCrumbs.includes(CUSTOM.section),
      `подсказка: «${noteText}»; крошки: «${docCrumbs}»`
    );
    const paperTitle = await pageA.getByText("ГИГИЕНИЧЕСКИЙ ЖУРНАЛ").first().isVisible().catch(() => false);
    check("document-paper-official", "AC3", paperTitle, "бумажная шапка бланка на экране — официальная («ГИГИЕНИЧЕСКИЙ ЖУРНАЛ»)");
    await closeGuide(pageA, "документ", CUSTOM.hygiene);
    await shot(pageA, "06-document-1440.png");
    await pageA.setViewportSize(PHONE);
    await go(pageA, `/journals/hygiene/documents/${docA}`);
    await pageA.locator("[data-official-name]").first().waitFor({ timeout: 120_000 });
    await closeGuide(pageA, "документ 390", CUSTOM.hygiene);
    await shot(pageA, "07-document-390.png");
    await pageA.setViewportSize(DESKTOP);

    // ------------------------------------------------ поиск (⌘K / API)
    const searchCustom = (await (await ctxA.request.get(`${BASE}/api/search?q=${encodeURIComponent("гигиена персонала")}`, { timeout: NAV_TIMEOUT })).json()) as { hits: Array<{ kind: string; label: string; hint?: string }> };
    const searchOfficial = (await (await ctxA.request.get(`${BASE}/api/search?q=${encodeURIComponent("гигиенический")}`, { timeout: NAV_TIMEOUT })).json()) as { hits: Array<{ kind: string; label: string; hint?: string }> };
    const hitCustom = searchCustom.hits.find((h) => h.kind === "template");
    const hitOfficial = searchOfficial.hits.find((h) => h.kind === "template");
    check(
      "search-both-names",
      "AC2",
      hitCustom?.label === CUSTOM.hygiene && hitOfficial?.label === CUSTOM.hygiene && Boolean(hitOfficial?.hint?.includes(OFFICIAL_HYGIENE)),
      `«гигиена персонала» → ${JSON.stringify(hitCustom)}; «гигиенический» → ${JSON.stringify(hitOfficial)}`
    );

    // ------------------------------------------------ AC2: QR-страница заполнения
    const ctxQr = await browser.newContext({ viewport: PHONE, locale: "ru-RU", isMobile: true, hasTouch: true });
    const pageQr = await ctxQr.newPage();
    watchConsole(pageQr, "QR");
    await go(pageQr, `/journal-fill/${setup.a.organizationId}/cleaning?token=${encodeURIComponent(setup.qrCleaningToken)}`);
    const qrH1 = (await pageQr.locator("h1").first().innerText({ timeout: 60_000 })).trim();
    check("qr-title", "AC2", qrH1 === CUSTOM.cleaning, `QR-форма уборки: H1 «${qrH1}»`);
    await shot(pageQr, "08-qr-fill-390.png");
    await go(pageQr, `/journal-fill/${setup.a.organizationId}/all?token=${encodeURIComponent(setup.qrHubToken)}`);
    const hubText = await text(pageQr);
    check("qr-hub", "AC2", hubText.includes(`${CUSTOM.hygiene} — отметка перед сменой`) || hubText.includes(CUSTOM.cleaning), `хаб QR: ${hubText.slice(0, 220)}`);
    await ctxQr.close();

    // ------------------------------------------------ AC2: мини-приложение
    const ctxMini = await browser.newContext({ viewport: PHONE, locale: "ru-RU", isMobile: true, hasTouch: true });
    await login(ctxMini, setup.a.email);
    await ctxMini.addCookies([{ name: "ws-shell", value: "mini", url: BASE }]);
    const pageMini = await ctxMini.newPage();
    watchConsole(pageMini, "mini");
    await go(pageMini, "/journals");
    await pageMini.getByText(CUSTOM.hygiene).first().waitFor({ timeout: 90_000 });
    const miniText = await text(pageMini);
    const navText = await text(pageMini, "nav").catch(() => "");
    const miniTitle = (await pageMini.locator(".mini-display-bold.truncate").first().innerText().catch(() => "")).trim();
    check(
      "mini-journals",
      "AC2",
      miniText.includes(CUSTOM.hygiene) && miniText.includes(CUSTOM.section) && miniTitle === CUSTOM.section,
      `мини: список со своими названиями; верхняя строка «${miniTitle}»; меню: «${navText}»`
    );
    await shot(pageMini, "09-mini-journals-390.png");
    await go(pageMini, "/mini/sections");
    const sectionsText = await text(pageMini);
    check("mini-sections", "AC2", sectionsText.includes(CUSTOM.section), "«Разделы» мини-приложения — своё название раздела");
    const today = await ctxMini.request.get(`${BASE}/api/mini/today`, { timeout: NAV_TIMEOUT });
    const todayJson = (await today.json()) as { groups?: Array<{ code: string; label: string }> };
    const hygieneGroup = todayJson.groups?.find((g) => g.code === "hygiene");
    check(
      "mini-today",
      "AC2",
      !hygieneGroup || hygieneGroup.label === CUSTOM.hygiene,
      `«Сегодня»: ${hygieneGroup ? `группа гигиены «${hygieneGroup.label}»` : "задач гигиены на сегодня нет"}; группы: ${JSON.stringify(todayJson.groups?.map((g) => g.label) ?? [])}`
    );
    await ctxMini.close();

    // ------------------------------------------------ AC3: печать и проверяющий
    const pdf = await ctxA.request.get(`${BASE}/api/journal-documents/${docA}/pdf`, { timeout: NAV_TIMEOUT });
    const pdfBytes = Buffer.from(await pdf.body());
    const pdfContent = await pdfText(pdfBytes);
    check(
      "pdf-official",
      "AC3",
      pdf.status() === 200 && /ГИГИЕНИЧЕСКИЙ ЖУРНАЛ/i.test(pdfContent) && !pdfContent.includes(CUSTOM.hygiene),
      `PDF ${pdf.status()}, ${pdfBytes.length} байт; «Гигиенический журнал» есть: ${/ГИГИЕНИЧЕСКИЙ ЖУРНАЛ/i.test(pdfContent)}; своего нет: ${!pdfContent.includes(CUSTOM.hygiene)}`
    );

    const tokenRes = await ctxA.request.post(`${BASE}/api/settings/inspector-tokens`, {
      data: { label: "e2e названия", periodFrom: "2026-09-01", periodTo: "2026-09-30", ttlHours: 24 },
      timeout: NAV_TIMEOUT,
    });
    const rawToken = ((await tokenRes.json()) as { rawToken?: string }).rawToken ?? "";
    const ctxInspector = await browser.newContext({ viewport: DESKTOP, locale: "ru-RU" });
    const pageInspector = await ctxInspector.newPage();
    await go(pageInspector, `/inspector/${rawToken}`);
    await pageInspector.getByText(OFFICIAL_HYGIENE).first().waitFor({ timeout: 90_000 }).catch(() => {});
    const inspectorText = await text(pageInspector);
    check(
      "inspector-official",
      "AC3",
      tokenRes.ok() && inspectorText.includes(OFFICIAL_HYGIENE) && !inspectorText.includes(CUSTOM.hygiene) && !inspectorText.includes(CUSTOM.cleaning),
      `проверяющий: официальное есть=${inspectorText.includes(OFFICIAL_HYGIENE)}, своих нет=${!inspectorText.includes(CUSTOM.hygiene)}`
    );
    await shot(pageInspector, "10-inspector-1440.png");
    await ctxInspector.close();

    // ------------------------------------------------ AC4: другая организация
    const ctxB = await browser.newContext({ viewport: DESKTOP, locale: "ru-RU" });
    await login(ctxB, setup.b.email);
    const pageB = await ctxB.newPage();
    watchConsole(pageB, "B");
    await go(pageB, "/journals");
    await pageB.getByRole("heading", { name: "Журналы", exact: true }).first().waitFor({ timeout: 90_000 });
    const bText = await text(pageB);
    const bMenu = await pageB.locator('header [role="menu"] a').allTextContents();
    check(
      "org-b-standard",
      "AC4",
      bText.includes(OFFICIAL_HYGIENE) && !bText.includes(CUSTOM.hygiene) && !bText.includes(CUSTOM.cleaning) && bMenu.some((t) => t.trim() === "Журналы"),
      `организация B: «Журналы», официальные названия; меню: ${bMenu.map((t) => t.trim()).join(" | ")}`
    );
    await shot(pageB, "11-org-b-journals-1440.png");
    const bSearch = (await (await ctxB.request.get(`${BASE}/api/search?q=${encodeURIComponent("гигиена персонала")}`, { timeout: NAV_TIMEOUT })).json()) as { hits: Array<{ kind: string }> };
    check("org-b-search", "AC4", !bSearch.hits.some((h) => h.kind === "template"), "поиск B по «гигиена персонала» — журналов нет (чужое название)");
    const bStored = await db.query(`select "customNamesJson" from "Organization" where id = $1`, [setup.b.organizationId]);
    check("org-b-db", "AC4", JSON.stringify(bStored.rows[0]?.customNamesJson) === "{}", `B.customNamesJson = ${JSON.stringify(bStored.rows[0]?.customNamesJson)}`);
    await ctxB.close();

    // ------------------------------------------------ AC1: «Вернуть стандартное» + аудит
    await go(pageA, "/settings/names");
    const resetRow = pageA.locator("li", { has: pageA.locator("#custom-name-journal-cleaning") });
    const resetButton = resetRow.getByRole("button", { name: "Вернуть стандартное" });
    // Строка может оказаться под липкой панелью сохранения — ставим её в центр.
    await resetButton.evaluate((element) => element.scrollIntoView({ block: "center" }));
    // На dev-сервере страница может ещё гидратироваться: до этого у кнопки
    // нет обработчика. Повторяем нажатие, пока поле не опустеет.
    const cleaningInput = pageA.locator("#custom-name-journal-cleaning");
    for (let attempt = 0; attempt < 15; attempt += 1) {
      if (await resetButton.isVisible().catch(() => false)) await resetButton.click().catch(() => {});
      if ((await cleaningInput.inputValue()) === "") break;
      await pageA.waitForTimeout(1_000);
    }
    const afterReset = await cleaningInput.inputValue();
    check("names-reset-field", "AC1", afterReset === "", `«Вернуть стандартное» очистило поле: «${afterReset}»`);
    const [resetRes] = await Promise.all([
      pageA.waitForResponse((r) => r.url().includes("/api/settings/custom-names") && r.request().method() === "PUT", { timeout: NAV_TIMEOUT }),
      pageA.getByRole("button", { name: "Сохранить" }).click(),
    ]);
    const resetBody = (await resetRes.json()) as { names?: { journals?: Record<string, string> }; changed?: number };
    check(
      "names-reset",
      "AC1",
      resetRes.status() === 200 && resetBody.changed === 1 && !resetBody.names?.journals?.cleaning,
      `«Вернуть стандартное» у уборки → ${resetRes.status()}, changed=${resetBody.changed}`
    );
    const audit = await db.query(
      `select action, "userName", details, "createdAt" from "AuditLog" where "organizationId" = $1 and action = 'settings.custom_names.update' order by "createdAt"`,
      [setup.a.organizationId]
    );
    const auditRows = audit.rows as Array<{ action: string; userName: string; details: Record<string, unknown> }>;
    check(
      "audit",
      "AC1",
      // jsonb хранит ключи в своём порядке — сравниваем поля, а не строку.
      auditRows.length === 2 &&
        (auditRows[1].details["Журнал «Журнал уборки»"] as { from?: string } | undefined)?.from === CUSTOM.cleaning &&
        (auditRows[1].details["Журнал «Журнал уборки»"] as { to?: string } | undefined)?.to === "стандартное" &&
        auditRows[0].details.count === 4,
      `AuditLog: ${JSON.stringify(auditRows.map((r) => ({ user: r.userName, details: r.details })))}`
    );
    await go(pageA, "/settings/audit");
    await pageA.getByText("Названия разделов и журналов изменены").first().waitFor({ timeout: 90_000 }).catch(() => {});
    const auditPage = await text(pageA);
    check("audit-page", "AC1", auditPage.includes("Названия разделов и журналов изменены"), "«Журнал действий» показывает запись по-русски");
    await ctxA.close();
  } catch (error) {
    // Падение шага — тоже результат: записываем и идём к отчёту.
    const message = error instanceof Error ? error.message : String(error);
    check("run", "e2e", false, message.split(/\r?\n/)[0]);
  } finally {
    await browser.close();
    await db.end();
  }

  const failed = checks.filter((c) => !c.ok);
  writeFileSync(
    path.join(EVIDENCE, "e2e-results.json"),
    JSON.stringify(
      { base: BASE, at: new Date().toISOString(), passed: checks.length - failed.length, total: checks.length, checks, consoleErrors },
      null,
      2
    )
  );
  console.log(`console errors: ${consoleErrors.length}`);
  for (const line of consoleErrors.slice(0, 20)) console.log(`  ${line}`);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
