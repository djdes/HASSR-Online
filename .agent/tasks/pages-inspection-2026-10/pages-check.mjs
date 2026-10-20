// Проверка раздела «Пришла проверка» в браузере (pages-inspection-2026-10).
// Запуск из корня worktree: node .agent/tasks/pages-inspection-2026-10/pages-check.mjs [base] [part]
//   part: owner | phone | mini | headchef | cook | all (по умолчанию all)
// Скриншоты и results-<part>.json — в raw/ и копия в pages-shots\inspection.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { PDFDocument, StandardFonts } from "pdf-lib";

const BASE = process.argv[2] || "http://localhost:3076";
const PART = process.argv[3] || "all";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(HERE, "raw");
const SHOTS = "C:\\Users\\Two\\wesetup-backup-2026-10-17\\pages-shots\\inspection";
fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

const PASSWORD = "admin1234";
const OWNER = "admin@haccp.local";
const HEAD_CHEF = "chef@haccp.local";
const COOK = "hotcook1@haccp.local";
const ALL_ITEMS = ["now", "visits", "norms", "portal", "readiness", "experts", "special"];
const HEAD_CHEF_ITEMS = ["now", "visits", "norms", "portal", "experts", "special"];
const PAGES = [
  { id: "now", href: "/inspection" },
  { id: "visits", href: "/inspection/visits" },
  { id: "norms", href: "/inspection/norms" },
  { id: "experts", href: "/inspection/experts" },
  { id: "special", href: "/inspection/special-mode" },
];
// Своё имя на каждый прогон: база одна, записи не удаляются.
const VISITOR = `Проверкина Ольга Е2Е-${Date.now().toString(36).slice(-4)}`;

async function launch() {
  try {
    return await chromium.launch({ channel: "chrome", args: ["--lang=ru-RU"] });
  } catch {
    const base = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
    for (const dir of fs.existsSync(base) ? fs.readdirSync(base).sort().reverse() : []) {
      const exe = dir.startsWith("chromium_headless_shell")
        ? path.join(base, dir, "chrome-headless-shell-win64", "chrome-headless-shell.exe")
        : path.join(base, dir, "chrome-win64", "chrome.exe");
      if (fs.existsSync(exe)) return chromium.launch({ executablePath: exe, args: ["--lang=ru-RU"] });
    }
    throw new Error("no browser");
  }
}

const results = { base: BASE, part: PART, startedAt: new Date().toISOString(), checks: [] };
const problems = [];
function check(name, ok, detail = null) {
  results.checks.push({ name, ok: Boolean(ok), detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail !== null ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
  if (!ok) problems.push(name);
}

async function shot(page, name, fullPage = true) {
  const file = path.join(RAW, `${name}.png`);
  await page.screenshot({ path: file, fullPage });
  fs.copyFileSync(file, path.join(SHOTS, `${name}.png`));
}

function watchErrors(page, tag) {
  page.on("pageerror", (error) => check(`${tag}: нет pageerror (${page.url()})`, false, error.message.slice(0, 200)));
}

// Ограничитель переходов: не чаще раза в 2,6 с, на 429 — ждать Retry-After.
let lastNavigation = 0;
async function throttle() {
  const wait = lastNavigation + 2_600 - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastNavigation = Date.now();
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  const terms = page.locator("div.fixed").filter({ hasText: "Мы обновили условия" }).last();
  if (await terms.isVisible().catch(() => false)) {
    await terms.locator('input[type="checkbox"]').first().check().catch(() => {});
    await terms.getByRole("button", { name: "Принять и продолжить" }).click().catch(() => {});
    await page.waitForTimeout(1_500);
  }
  for (let i = 0; i < 2; i++) {
    const dialog = page.locator('[role="dialog"]').first();
    if (await dialog.isVisible().catch(() => false)) {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(300);
    }
  }
  await page.waitForTimeout(500);
}

async function goto(page, href) {
  let response = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    await throttle();
    response = await page.goto(`${BASE}${href}`, { waitUntil: "domcontentloaded", timeout: 600_000 });
    if (response?.status() !== 429) break;
    const retryAfter = Number(response.headers()["retry-after"] || 30);
    console.log(`  … 429 на ${href}, пауза ${retryAfter} с`);
    await new Promise((resolve) => setTimeout(resolve, (retryAfter + 1) * 1000));
  }
  await settle(page);
  return response;
}

/**
 * Переход по пункту меню (клик), с тем же ограничителем. Dev-сервер под
 * нагрузкой иногда «теряет» клиентский переход во время перекомпиляции —
 * тогда ещё один клик (повтор записывается в results.menuRetries).
 */
async function clickMenu(page, scope, id, expectPath) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await throttle();
    await page.locator(`${scope} [data-menu-item="${id}"]`).first().click();
    const ok = await page.waitForURL((url) => url.pathname === expectPath, { timeout: 120_000 }).then(() => true).catch(() => false);
    if (ok) break;
    (results.menuRetries ??= []).push({ id, expectPath, at: page.url() });
    await settle(page);
  }
  await settle(page);
  return new URL(page.url()).pathname;
}

/** Серверный redirect после начала стрима приходит клиенту позже — ждём смены адреса. */
async function waitLeave(page, prefix = "/inspection") {
  await page.waitForURL((url) => !url.pathname.startsWith(prefix), { timeout: 60_000 }).catch(() => {});
  await settle(page);
}

async function signIn(page, email) {
  const res = await page.request.post(`${BASE}/api/auth/login`, { data: { email, password: PASSWORD }, timeout: 600_000 });
  const body = await res.json().catch(() => null);
  if (!res.ok() || body?.requiresCode) throw new Error(`вход ${email}: HTTP ${res.status()} ${JSON.stringify(body)}`);
}

async function noHorizontalScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

async function waitToast(page, text) {
  return page.locator("[data-sonner-toast]").filter({ hasText: text }).first().waitFor({ timeout: 120_000 }).then(() => true).catch(() => false);
}

async function h1(page) {
  return (await page.locator("main h1").first().textContent().catch(() => null))?.trim() ?? null;
}

async function sidebarItems(page) {
  return page.locator("[data-app-sidebar] [data-menu-item]").evaluateAll((els) => els.map((el) => el.getAttribute("data-menu-item")));
}

async function samplePdf() {
  const file = path.join(RAW, "decision-sample.pdf");
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  page.drawText("Decision (order) No 77-e2e", { x: 60, y: 760, size: 18, font: await doc.embedFont(StandardFonts.Helvetica) });
  fs.writeFileSync(file, await doc.save());
  return file;
}

/** Руководитель, 1440×900: меню, все страницы и ключевые сценарии. */
async function ownerDesktop(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU", acceptDownloads: true });
  const page = await context.newPage();
  watchErrors(page, "owner");
  await signIn(page, OWNER);

  // --- Что делать сейчас ---
  await goto(page, "/inspection");
  const items = await sidebarItems(page);
  results.ownerSidebar = items;
  check("меню раздела: семь пунктов по spec", JSON.stringify(items) === JSON.stringify(ALL_ITEMS), items);
  check("заголовок «К вам пришла проверка (или придёт)»", (await h1(page)) === "К вам пришла проверка (или придёт)", await h1(page));
  check("инструкция «Что делать сейчас» на месте", await page.locator("[data-inspection-guide]").isVisible());
  const stepLinks = await page.locator("[data-guide-page]").evaluateAll((els) => els.map((el) => [el.getAttribute("data-guide-step"), el.getAttribute("href"), el.textContent?.includes("Открыть")]));
  check("шаги 3 и 5 — «Открыть →» на свои пункты", JSON.stringify(stepLinks) === JSON.stringify([["3", "/inspection/visits", true], ["5", "/inspection/special-mode", true]]), stepLinks);
  check("быстрое действие: QR на экране (#qr)", await page.locator("#qr [data-inspection-qr], #qr [data-issue-qr]").first().isVisible());
  check("быстрое действие: «Скачать ZIP» (#archive)", (await page.locator("#archive").getByRole("button").count()) > 0, await page.locator("#archive").textContent().then((t) => t?.slice(0, 120)));
  check("блоки-страницы целиком не повторяются", (await page.locator("[data-inspection-visits-journal], [data-inspection-norms], [data-inspection-experts], [data-inspection-special-mode]").count()) === 0);
  // Статус читает клиент (`/api/settings/journal-controls`) — ждём пилюлю.
  await page.locator("#special-mode [data-special-mode-status]").waitFor({ timeout: 30_000 }).catch(() => {});
  check("кратко: статус спецрежима (#special-mode)", await page.locator("#special-mode [data-special-mode-status]").isVisible().catch(() => false), await page.locator("#special-mode [data-special-mode-status]").getAttribute("data-special-mode-status").catch(() => null));
  const more = await page.locator("[data-inspection-more-link]").evaluateAll((els) => els.map((el) => [el.getAttribute("data-inspection-more-link"), el.getAttribute("href")]));
  check("«Ещё в разделе»: нормативка, готовность, эксперты", JSON.stringify(more.map((m) => m[0])) === JSON.stringify(["norms", "readiness", "experts"]), more);
  const score = (await page.locator('[data-inspection-more-link="readiness"]').textContent())?.match(/\d+ из \d+ в порядке/)?.[0] ?? null;
  check("кратко: балл готовности со ссылкой", score !== null, score);
  await shot(page, "desktop-owner-now");

  // Старая ссылка из «Реквизитов».
  await goto(page, "/inspection#special-mode");
  await page.waitForTimeout(800);
  const anchorInView = await page.locator("#special-mode").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top >= -2 && r.top < window.innerHeight * 0.6;
  });
  check("/inspection#special-mode прокручивает к блоку спецрежима", anchorInView);
  await shot(page, "desktop-owner-now-special-anchor", false);
  await throttle();
  await page.locator('#special-mode [data-step-open="/inspection/special-mode"]').click();
  await page.waitForURL("**/inspection/special-mode", { timeout: 600_000 }).catch(() => {});
  check("«Открыть →» из блока спецрежима ведёт на «Спецрежим»", new URL(page.url()).pathname === "/inspection/special-mode", page.url());
  await settle(page);

  // --- Журнал посещений ---
  const visitsPath = await clickMenu(page, "[data-app-sidebar]", "visits", "/inspection/visits");
  check("пункт «Журнал посещений» открывает /inspection/visits", visitsPath === "/inspection/visits", visitsPath);
  check("заголовок — «Журнал посещений»", (await h1(page)) === "Журнал посещений", await h1(page));
  const lead = (await page.locator("[data-inspection-visits-journal] p").first().textContent())?.trim();
  check("пояснение: проверяющий по QR, руководитель вручную", lead?.includes("по QR") && lead?.includes("добавьте запись"), lead);
  check("нумерованные шаги «Как запись попадает в журнал»", (await page.locator('[data-inspection-how="visits"] li').count()) === 3);
  await shot(page, "desktop-owner-visits-before");

  // Добавить запись со сканом.
  const pdf = await samplePdf();
  await page.locator("[data-add-visit]").click();
  const dialog = page.locator("[data-add-visit-dialog]");
  await dialog.waitFor({ timeout: 30_000 });
  await dialog.locator('input[name="inspectorName"]').fill(VISITOR);
  await dialog.locator('input[name="inspectorPosition"]').fill("Главный специалист-эксперт");
  await dialog.locator('input[name="authority"]').fill("Управление Роспотребнадзора по г. Москве");
  await dialog.locator('input[type="radio"][value="unplanned"]').check();
  await dialog.locator('input[name="basisNumber"]').fill("77-e2e/15");
  await dialog.locator('input[name="basisDate"]').fill("2026-10-15");
  await dialog.locator('input[type="file"]').setInputFiles(pdf);
  await dialog.locator("li").filter({ hasText: "decision-sample.pdf" }).waitFor({ timeout: 30_000 }).catch(() => {});
  await shot(page, "desktop-owner-visits-add-dialog", false);
  await dialog.getByRole("button", { name: "Сохранить запись" }).click();
  let saved = await waitToast(page, "Запись добавлена в журнал посещений");
  if (!saved) {
    // Под нагрузкой машины проверка PDF в worker'е (таймаут 5 с) может не успеть — текст ошибки в отчёт и повтор.
    results.addVisitError = await dialog.locator('[role="alert"]').textContent().catch(() => null);
    await dialog.getByRole("button", { name: "Сохранить запись" }).click().catch(() => {});
    saved = await waitToast(page, "Запись добавлена в журнал посещений");
    results.addVisitRetried = true;
  }
  check("добавление посещения со сканом: тост", saved, results.addVisitError ?? null);
  const row = page.locator("[data-visit-row]").filter({ hasText: VISITOR }).first();
  await row.waitFor({ timeout: 60_000 }).catch(() => {});
  const visitId = await row.getAttribute("data-visit-row").catch(() => null);
  results.visitId = visitId;
  check("запись в списке со сканом основания", visitId !== null && (await row.locator("[data-visit-file]").count()) === 1, visitId);
  const scanHref = await row.locator("[data-visit-file]").first().getAttribute("href").catch(() => null);
  const scan = scanHref ? await page.request.get(`${BASE}${scanHref}`) : null;
  check("скан открывается (200, PDF)", scan?.status() === 200 && scan.headers()["content-type"]?.includes("pdf"), { status: scan?.status(), type: scan?.headers()["content-type"] });

  // «Приложить скан».
  const attachBefore = await row.locator("[data-visit-file]").count();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), row.locator("[data-attach-visit]").click()]);
  await chooser.setFiles(path.join(RAW, "desktop-owner-visits-add-dialog.png"));
  check("«Приложить скан»: тост", await waitToast(page, "Скан приложен"));
  await page.waitForFunction(
    ([id, before]) => document.querySelectorAll(`[data-visit-row="${id}"] [data-visit-file]`).length > before,
    [visitId, attachBefore],
    { timeout: 60_000 },
  ).catch(() => {});
  check("«Приложить скан»: второй файл у записи", (await row.locator("[data-visit-file]").count()) === attachBefore + 1, await row.locator("[data-visit-file]").count());

  // «Скрыть как ошибочную» → «Показать скрытые» → «Вернуть».
  await row.locator("[data-hide-visit]").click();
  await page.locator("[data-hide-reason]").fill("тестовая запись проверки e2e");
  await shot(page, "desktop-owner-visits-hide-dialog", false);
  await page.getByRole("button", { name: "Скрыть запись" }).click();
  check("«Скрыть как ошибочную»: тост", await waitToast(page, "Запись скрыта"));
  await page.locator("[data-toggle-hidden]").waitFor({ timeout: 60_000 }).catch(() => {});
  await page.locator("[data-toggle-hidden]").click().catch(() => {});
  const hiddenRow = page.locator(`[data-visit-row="${visitId}"][data-visit-hidden="true"]`);
  check("«Показать скрытые»: запись видна как скрытая", await hiddenRow.isVisible().catch(() => false));
  await hiddenRow.locator("[data-restore-visit]").click();
  check("«Вернуть»: тост", await waitToast(page, "Запись возвращена в журнал"));
  await page.waitForTimeout(1_500);
  await shot(page, "desktop-owner-visits");

  // Счётчик на «Что делать сейчас».
  await goto(page, "/inspection");
  const count = await page.locator("#visits [data-visit-count]").getAttribute("data-visit-count").catch(() => null);
  check("кратко: счётчик посещений на «Что делать сейчас»", Number(count) >= 1, count);

  // --- Нормативка ---
  const normsPath = await clickMenu(page, "[data-app-sidebar]", "norms", "/inspection/norms");
  check("пункт «Нормативка» открывает /inspection/norms", normsPath === "/inspection/norms", normsPath);
  check("заголовок — «Нормативка»", (await h1(page)) === "Нормативка", await h1(page));
  check("документы ППК и ХАССП-плана, перечень норм", (await page.locator("[data-norm-doc]").count()) === 2 && (await page.locator("[data-norm-list]").count()) === 1);
  const pdfHrefs = await page.locator("[data-norm-pdf]").evaluateAll((els) => els.map((el) => el.getAttribute("href")));
  check("ссылки — прямо на файлы, не на страницы ППК", pdfHrefs.every((href) => href?.startsWith("/api/production-control/")), pdfHrefs);
  await shot(page, "desktop-owner-norms");
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 300_000 }).catch(() => null),
    page.locator("[data-norm-pdf]").first().click({ timeout: 300_000 }),
  ]);
  check("«Открыть PDF» отдаёт файл (скачивание), страница на месте", download !== null && new URL(page.url()).pathname === "/inspection/norms", { file: download?.suggestedFilename() ?? null, url: page.url() });
  const stillInspection = await sidebarItems(page);
  check("левое меню не переключилось на ППК", JSON.stringify(stillInspection) === JSON.stringify(ALL_ITEMS), stillInspection);

  // --- Подготовка с экспертом и выезд ---
  const expertsPath = await clickMenu(page, "[data-app-sidebar]", "experts", "/inspection/experts");
  check("пункт «Подготовка с экспертом и выезд» открывает /inspection/experts", expertsPath === "/inspection/experts", expertsPath);
  const services = await page.locator("[data-expert-service]").evaluateAll((els) => els.map((el) => el.getAttribute("href")));
  check("карточки «Аудит перед проверкой» и «Выезд специалиста» → ?order=", JSON.stringify(services) === JSON.stringify(["/settings/services?order=pre-inspection-audit", "/settings/services?order=site-visit"]), services);
  const auditTitle = await page.locator('[data-expert-service="pre-inspection-audit"]').textContent();
  check("подпись «Аудит перед проверкой»", auditTitle?.includes("Аудит перед проверкой"), auditTitle?.slice(0, 80));
  check("нумерованные шаги «Как заказать»", (await page.locator('[data-inspection-how="experts"] li').count()) === 3);
  await shot(page, "desktop-owner-experts");
  await throttle();
  await page.locator('[data-expert-service="pre-inspection-audit"]').click();
  await page.waitForURL("**/settings/services?order=pre-inspection-audit", { timeout: 600_000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(1_500);
  check("переход на заказ услуги", page.url().endsWith("/settings/services?order=pre-inspection-audit"), page.url());
  await shot(page, "desktop-owner-services-order", false);

  await ownerTail(page);
  await context.close();
}

/** Спецрежим, «QR для проверяющего» и «Готовность» — отдельно запускается частью `owner-tail`. */
/**
 * Dev-сервер компилирует API-маршрут по первому запросу и пере-выпускает общие
 * чанки: переход в это время получает недописанный `app/layout.js`
 * («Invalid or unexpected token»). Ждём, пока чанк снова разбирается.
 */
async function waitBuildSettled(page) {
  for (let i = 0; i < 40; i++) {
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    const res = await page.request.get(`${BASE}/_next/static/chunks/app/layout.js`, { timeout: 120_000 }).catch(() => null);
    if (!res?.ok()) continue;
    try {
      new vm.Script(await res.text());
      return true;
    } catch {}
  }
  return false;
}

async function ownerTail(page) {
  // --- Спецрежим ---
  await goto(page, "/inspection/special-mode");
  check("заголовок — «Спецрежим»", (await h1(page)) === "Спецрежим", await h1(page));
  const card = page.locator("[data-inspection-special-mode]");
  // Состояние читает клиент; под нагрузкой — долго. Ждём, пока уйдёт «loading».
  await page.waitForFunction(() => {
    const value = document.querySelector("[data-inspection-special-mode]")?.getAttribute("data-inspection-special-mode");
    return value === "on" || value === "off";
  }, null, { timeout: 120_000 }).catch(() => {});
  const initial = await card.getAttribute("data-inspection-special-mode");
  results.specialInitial = initial;
  if (initial === "on") {
    // Остался включённым от прерванного прогона — сначала выключаем.
    await card.getByRole("switch").click();
    await page.locator('[data-inspection-special-mode="off"]').waitFor({ timeout: 120_000 }).catch(() => {});
    await waitToast(page, "Сохранено");
    await page.waitForTimeout(3_000);
  }
  const effects = await card.locator("li").count();
  check("пояснение: что выключает (3 пункта) и «Когда включать»", effects === 3 && (await page.locator('[data-inspection-how="special-mode"] li').count()) === 3);
  const toggle = card.getByRole("switch");
  check("руководитель может переключать", await toggle.isEnabled());
  await toggle.click();
  check("спецрежим включён: тост «Сохранено»", await waitToast(page, "Сохранено"));
  await page.locator('[data-inspection-special-mode="on"]').waitFor({ timeout: 120_000 }).catch(() => {});
  check("спецрежим включён", (await card.getAttribute("data-inspection-special-mode")) === "on");
  await shot(page, "desktop-owner-special-on");
  results.buildSettled = await waitBuildSettled(page);
  await goto(page, "/inspection#special-mode");
  await page.locator('#special-mode [data-special-mode-status="on"]').waitFor({ timeout: 120_000 }).catch(() => {});
  check("статус «Включён» на «Что делать сейчас»", (await page.locator("#special-mode [data-special-mode-status]").getAttribute("data-special-mode-status").catch(() => null)) === "on");
  await shot(page, "desktop-owner-now-special-on", false);
  await goto(page, "/inspection/special-mode");
  await page.locator('[data-inspection-special-mode="on"]').waitFor({ timeout: 120_000 }).catch(() => {});
  await page.locator("[data-inspection-special-mode]").getByRole("switch").click();
  await page.locator('[data-inspection-special-mode="off"]').waitFor({ timeout: 120_000 }).catch(() => {});
  check("спецрежим выключен обратно", (await page.locator("[data-inspection-special-mode]").getAttribute("data-inspection-special-mode")) === "off");
  await shot(page, "desktop-owner-special");

  // --- Существующие пункты: QR для проверяющего и Готовность ---
  const portalPath = await clickMenu(page, "[data-app-sidebar]", "portal", "/settings/inspector-portal");
  check("пункт «QR для проверяющего» открывает свою страницу", portalPath === "/settings/inspector-portal", portalPath);
  await shot(page, "desktop-owner-portal", false);
  const readinessPath = await clickMenu(page, "[data-app-sidebar]", "readiness", "/dashboard/compliance-audit");
  check("пункт «Готовность к проверке» открывает свою страницу", readinessPath === "/dashboard/compliance-audit", readinessPath);
  check("меню раздела остаётся на «Готовности»", JSON.stringify(await sidebarItems(page)) === JSON.stringify(ALL_ITEMS));
  await shot(page, "desktop-owner-readiness", false);
}

/** Телефон 390×800: сайт (лист меню по бургеру) или Mini App (кнопка меню раздела). */
async function phone(browser, { email, role, mini, items }) {
  const context = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ru-RU" });
  const page = await context.newPage();
  const tag = mini ? "mini" : "mobile";
  watchErrors(page, `${role}/${tag}`);
  await signIn(page, email);
  if (mini) await context.addCookies([{ name: "ws-shell", value: "mini", url: BASE }]);
  for (const { id, href } of PAGES.filter((p) => items.includes(p.id))) {
    const response = await goto(page, href);
    const pathname = new URL(page.url()).pathname;
    check(`${role}/${tag}: ${id} открывается (${response?.status()})`, pathname === href, pathname);
    check(`${role}/${tag}: ${id} без горизонтальной прокрутки`, await noHorizontalScroll(page));
    await shot(page, `${tag}-${role}-${id}`);
  }
  if (mini) {
    const button = page.locator('[data-section-menu-button="inspection"]');
    check(`${role}/mini: кнопка меню раздела`, await button.isVisible().catch(() => false));
    await button.click().catch(() => {});
    await page.waitForTimeout(800);
    const shown = await page.locator("[data-mini-menu-mode] [data-menu-item]").evaluateAll((els) => els.map((el) => el.getAttribute("data-menu-item")));
    check(`${role}/mini: в меню раздела ${items.length} пунктов`, JSON.stringify(shown) === JSON.stringify(items), shown);
    await shot(page, `mini-${role}-section-menu`, false);
  } else {
    await page.locator("[data-nav-burger]").click().catch(() => {});
    await page.waitForTimeout(800);
    const shown = await page.locator("[data-menu-item]").evaluateAll((els) => els.filter((el) => el.offsetParent !== null).map((el) => el.getAttribute("data-menu-item")));
    check(`${role}/mobile: в листе меню пункты раздела`, JSON.stringify(shown) === JSON.stringify(items), shown);
    await shot(page, `mobile-${role}-menu-sheet`, false);
  }
  await context.close();
}

/** Заведующая, 1440×900: свои пункты, без «Готовности»; права внутри страниц. */
async function headChefDesktop(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
  const page = await context.newPage();
  watchErrors(page, "headchef");
  await signIn(page, HEAD_CHEF);
  await goto(page, "/inspection");
  const items = await sidebarItems(page);
  check("заведующая: пункты меню без «Готовности»", JSON.stringify(items) === JSON.stringify(HEAD_CHEF_ITEMS), items);
  const more = await page.locator("[data-inspection-more-link]").evaluateAll((els) => els.map((el) => el.getAttribute("data-inspection-more-link")));
  check("заведующая: «Ещё в разделе» без готовности", JSON.stringify(more) === JSON.stringify(["norms", "experts"]), more);
  await shot(page, "desktop-headchef-now");
  for (const { id, href } of PAGES.slice(1)) {
    const menuId = id === "special" ? "special" : id;
    const pathname = await clickMenu(page, "[data-app-sidebar]", menuId, href);
    check(`заведующая: пункт ${id} открывает ${href}`, pathname === href, pathname);
    if (id === "visits") {
      check("заведующая: «Добавить запись» есть", await page.locator("[data-add-visit]").isVisible());
      check("заведующая: «Скрыть» нет (только руководитель)", (await page.locator("[data-hide-visit]").count()) === 0);
    }
    if (id === "norms") {
      const pdf = await page.request.get(`${BASE}/api/production-control/haccp-plan/pdf`, { timeout: 300_000 });
      check("заведующая: PDF плана ХАССП открывается (200)", pdf.status() === 200, pdf.status());
    }
    if (id === "special") {
      await page.locator('[data-inspection-special-mode="off"], [data-inspection-special-mode="on"]').first().waitFor({ timeout: 30_000 }).catch(() => {});
      check("заведующая: переключатель спецрежима недоступен", await page.locator("[data-inspection-special-mode]").getByRole("switch").isDisabled());
      const note = await page.locator("[data-inspection-special-mode] > p").last().textContent();
      check("заведующая: «попросите руководителя»", note?.includes("попросите"), note);
    }
    await shot(page, `desktop-headchef-${id}`);
  }
  await goto(page, "/dashboard/compliance-audit");
  await waitLeave(page, "/dashboard/compliance-audit");
  check("заведующая: «Готовность» закрыта (редирект)", !new URL(page.url()).pathname.startsWith("/dashboard/compliance-audit"), page.url());
  await context.close();
}

/** Повар (без tasks.verify): раздела нет, прямой заход — редирект. */
async function cook(browser) {
  for (const viewport of [
    { tag: "desktop", width: 1440, height: 900 },
    { tag: "mobile", width: 390, height: 800 },
  ]) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, locale: "ru-RU", ...(viewport.tag === "mobile" ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    const page = await context.newPage();
    watchErrors(page, `cook/${viewport.tag}`);
    await signIn(page, COOK);
    for (const { id, href } of PAGES) {
      await goto(page, href);
      await waitLeave(page);
      const pathname = new URL(page.url()).pathname;
      check(`повар/${viewport.tag}: ${id} закрыта (редирект на ${pathname})`, !pathname.startsWith("/inspection"), pathname);
      if (id === "visits") await shot(page, `${viewport.tag}-cook-visits-redirect`, false);
    }
    const sections = await page.locator("[data-nav-section]").evaluateAll((els) => els.map((el) => el.getAttribute("data-nav-section")));
    check(`повар/${viewport.tag}: раздела «Пришла проверка» в меню нет`, !sections.includes("inspection"), sections);
    await context.close();
  }
}

const browser = await launch();
try {
  if (PART === "all" || PART === "owner") await ownerDesktop(browser);
  if (PART === "all" || PART === "phone") await phone(browser, { email: OWNER, role: "owner", mini: false, items: ALL_ITEMS });
  if (PART === "all" || PART === "mini") await phone(browser, { email: OWNER, role: "owner", mini: true, items: ALL_ITEMS });
  if (PART === "all" || PART === "headchef") {
    await headChefDesktop(browser);
    await phone(browser, { email: HEAD_CHEF, role: "headchef", mini: false, items: HEAD_CHEF_ITEMS });
    await phone(browser, { email: HEAD_CHEF, role: "headchef", mini: true, items: HEAD_CHEF_ITEMS });
  }
  if (PART === "owner-tail") {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
    const page = await context.newPage();
    watchErrors(page, "owner-tail");
    await signIn(page, OWNER);
    await ownerTail(page);
    await context.close();
  }
  // Повтор только Mini App заведующей (после сбоя dev-сервера на перекомпиляции).
  if (PART === "headchef-mini") await phone(browser, { email: HEAD_CHEF, role: "headchef", mini: true, items: HEAD_CHEF_ITEMS });
  if (PART === "all" || PART === "cook") await cook(browser);
} catch (error) {
  check("скрипт дошёл до конца", false, String(error?.stack ?? error).slice(0, 800));
} finally {
  await browser.close();
  results.finishedAt = new Date().toISOString();
  results.problems = problems;
  fs.writeFileSync(path.join(RAW, `results-${PART}.json`), JSON.stringify(results, null, 2));
  console.log(problems.length ? `ПРОБЛЕМ: ${problems.length}` : "OK");
}
