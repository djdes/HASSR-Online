// e2e части B: переключатель «Перейти к журналу» в хлебных крошках —
// поиск, только включённые журналы, «Показать все», легенды, Mini App.
// Стенд: npx tsx .agent/tasks/general-cleaning-qr-switcher-2026-09/e2e/sw-setup.ts
// Запуск (dev на 3020 с wesetup_e2e): npx tsx .agent/tasks/general-cleaning-qr-switcher-2026-09/e2e/sw-switcher-e2e.ts
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";

import { db } from "../../journal-responsibles-org-2026-09/e2e/db";

const BASE = process.env.BASE ?? "http://localhost:3020";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SHOTS = path.join(HERE, "..", "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const state = JSON.parse(fs.readFileSync(path.join(HERE, "sw-state.json"), "utf8"));

const DISABLED_NAMES = [
  "Журнал бракеража скоропортящейся пищевой продукции",
  "Журнал учета использования фритюрных жиров",
  "Журнал контроля изделий из стекла и хрупкого пластика",
];

type Check = { id: string; name: string; ok: boolean; detail?: unknown };
const checks: Check[] = [];
/** Ошибки, в которых замешаны крошки, — наши. */
const errors: string[] = [];
/** Чужие (оболочка Mini App, другие компоненты страницы) — в отчёт, но не в провал. */
const foreignErrors: string[] = [];
const CRUMB_MARKERS = /CrumbNode|Breadcrumbs|CrumbSheetMenu|CrumbDropdownMenu|CrumbSearchInput|JournalPageCrumbs|Хлебные|crumb-menu|breadcrumbs\.tsx/;
function check(id: string, name: string, ok: boolean, detail?: unknown) {
  checks.push({ id, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${id}] ${name}${!ok && detail !== undefined ? ` :: ${JSON.stringify(detail).slice(0, 700)}` : ""}`);
}

/**
 * Расхождение гидрации только в `id`/`aria-controls` вида `radix-…` —
 * сдвиг дерева useId выше по макету (в этих же прогонах так же «плывут» id
 * в шапке кабинета — PartnerHint, меню профиля), а не ошибка крошек.
 */
function isUseIdShiftOnly(text: string): boolean {
  // Строки дерева-диффа идут с глубоким отступом; «- A server/client branch…»
  // из шапки предупреждения — с одним пробелом, их не считаем.
  const changed = text.split("\n").filter((line) => /^[+-]\s{2,}\S/.test(line));
  return changed.length > 0 && changed.every((line) => /^[+-]\s{2,}(id|aria-controls)="radix-/.test(line));
}

function watchErrors(page: Page, tag: string) {
  const record = (text: string) => {
    const entry = `${tag} ${page.url().replace(BASE, "")}: ${text}`;
    if (CRUMB_MARKERS.test(text) && !isUseIdShiftOnly(text)) errors.push(entry.slice(0, 4000));
    else foreignErrors.push((isUseIdShiftOnly(text) ? "[useId-сдвиг выше крошек] " : "") + entry.slice(0, 4000));
  };
  page.on("pageerror", (error) => record(`pageerror: ${error.stack ?? String(error)}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Failed to load resource|telegram\.org|DevTools|favicon|net::ERR/i.test(text)) return;
    record(`console: ${text}`);
  });
}

async function login(context: BrowserContext, email: string) {
  // Значок dev-оверлея Next («Compiling», «N Issues») перекрывает низ листа
  // на скриншотах — прячем только его.
  await context.addInitScript(
    `document.addEventListener("DOMContentLoaded",function(){var s=document.createElement("style");s.textContent="nextjs-portal{display:none!important}";document.head.appendChild(s)})`,
  );
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 600_000 });
  for (let i = 0; i < 30; i += 1) {
    await page.fill("#email", email);
    await page.fill("#password", state.password);
    if ((await page.inputValue("#email")) === email) break;
    await page.waitForTimeout(300);
  }
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 600_000 });
  await page.close();
}

async function dismissOverlays(page: Page) {
  const terms = page.getByRole("button", { name: "Принять и продолжить" });
  if (await terms.isVisible().catch(() => false)) {
    await page.locator("div.fixed.inset-0 input[type=checkbox]").first().check();
    await terms.click();
    await terms.waitFor({ state: "hidden", timeout: 15_000 }).catch(() => null);
  }
  await page
    .locator('[aria-labelledby="whats-new-title"] button[aria-label="Закрыть"]')
    .click({ timeout: 2_000 })
    .catch(() => {});
  const guide = page.locator('[role="dialog"][aria-labelledby="fill-guide-title"]');
  if (await guide.isVisible().catch(() => false)) {
    await guide.getByRole("button", { name: "Понятно" }).first().click().catch(() => null);
  }
}

async function open(page: Page, url: string) {
  await page.goto(`${BASE}${url}`, { waitUntil: "load", timeout: 600_000 });
  await page.locator('nav[aria-label="Хлебные крошки"]').first().waitFor({ timeout: 120_000 });
  await page.waitForTimeout(800);
  await dismissOverlays(page);
}

/**
 * Печать клавишами, как с русской раскладки: у каждой буквы настоящий
 * keydown (key = «ж») и вставка текста. `keyboard.type` шлёт кириллицу
 * одним insertText без keydown, а `keyboard.press("ж")` падает —
 * поэтому CDP, как делает Puppeteer для печатных клавиш.
 */
async function pressText(page: Page, text: string) {
  const cdp = await page.context().newCDPSession(page);
  try {
    for (const ch of text) {
      if (ch === " ") {
        await page.keyboard.press("Space");
        continue;
      }
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, text: ch, unmodifiedText: ch });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
    }
  } finally {
    await cdp.detach().catch(() => null);
  }
}

async function listOf(scope: Locator, input: Locator, rowSelector: string): Promise<Locator> {
  const listId = await input.getAttribute("aria-controls");
  return scope.locator(`[id="${listId}"] ${rowSelector}`);
}

async function rowLabels(rows: Locator): Promise<string[]> {
  const count = await rows.count();
  const labels: string[] = [];
  for (let i = 0; i < count; i += 1) {
    labels.push((await rows.nth(i).locator("span.truncate").first().innerText()).trim());
  }
  return labels;
}

async function isFocused(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => el === document.activeElement).catch(() => false);
}

async function ensureHygieneDocuments(context: BrowserContext): Promise<{ active: string; closed: string }> {
  const template = await db.journalTemplate.findUnique({ where: { code: "hygiene" }, select: { id: true } });
  const existing = await db.journalDocument.findMany({
    where: { organizationId: state.org, templateId: template!.id },
    select: { id: true, status: true },
  });
  let active = existing.find((doc) => doc.status === "active")?.id;
  let closed = existing.find((doc) => doc.status === "closed")?.id;
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const month = (y: number, m: number) => {
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return { dateFrom: `${y}-${pad(m + 1)}-01`, dateTo: `${y}-${pad(m + 1)}-${pad(last)}` };
  };
  const create = async (title: string, bounds: { dateFrom: string; dateTo: string }) => {
    const response = await context.request.post(`${BASE}/api/journal-documents`, {
      data: { templateCode: "hygiene", title, force: true, ...bounds },
      timeout: 600_000,
    });
    const json = await response.json().catch(() => null);
    if (!response.ok() || !json?.document?.id) throw new Error(`create ${title}: ${response.status()} ${JSON.stringify(json)}`);
    return json.document.id as string;
  };
  if (!active) active = await create("Гигиена — текущий месяц", month(now.getUTCFullYear(), now.getUTCMonth()));
  if (!closed) {
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    closed = await create("Гигиена — прошлый месяц", month(prev.getUTCFullYear(), prev.getUTCMonth()));
    await db.journalDocument.update({ where: { id: closed }, data: { status: "closed" } });
  }
  return { active, closed };
}

async function desktop(browser: Browser, docs: { active: string; closed: string }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await login(context, state.users.manager.email);
  const page = await context.newPage();
  watchErrors(page, "desktop-manager");

  const media = await page.evaluate(() => ({
    fine: window.matchMedia("(hover: hover) and (pointer: fine)").matches,
  })).catch(() => null);

  // ── B-1: «Журналы» раскрывается в переключатель ─────────────────────
  await open(page, "/journals/hygiene");
  const journalsCrumb = page.locator('nav[aria-label="Хлебные крошки"] [title="Журналы"]');
  await journalsCrumb.hover();
  const menu = page.locator('[role="menu"]:has(input[type="search"])');
  await menu.waitFor({ timeout: 15_000 });
  const input = menu.locator('input[type="search"]');
  check("B-1", "поле «Найти журнал» над списком", (await input.getAttribute("placeholder")) === "Найти журнал");
  await page.waitForTimeout(250);
  check("B-1", "мышь: фокус сразу в поле поиска", await isFocused(input), { media });
  const rows = await listOf(menu, input, '[role="menuitem"]');
  const labels = await rowLabels(rows);
  const expectedEnabled = (await db.journalTemplate.count({ where: { isActive: true } })) - DISABLED_NAMES.length;
  check("B-1", `в списке только включённые журналы (${expectedEnabled})`, labels.length === expectedEnabled, { count: labels.length });
  check(
    "B-1",
    "выключенных журналов в списке нет",
    DISABLED_NAMES.every((name) => !labels.includes(name)),
    labels.filter((label) => DISABLED_NAMES.includes(label)),
  );
  check("B-1", "заголовок «Перейти к журналу»", (await menu.innerText()).includes("ПЕРЕЙТИ К ЖУРНАЛУ") || (await menu.innerText()).includes("Перейти к журналу"));
  const footer = menu.locator(":scope > div").last();
  const footerText = await footer.innerText();
  const legendText = await footer.locator(':scope > div:not([role="menuitem"])').first().innerText();
  const rowStatuses = await rows.evaluateAll((nodes) =>
    Array.from(new Set(nodes.map((node) => node.querySelector(".sr-only")?.textContent?.replace(/^,\s*/, "") ?? "").filter(Boolean))),
  );
  const legendLabels = legendText.split(/\n+/).map((s) => s.trim()).filter(Boolean).sort();
  check(
    "B-1",
    "легенда — ровно из статусов, что есть в списке (без «выключен»)",
    JSON.stringify(legendLabels) === JSON.stringify([...rowStatuses].sort()) && !legendText.includes("выключен"),
    { legendLabels, rowStatuses },
  );
  check("B-1", "внизу «Показать все» с подсказкой «включая выключенные»", /Показать все/.test(footerText) && footerText.includes("включая выключенные"), footerText);
  await page.screenshot({ path: path.join(SHOTS, "sw-desktop-menu.png") });

  // ── B-2: поиск ────────────────────────────────────────────────────────
  await pressText(page, "журнал гигиен");
  check("B-2", "клавиши с кириллицей остаются в поле (нет «прыжка по букве»)", await isFocused(input));
  check("B-2", "«журнал гигиен» → «Гигиенический журнал» (слова в любом порядке)", JSON.stringify(await rowLabels(rows)) === JSON.stringify(["Гигиенический журнал"]), await rowLabels(rows));
  await page.screenshot({ path: path.join(SHOTS, "sw-desktop-search.png") });
  await input.fill("учёт уф");
  check("B-2", "«учёт уф» → журнал учета УФ (ё = е)", JSON.stringify(await rowLabels(rows)) === JSON.stringify(["Журнал учета работы УФ бактерицидной установки"]), await rowLabels(rows));
  await input.fill("hygiene");
  check("B-2", "поиск по коду журнала", JSON.stringify(await rowLabels(rows)) === JSON.stringify(["Гигиенический журнал"]), await rowLabels(rows));
  await input.fill("бракераж");
  const brakLabels = await rowLabels(rows);
  const menuText = await menu.innerText();
  check("B-2", "«бракераж» → только включённый журнал бракеража", JSON.stringify(brakLabels) === JSON.stringify(["Журнал бракеража готовой пищевой продукции"]), brakLabels);
  check("B-2", "подсказка: выключенный журнал назван", menuText.includes("Выключен в наборе:") && menuText.includes("«Журнал бракеража скоропортящейся пищевой продукции»"), menuText.slice(0, 600));
  check("B-2", "у руководителя в подсказке ссылка «Открыть набор журналов»", await menu.getByRole("button", { name: /Открыть набор журналов/ }).isVisible());
  await page.screenshot({ path: path.join(SHOTS, "sw-desktop-hidden-match.png") });
  await input.fill("фритюр");
  check("B-2", "«фритюр» → пусто: «Ничего не нашлось по «фритюр»»", (await rows.count()) === 0 && (await menu.getByText("Ничего не нашлось по «фритюр»").isVisible()));
  check("B-2", "…и объяснение, что он выключен", (await menu.innerText()).includes("«Журнал учета использования фритюрных жиров»"));
  await page.screenshot({ path: path.join(SHOTS, "sw-desktop-empty.png") });

  await page.mouse.move(1300, 800);
  await page.waitForTimeout(700);
  check("B-2", "с набранным запросом уход мыши меню не закрывает", await menu.isVisible());
  await input.focus();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  check("B-2", "Esc №1 очищает поиск, меню открыто", (await input.inputValue()) === "" && (await menu.isVisible()) && (await rows.count()) === expectedEnabled);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  check("B-2", "Esc №2 закрывает меню", !(await menu.isVisible()));

  await journalsCrumb.hover();
  await menu.waitFor({ timeout: 15_000 });
  await page.waitForTimeout(250);
  await pressText(page, "гигиен");
  await page.keyboard.press("ArrowDown");
  const focusedText = await page.evaluate(() => (document.activeElement?.getAttribute("role") === "menuitem" ? document.activeElement.textContent : null));
  check("B-2", "↓ из поля — на первый пункт", Boolean(focusedText?.startsWith("Гигиенический журнал")), focusedText);
  await page.keyboard.press("ArrowUp");
  check("B-2", "↑ с первого пункта — обратно в поле", await isFocused(input));
  await input.fill("");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("h");
  check("B-2", "буква на пункте списка уходит в поле поиска", (await isFocused(input)) && (await input.inputValue()) === "h", await input.inputValue());
  await input.fill("уф");
  await page.keyboard.press("Enter");
  await page.waitForURL((url) => url.pathname === "/journals/uv_lamp_runtime", { timeout: 600_000 }).catch(() => null);
  check("B-2", "Enter → первое совпадение (/journals/uv_lamp_runtime)", new URL(page.url()).pathname === "/journals/uv_lamp_runtime", page.url());

  // ── B-3: «Показать все», выключенный текущий, крошка журнала ─────────
  // Список документов выключенного журнала — своя заглушка «Этот журнал
  // отключён» без крошек; крошки у него есть на остальных страницах.
  await open(page, "/journals/fryer_oil/guide");
  const journalCrumb = page.locator('nav[aria-label="Хлебные крошки"] [title="Журнал учета использования фритюрных жиров"]');
  await journalCrumb.hover();
  const journalMenu = page.locator('[role="menu"]:has(input[type="search"])');
  await journalMenu.waitFor({ timeout: 15_000 });
  const journalInput = journalMenu.locator('input[type="search"]');
  const journalRows = await listOf(journalMenu, journalInput, '[role="menuitem"]');
  const journalLabels = await rowLabels(journalRows);
  const currentRow = journalRows.filter({ hasText: "Журнал учета использования фритюрных жиров" });
  check("B-3", "звено журнала: тот же поиск «Найти журнал»", (await journalInput.getAttribute("placeholder")) === "Найти журнал");
  check("B-3", "выключенный ТЕКУЩИЙ журнал остаётся в списке", journalLabels.includes("Журнал учета использования фритюрных жиров") && journalLabels.length === expectedEnabled + 1, { count: journalLabels.length });
  check("B-3", "…серый, с подписью «выключен»", (await currentRow.innerText()).includes("выключен"), await currentRow.innerText());
  const journalLegend = await journalMenu
    .locator(":scope > div")
    .last()
    .locator(':scope > div:not([role="menuitem"])')
    .first()
    .innerText();
  check("B-3", "в легенде появился «выключен»", journalLegend.split(/\n+/).map((s) => s.trim()).includes("выключен"), journalLegend);
  await page.screenshot({ path: path.join(SHOTS, "sw-desktop-disabled-current.png") });
  await journalMenu.getByRole("menuitem", { name: /Показать все/ }).click();
  await page.waitForURL((url) => url.pathname === "/settings/journals", { timeout: 600_000 }).catch(() => null);
  check("B-3", "«Показать все» → /settings/journals", new URL(page.url()).pathname === "/settings/journals", page.url());

  // Документ: легенда «открыт / закрыт», не журнальная.
  await open(page, `/journals/hygiene/documents/${docs.active}`);
  const docCrumb = page.locator('nav[aria-label="Хлебные крошки"] [title="Гигиена — текущий месяц"]');
  await docCrumb.hover();
  const docMenu = page.locator('[role="menu"]').filter({ hasText: "Гигиена — прошлый месяц" });
  await docMenu.waitFor({ timeout: 15_000 });
  const docFooter = await docMenu.locator(":scope > div").last().innerText();
  check("B-3", "документы: легенда «открыт / закрыт»", docFooter.includes("открыт") && docFooter.includes("закрыт") && !docFooter.includes("выключен") && !docFooter.includes("заполнен"), docFooter);
  await page.screenshot({ path: path.join(SHOTS, "sw-desktop-document-legend.png") });
  await context.close();
}

async function desktopCook(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await login(context, state.users.cook.email);
  const page = await context.newPage();
  watchErrors(page, "desktop-cook");
  // ── B-4: сотрудник ────────────────────────────────────────────────────
  await open(page, "/journals/hygiene");
  await page.locator('nav[aria-label="Хлебные крошки"] [title="Журналы"]').hover();
  const menu = page.locator('[role="menu"]:has(input[type="search"])');
  await menu.waitFor({ timeout: 15_000 });
  const input = menu.locator('input[type="search"]');
  const rows = await listOf(menu, input, '[role="menuitem"]');
  const labels = await rowLabels(rows);
  check("B-4", "сотрудник: выключенных журналов в списке нет", DISABLED_NAMES.every((name) => !labels.includes(name)) && labels.length > 0, { count: labels.length });
  check("B-4", "сотрудник: «Показать все» нет (страница набора — только руководителю)", !(await menu.innerText()).includes("Показать все"));
  await input.fill("фритюр");
  const text = await menu.innerText();
  check("B-4", "сотрудник: подсказка «Включить может руководитель», без ссылки", text.includes("Включить может руководитель") && !text.includes("Открыть набор журналов"), text.slice(0, 500));
  await page.screenshot({ path: path.join(SHOTS, "sw-desktop-cook.png") });
  await context.close();
}

async function miniApp(browser: Browser, docs: { active: string; closed: string }) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  await login(context, state.users.manager.email);
  // Вход сайта снимает режим оболочки, поэтому куку ставим после него.
  await context.addCookies([{ name: "ws-shell", value: "mini", url: BASE }]);
  const page = await context.newPage();
  watchErrors(page, "mini");

  // ── B-5: Mini App, телефон ────────────────────────────────────────────
  await open(page, "/journals/hygiene");
  const media = await page.evaluate(() => ({
    fine: window.matchMedia("(hover: hover) and (pointer: fine)").matches,
    shell: document.getElementById("mini-root") !== null || document.querySelector(".mini-root") !== null,
  }));
  check("B-5", "страница открыта в оболочке Mini App", media.shell, media);
  const nav = page.locator('nav[aria-label="Хлебные крошки"]');
  const journalsVisible = await nav.locator('[title="Журналы"]').isVisible().catch(() => false);
  const journalCrumb = nav.locator('[title="Гигиенический журнал"]');
  check("B-5", "страница журнала в Mini App: видны «Журналы» и звено журнала", (await journalCrumb.isVisible()) && journalsVisible, { journalsVisible });
  await journalCrumb.tap();
  const sheet = page.getByRole("dialog").filter({ has: page.locator('input[type="search"]') });
  await sheet.waitFor({ timeout: 15_000 });
  await page.waitForTimeout(600);
  const input = sheet.locator('input[type="search"]');
  const rows = await listOf(sheet, input, "button");
  const labels = await rowLabels(rows);
  const expectedEnabled = (await db.journalTemplate.count({ where: { isActive: true } })) - DISABLED_NAMES.length;
  check("B-5", "лист: поиск «Найти журнал» и только включённые журналы", (await input.getAttribute("placeholder")) === "Найти журнал" && labels.length === expectedEnabled && DISABLED_NAMES.every((n) => !labels.includes(n)), { count: labels.length });
  check("B-5", "телефон: фокус в поле сам не ставится (клавиатура не выезжает)", !(await isFocused(input)), media);
  const sheetText = await sheet.innerText();
  const sheetLegend = await sheet.locator("div.flex-wrap").last().innerText();
  check(
    "B-5",
    "подвал листа: легенда (без «выключен») и «Показать все»",
    sheetLegend.includes("ждёт заполнения") && !sheetLegend.includes("выключен") && /Показать все/.test(sheetText),
    { sheetLegend, tail: sheetText.slice(-200) },
  );
  await page.screenshot({ path: path.join(SHOTS, "sw-mini-sheet.png") });

  const boxBefore = await input.boundingBox();
  await input.tap();
  await pressText(page, "бракераж");
  await page.waitForTimeout(500);
  const boxAfter = await input.boundingBox();
  const brak = await rowLabels(rows);
  check("B-5", "лист: «бракераж» → включённый журнал + подсказка про выключенный", JSON.stringify(brak) === JSON.stringify(["Журнал бракеража готовой пищевой продукции"]) && (await sheet.innerText()).includes("Выключен в наборе:"), brak);
  check("B-5", "поле не уезжает, пока список сжимается (высота листа держится)", Boolean(boxBefore && boxAfter && Math.abs(boxBefore.y - boxAfter.y) < 2), { before: boxBefore?.y, after: boxAfter?.y });
  await page.screenshot({ path: path.join(SHOTS, "sw-mini-search.png") });
  await input.fill("фритюр");
  check("B-5", "лист: пустой результат объяснён", (await sheet.getByText("Ничего не нашлось по «фритюр»").isVisible()) && (await sheet.innerText()).includes("«Журнал учета использования фритюрных жиров»"));
  await page.screenshot({ path: path.join(SHOTS, "sw-mini-empty.png") });
  await sheet.getByRole("button", { name: "Очистить поиск" }).tap();
  check("B-5", "крестик очищает поиск", (await input.inputValue()) === "" && (await rows.count()) === expectedEnabled);
  await input.fill("уф");
  await input.press("Enter");
  await page.waitForURL((url) => url.pathname === "/journals/uv_lamp_runtime", { timeout: 600_000 }).catch(() => null);
  check("B-5", "лист: Enter → первое совпадение", new URL(page.url()).pathname === "/journals/uv_lamp_runtime", page.url());

  // Документ в Mini App: звено журнала с поиском, звено документа с легендой документов.
  await open(page, `/journals/hygiene/documents/${docs.active}`);
  const docNav = page.locator('nav[aria-label="Хлебные крошки"]');
  const docJournalsVisible = await docNav.locator('[title="Журналы"]').isVisible().catch(() => false);
  check(
    "B-5",
    "бланк в Mini App: «Журналы» спрятан, переключатель — в звене журнала",
    !docJournalsVisible && (await docNav.locator('[title="Гигиенический журнал"]').isVisible()),
    { docJournalsVisible },
  );
  await docNav.locator('[title="Гигиена — текущий месяц"]').tap();
  const docSheet = page.getByRole("dialog").filter({ hasText: "Документы журнала" });
  await docSheet.waitFor({ timeout: 15_000 });
  await page.waitForTimeout(500);
  const docSheetText = await docSheet.innerText();
  check("B-5", "лист документов: легенда «открыт / закрыт»", docSheetText.includes("открыт") && docSheetText.includes("закрыт") && !docSheetText.includes("ждёт заполнения"), docSheetText.slice(-200));
  await page.screenshot({ path: path.join(SHOTS, "sw-mini-document-legend.png") });
  await docSheet.getByRole("button", { name: "Закрыть" }).tap();
  await page.waitForTimeout(600);
  await docNav.locator('[title="Гигиенический журнал"]').tap();
  const journalSheet = page.getByRole("dialog").filter({ has: page.locator('input[type="search"]') });
  await journalSheet.waitFor({ timeout: 15_000 });
  check("B-5", "на бланке звено журнала тоже с поиском", (await journalSheet.locator('input[type="search"]').getAttribute("placeholder")) === "Найти журнал");
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, "sw-mini-document-journal-sheet.png") });
  await context.close();
}

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const bootstrap = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await login(bootstrap, state.users.manager.email);
    const docs = await ensureHygieneDocuments(bootstrap);
    await bootstrap.close();

    // Сценарии независимы: падение одного не должно прятать результаты остальных.
    for (const [id, run] of [
      ["desktop", () => desktop(browser, docs)],
      ["desktop-cook", () => desktopCook(browser)],
      ["mini", () => miniApp(browser, docs)],
    ] as const) {
      try {
        await run();
      } catch (error) {
        check(id, "сценарий дошёл до конца", false, String(error).slice(0, 1200));
      }
    }
  } catch (error) {
    check("run", "сценарий дошёл до конца", false, String(error).slice(0, 1200));
  } finally {
    await browser.close();
    await db.$disconnect();
  }
  check("run", "без ошибок страницы и консоли, связанных с крошками (в т.ч. гидрации)", errors.length === 0, errors);
  if (foreignErrors.length > 0) console.log(`NOTE чужих ошибок консоли: ${foreignErrors.length} (см. foreignErrors в JSON)`);
  const summary = { pass: checks.filter((c) => c.ok).length, fail: checks.filter((c) => !c.ok).length };
  fs.writeFileSync(
    path.join(HERE, "sw-switcher-e2e.json"),
    JSON.stringify({ at: new Date().toISOString(), base: BASE, summary, checks, errors, foreignErrors }, null, 2),
  );
  console.log(JSON.stringify(summary));
  if (summary.fail > 0) process.exitCode = 1;
}

main();
