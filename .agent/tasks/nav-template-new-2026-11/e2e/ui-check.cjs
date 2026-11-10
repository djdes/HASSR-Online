/**
 * Локальный стенд (`next dev -p 3022`, демо-кухня `prisma/seed-haccp-demo.ts`),
 * браузер — шаблон меню «Новый» (AC2–AC6). Владелец демо-организации.
 * Запуск: node .agent/tasks/nav-template-new-2026-11/e2e/ui-check.cjs <папка скриншотов>
 */
const { chromium } = require("playwright");
const path = require("node:path");

const BASE = process.env.E2E_BASE || "http://localhost:3022";
const OUT = process.argv[2];
const EMAIL = process.env.E2E_EMAIL || "admin@haccp.local";
const PASSWORD = process.env.E2E_PASSWORD || "admin1234";

const results = [];
const check = (name, ok, details) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${details !== undefined ? ` — ${typeof details === "string" ? details : JSON.stringify(details)}` : ""}`);
};
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
const open = async (page, url) => {
  await page.goto(`${BASE}${url}`, { waitUntil: "load", timeout: 240000 });
  await page.waitForSelector("[data-app-sidebar]", { timeout: 120000 });
  await page.waitForTimeout(800);
};
const visible = (page, selector) => page.locator(selector).first().isVisible().catch(() => false);
const texts = (page, selector) => page.locator(selector).allInnerTexts().then((list) => list.map((t) => t.trim()).filter(Boolean));

(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 240000 });
  await page.fill('input[type="email"], input[name="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 240000 }),
    page.click('button[type="submit"]'),
  ]);

  // ── Стандартный шаблон (по умолчанию) ───────────────────────────────
  await open(page, "/journals");
  check("AC6 по умолчанию — стандартный шаблон", (await page.getAttribute("html", "data-view-nav")) === "classic");
  check("AC6 стандартный сайдбар: меню раздела (лента)", await visible(page, '[data-app-sidebar][data-sidebar-mode="section"]'));
  check("AC6 строки над страницей в стандартном нет", (await page.locator("[data-section-top-menu]").count()) === 0);
  check("AC2 переключатель виден в стандартном", await visible(page, "[data-nav-layout-switch]"));
  check("AC2 выбран «Стандартный»", (await page.getAttribute('[data-nav-layout="classic"]', "aria-pressed")) === "true");
  await shot(page, "01-classic-journals");

  // ── Переключение на «Новый» — сразу, без перезагрузки ───────────────
  await page.click('[data-nav-layout="new"]');
  await page.waitForSelector('[data-app-sidebar][data-sidebar-layout="new"]', { timeout: 30000 });
  check("AC2 «Новый» включается без перезагрузки", (await page.getAttribute("html", "data-view-nav")) === "new");
  const cookie = (await context.cookies()).find((c) => c.name === "wesetup-view");
  check("AC1 кука устройства хранит выбор", /n:new/.test(decodeURIComponent(cookie?.value ?? "")), cookie?.value);

  // ── «Все журналы»: два уровня слева, остальное сверху ───────────────
  check("AC3 раскрыт список текущего раздела", await visible(page, '[data-nav-sublist="company"]'));
  check("AC3 раскрыт ровно один список", (await page.locator("[data-nav-sublist]").count()) === 1);
  const second = await texts(page, '[data-nav-sublist="company"] [data-menu-item]');
  check("AC3 второй уровень — пункты «Моей компании»", second.length >= 3, second);
  check(
    "AC3 текущий пункт второго уровня подсвечен",
    (await page.getAttribute('[data-nav-sublist="company"] [data-menu-item="points"]', "aria-current")) === "true",
  );
  check("AC3 третьего уровня слева нет", (await page.locator('[data-app-sidebar] [data-menu-item="all"]').count()) === 0);
  const top = await texts(page, "[data-section-top-menu] [data-top-menu-item]");
  check("AC4 строка над страницей — пункты «Торговых точек»", top.length >= 6, top);
  check(
    "AC4 в строке подсвечены «Журналы»",
    (await page.getAttribute('[data-top-menu-item="journals"]', "aria-current")) === "true",
  );
  const crumbs = await page.locator("[data-new-nav-crumbs]").innerText();
  check("AC5 крошки: цепочка по меню", crumbs.replace(/\s+/g, " ").trim().length > 0, crumbs.replace(/\s+/g, " ").trim());
  check("AC5 кнопка «Назад» в строке крошек", (await page.locator("[data-new-nav-crumbs] button").count()) >= 1);
  await shot(page, "02-new-journals");

  // ── Выпадающая панель: четвёртый уровень ────────────────────────────
  await page.click('[data-top-menu-item="journals"]');
  await page.waitForSelector('[data-top-menu-panel="journals"]', { timeout: 15000 });
  const panel = await texts(page, '[data-top-menu-panel="journals"] a');
  check("AC4 панель «Журналы»: пункты следующего уровня", panel.length >= 5, panel);
  check(
    "AC4 в панели подсвечено текущее место",
    (await page.locator('[data-top-menu-panel="journals"] a[aria-current="page"]').count()) === 1,
  );
  await page.waitForTimeout(600);
  await shot(page, "03-new-journals-panel");
  await page.keyboard.press("Escape");

  // ── Пункт второго уровня с вкладками: строка — его вкладки ──────────
  await open(page, "/settings/organization/documents");
  const tabs = await texts(page, "[data-section-top-menu] [data-top-menu-item]");
  check("AC4 «Реквизиты»: строка — вкладки пункта", tabs.length === 3, tabs);
  check("AC4 вкладки над страницей не повторяются", !(await visible(page, "[data-section-tabs]")));
  check(
    "AC5 последнее звено — не ссылка",
    (await page.locator("[data-new-nav-crumbs] [aria-current]").count()) >= 0 &&
      !(await page.locator("[data-new-nav-crumbs]").innerText()).includes("undefined"),
  );
  await shot(page, "04-new-organization-tabs");

  // ── Аккордеон: другой раздел, сворачивание ──────────────────────────
  await page.click('[data-nav-section="monitoring"]');
  await page.waitForURL((u) => u.pathname.startsWith("/monitoring"), { timeout: 240000 });
  await page.waitForSelector('[data-nav-sublist="monitoring"]', { timeout: 60000 });
  check("AC3 нажатие на другой раздел открывает его корень и список", (await page.locator("[data-nav-sublist]").count()) === 1);
  check("AC4 у пункта без продолжения строки нет", (await page.locator("[data-section-top-menu]").count()) === 0);
  await shot(page, "05-new-monitoring");
  await page.click('[data-nav-section="monitoring"]');
  await page.waitForTimeout(300);
  check("AC3 нажатие на раскрытый раздел сворачивает список", (await page.locator("[data-nav-sublist]").count()) === 0);
  check("AC3 страница при сворачивании не меняется", new URL(page.url()).pathname === "/monitoring");

  // ── Выбор переживает перезагрузку (первый кадр сервера) ─────────────
  await open(page, "/settings/equipment");
  check("AC2 после перезагрузки — «Новый»", await visible(page, '[data-app-sidebar][data-sidebar-layout="new"]'));
  check(
    "AC4 обычный пункт третьего уровня подсвечен",
    (await page.getAttribute('[data-top-menu-item="equipment"]', "aria-current")) === "page",
  );
  await shot(page, "06-new-equipment");

  // ── Телефон: шаблон не действует ────────────────────────────────────
  await page.setViewportSize({ width: 412, height: 900 });
  await page.waitForTimeout(500);
  check("AC6 телефон: сайдбара и строки нет", !(await visible(page, "[data-app-sidebar]")) && !(await visible(page, "[data-section-top-menu]")));
  check("AC6 телефон: новых крошек нет", !(await visible(page, "[data-new-nav-crumbs]")));
  await shot(page, "07-new-phone");
  await page.setViewportSize({ width: 1440, height: 900 });

  // ── Возврат к стандартному — одно нажатие ───────────────────────────
  await page.click('[data-nav-layout="classic"]');
  await page.waitForSelector("[data-app-sidebar]:not([data-sidebar-layout])", { timeout: 30000 });
  check("AC2 возврат к стандартному одним нажатием", (await page.getAttribute("html", "data-view-nav")) === "classic");
  check("AC6 строка над страницей пропала", (await page.locator("[data-section-top-menu]").count()) === 0);
  await shot(page, "08-classic-again");

  check("ошибок страницы нет", errors.length === 0, errors.slice(0, 3));
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  process.exit(failed.length ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(2);
});
