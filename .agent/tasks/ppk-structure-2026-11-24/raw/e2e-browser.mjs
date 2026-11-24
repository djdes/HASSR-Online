// Проверка структуры ППК на локальном стенде: обзор, окно на ПК, шторка на телефоне,
// прямая ссылка, сохранение в окне. Снимки — в каталог из argv[2].
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("/opt/node-tools/node_modules/playwright");
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#email", "admin@haccp.local");
  await page.fill("#password", "admin1234");
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60000 }),
    page.click('button[type="submit"]'),
  ]);
  // Новый тестовый аккаунт: окно «Мы обновили условия» поверх кабинета — принять.
  await page.goto(`${BASE}/production-control`, { waitUntil: "networkidle", timeout: 120000 });
  const legal = page.locator('[data-testid="legal-update-modal"]');
  if (await legal.count()) {
    await legal.locator('input[type="checkbox"], [role="checkbox"]').first().click();
    await page.click('[data-testid="legal-update-accept"]');
    await legal.waitFor({ state: "detached", timeout: 30000 });
  }
}

const browser = await chromium.launch();
const errors = [];

// ПК 1440×900
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "ru-RU" });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  await login(page);
  await page.goto(`${BASE}/production-control`, { waitUntil: "networkidle", timeout: 120000 });
  const items = await page.locator("[data-ppk-item]").count();
  check("overview: 32 пункта-ссылки", items === 32, `items=${items}`);
  const sections = await page.locator("[data-ppk-section]").count();
  check("overview: 4 раздела", sections === 4, `sections=${sections}`);
  const hrefs = await page.locator("[data-ppk-item]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
  check("ссылки ведут на /production-control/item/<id>", hrefs.every((href) => /^\/production-control\/item\/(\d-\d{1,2}|app-\d)$/.test(href ?? "")), hrefs.slice(0, 3).join(", "));
  await page.screenshot({ path: path.join(OUT, "01-overview-desktop.png"), fullPage: true });

  // Окно пункта 1.1 поверх обзора
  await page.click('[data-ppk-item="1-1"]');
  await page.waitForSelector("[data-ppk-item-dialog]", { timeout: 30000 });
  await page.waitForSelector("[data-ppk-org-info]", { timeout: 60000 });
  check("клик по 1.1: адрес окна", page.url().endsWith("/production-control/item/1-1"), page.url());
  check("клик по 1.1: обзор остаётся под окном", (await page.locator("[data-ppk-structure]").count()) === 1);
  const box = await page.locator("[data-ppk-item-dialog]").boundingBox();
  check("ПК: окно по центру, не во всю ширину", box !== null && box.width <= 940 && box.x > 100, JSON.stringify(box));
  await page.screenshot({ path: path.join(OUT, "02-dialog-1-1-desktop.png") });

  // Закрытие крестиком → снова обзор
  await page.keyboard.press("Escape");
  await page.waitForURL(`${BASE}/production-control`, { timeout: 15000 });
  await page.waitForTimeout(500);
  check("Esc закрывает окно и возвращает адрес обзора", (await page.locator("[data-ppk-item-dialog]").count()) === 0, page.url());

  // Открыть каждый пункт и убедиться, что окно рисуется без ошибки
  for (const id of hrefs.map((href) => href.split("/").pop())) {
    await page.goto(`${BASE}/production-control`, { waitUntil: "domcontentloaded" });
    await page.click(`[data-ppk-item="${id}"]`);
    try {
      await page.waitForSelector("[data-ppk-item-dialog]", { timeout: 30000 });
      await page.waitForFunction(() => !document.querySelector("[data-ppk-item-skeleton]"), null, { timeout: 60000 });
      const text = await page.locator("[data-ppk-item-dialog]").innerText();
      const broken = /Application error|Такой страницы нет|Что-то пошло не так/i.test(text);
      check(`окно ${id}`, !broken, `${text.length} символов`);
      if (["1-3", "1-4", "1-8", "2-8", "3-3", "3-7", "app-1"].includes(id)) {
        await page.screenshot({ path: path.join(OUT, `03-dialog-${id}-desktop.png`) });
      }
    } catch (error) {
      check(`окно ${id}`, false, String(error).slice(0, 200));
      await page.screenshot({ path: path.join(OUT, `fail-${id}.png`) });
    }
  }

  // Сохранение текста 1.9 в окне и перечитывание
  await page.goto(`${BASE}/production-control`, { waitUntil: "domcontentloaded" });
  await page.click('[data-ppk-item="1-9"]');
  await page.waitForSelector('[data-ppk-text="text-terms"] textarea', { timeout: 60000 });
  await page.fill('[data-ppk-text="text-terms"] textarea', "ХАССП — система анализа опасностей и критических контрольных точек.");
  await page.click('[data-ppk-text="text-terms"] button:has-text("Сохранить")');
  await page.waitForTimeout(1500);
  await page.goto(`${BASE}/production-control/item/1-9`, { waitUntil: "networkidle" });
  const saved = await page.locator('[data-ppk-text="text-terms"] textarea').inputValue();
  check("1.9: текст сохраняется и виден при повторном открытии", saved.startsWith("ХАССП — система"), saved.slice(0, 40));
  check("прямой заход: страница пункта, не окно", (await page.locator("[data-ppk-item-page]").count()) === 1 && (await page.locator("[data-ppk-item-dialog]").count()) === 0);
  await page.screenshot({ path: path.join(OUT, "04-item-page-1-9.png"), fullPage: true });

  // 3.1 «Заполнить типовыми»
  await page.goto(`${BASE}/production-control/item/3-1`, { waitUntil: "networkidle" });
  await page.click('[data-ppk-prp="prp-infections"] button:has-text("Заполнить типовыми")');
  await page.waitForFunction(() => document.querySelectorAll('[data-ppk-prp="prp-infections"] tbody tr').length > 5, null, { timeout: 30000 });
  const rows = await page.locator('[data-ppk-prp="prp-infections"] tbody tr').count();
  check("3.1: типовые строки добавлены", rows >= 10, `rows=${rows}`);

  // Статусы обзора обновились
  await page.goto(`${BASE}/production-control`, { waitUntil: "networkidle" });
  const dot19 = await page.locator('[data-ppk-item="1-9"] [role="img"]').getAttribute("aria-label");
  const dot31 = await page.locator('[data-ppk-item="3-1"] [role="img"]').getAttribute("aria-label");
  check("обзор: 1.9 и 3.1 заполнены", dot19 === "Заполнен" && dot31 === "Заполнен", `${dot19} / ${dot31}`);
  await page.screenshot({ path: path.join(OUT, "05-overview-after.png"), fullPage: true });

  // Тёмная тема: обзор и окно
  await context.addCookies([{ name: "wesetup-theme", value: "dark", url: BASE }]);
  await page.goto(`${BASE}/production-control`, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(OUT, "08-overview-dark.png") });
  await page.click('[data-ppk-item="1-4"]');
  await page.waitForSelector("[data-ppk-production-info]", { timeout: 60000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "09-dialog-1-4-dark.png") });
  await context.close();
}

// Телефон 390×844
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ru-RU" });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`mobile pageerror: ${error.message}`));
  await login(page);
  await page.goto(`${BASE}/production-control`, { waitUntil: "networkidle", timeout: 120000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("телефон: нет горизонтальной прокрутки обзора", overflow <= 1, `overflow=${overflow}`);
  await page.screenshot({ path: path.join(OUT, "06-overview-mobile.png"), fullPage: false });
  await page.click('[data-ppk-item="3-3"]');
  await page.waitForSelector("[data-ppk-item-dialog]", { timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector("[data-ppk-item-skeleton]"), null, { timeout: 60000 });
  await page.waitForTimeout(700);
  const box = await page.locator("[data-ppk-item-dialog]").boundingBox();
  check("телефон: окно — шторка снизу во всю ширину", box !== null && Math.abs(box.width - 390) <= 1 && Math.abs(box.y + box.height - 844) <= 2, JSON.stringify(box));
  await page.screenshot({ path: path.join(OUT, "07-sheet-3-3-mobile.png") });
  await context.close();
}

await browser.close();
check("нет ошибок страницы в консоли", errors.length === 0, errors.slice(0, 3).join(" | "));
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ results, errors }, null, 2));
const failed = results.filter((row) => !row.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
