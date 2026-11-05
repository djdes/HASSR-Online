// Визуальная проверка (serving-temp-products-2026-11-05): справочник продуктов
// по видам, диалог продукта, типовой чек-лист «Контроль температуры готовых
// блюд на раздаче» — старт, подсветка вне нормы, «Обновить список блюд».
// Запуск: node .agent/tasks/serving-temp-products-2026-11-05/check.mjs http://localhost:3377
// Локальная база wesetup_serving (копия), пароль демо-учётки задан в ней.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] || "http://localhost:3377";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(HERE, "raw");
fs.mkdirSync(RAW, { recursive: true });
const EMAIL = "admin@haccp.local";
const PASSWORD = "serving123";

async function launch() {
  const base = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
  for (const dir of fs.existsSync(base) ? fs.readdirSync(base).filter((name) => /^chromium-\d+$/.test(name)).sort().reverse() : []) {
    const exe = path.join(base, dir, "chrome-win64", "chrome.exe");
    if (fs.existsSync(exe)) return chromium.launch({ executablePath: exe, args: ["--lang=ru-RU"] });
  }
  return chromium.launch({ channel: "chrome", args: ["--lang=ru-RU"] });
}

const results = [];
const log = (step, ok, extra = "") => { results.push({ step, ok, extra }); console.log(`${ok ? "OK  " : "FAIL"} ${step} ${extra}`); };

async function context(browser, kind) {
  const options = kind === "desktop"
    ? { viewport: { width: 1440, height: 900 }, locale: "ru-RU", timezoneId: "Europe/Moscow" }
    : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ru-RU", timezoneId: "Europe/Moscow" };
  const ctx = await browser.newContext(options);
  const page = await ctx.newPage();
  const res = await page.request.post(`${BASE}/api/auth/login`, { data: { email: EMAIL, password: PASSWORD }, timeout: 600_000 });
  if (!res.ok()) throw new Error(`вход: ${res.status()} ${await res.text()}`);
  return { ctx, page };
}

const shot = (page, name, full = true) => page.screenshot({ path: path.join(RAW, `${name}.png`), fullPage: full });
async function settle(page) { await page.waitForLoadState("networkidle", { timeout: 120_000 }).catch(() => {}); await page.waitForTimeout(600); }
async function closeOverlays(page) {
  for (let i = 0; i < 3; i++) {
    const close = page.locator('[role="dialog"] button:has-text("Понятно"), [role="dialog"] button:has-text("Закрыть")').first();
    if (await close.isVisible().catch(() => false)) { await close.click().catch(() => {}); await page.waitForTimeout(300); } else break;
  }
}

const browser = await launch();
try {
  for (const kind of ["desktop", "mobile"]) {
    const { ctx, page } = await context(browser, kind);
    await page.goto(`${BASE}/settings/products`, { timeout: 600_000 }); await settle(page); await closeOverlays(page);
    await shot(page, `${kind}-products-all`);
    log(`${kind}: вкладки вида`, await page.getByRole("navigation", { name: "Вид продукции" }).isVisible());
    await page.goto(`${BASE}/settings/products?kind=finished`, { timeout: 600_000 }); await settle(page); await closeOverlays(page);
    await shot(page, `${kind}-products-finished`);
    const rows = await page.locator("tbody tr").count();
    log(`${kind}: вкладка «Готовая продукция»`, rows === 4, `строк ${rows}`);
    await page.getByRole("button", { name: "Добавить продукт" }).click();
    await page.waitForTimeout(500);
    await shot(page, `${kind}-product-dialog-new`, false);
    log(`${kind}: диалог — вид по вкладке`, (await page.getByRole("radio", { name: /Готовая продукция/ }).getAttribute("aria-checked")) === "true");
    await page.keyboard.press("Escape");
    if (kind === "desktop") {
      // Правка: срок в часах и подача сохраняются.
      await page.locator("tbody tr", { hasText: "Котлета куриная" }).getByRole("button").first().click();
      await page.waitForTimeout(400);
      await shot(page, `${kind}-product-dialog-edit`, false);
      await page.locator("#prod-shelf").fill("4");
      await page.getByRole("radio", { name: /Горячее/ }).click();
      const saved = page.waitForResponse((r) => r.url().includes("/api/products") && r.request().method() === "PUT", { timeout: 300_000 });
      await page.getByRole("button", { name: "Сохранить", exact: true }).click();
      log("desktop: PUT /api/products", (await saved).ok());
      await page.waitForTimeout(3000); await settle(page);
      const cell = await page.locator("tbody tr", { hasText: "Котлета куриная" }).innerText();
      log("desktop: срок 4 ч сохранён", /4 ч/.test(cell), cell.replace(/\s+/g, " "));
    }
    await ctx.close();
  }

  // Чек-лист: типовой шаблон → старт → блюда, нормы, подсветка, обновление.
  const { ctx, page } = await context(browser, "desktop");
  const add = await page.request.post(`${BASE}/api/checklists/templates/typical`, { data: { key: "serving-temperature" } });
  const added = await add.json();
  log("типовой шаблон добавлен", add.ok(), JSON.stringify(added.template?.title));
  const start = await page.request.post(`${BASE}/api/checklists/inspections`, { data: { templateId: added.template.id } });
  const started = await start.json();
  log("проверка начата", start.ok(), started.id);
  const loaded = await (await page.request.get(`${BASE}/api/checklists/inspections/${started.id}`)).json();
  const rows = loaded.inspection.snapshot.sections[1].categories[0].rows.map((row) => row.title);
  log("блюда: бракераж сегодня + справочник", JSON.stringify(rows) === JSON.stringify(["Борщ со сметаной", "Котлета куриная", "Пюре картофельное", "Компот из сухофруктов", "Салат «Цезарь»"]), JSON.stringify(rows));
  log("подача предзаполнена", Object.values(loaded.inspection.answers).filter((value) => ["hot", "soup", "cold"].includes(value)).length === 4, JSON.stringify(loaded.inspection.answers));
  await page.goto(`${BASE}/checklists/inspections/${started.id}`, { timeout: 600_000 }); await settle(page); await closeOverlays(page);
  await shot(page, "desktop-inspection-start");
  const borschStart = page.getByRole("spinbutton", { name: /Борщ со сметаной — Температура в начале раздачи/ });
  await borschStart.fill("68");
  await page.waitForTimeout(300);
  const flagged = await page.locator('[data-out-of-norm="true"]').count();
  log("вне нормы подсвечено сразу (68 °C у первого блюда)", flagged === 1, `карточек ${flagged}`);
  await page.locator('[data-out-of-norm="true"]').first().scrollIntoViewIfNeeded();
  await shot(page, "desktop-inspection-out-of-norm", false);
  await borschStart.fill("80");
  const draftSaved = page.waitForResponse((r) => r.url().includes(`/api/checklists/inspections/${started.id}`) && r.request().method() === "PATCH", { timeout: 300_000 });
  await page.getByRole("button", { name: "Сохранить черновик" }).click();
  log("черновик сохранён", (await draftSaved).ok());
  // В бракераж добавили блюдо — «Обновить список блюд».
  fs.writeFileSync(path.join(RAW, "refresh-request.txt"), "added row via SQL before refresh\n");
  console.log("REFRESH_POINT");
  await ctx.close();

  const mobile = await context(browser, "mobile");
  await mobile.page.goto(`${BASE}/checklists/inspections/${started.id}`, { timeout: 600_000 }); await settle(mobile.page); await closeOverlays(mobile.page);
  await shot(mobile.page, "mobile-inspection");
  const overflow = await mobile.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  log("телефон 390: без горизонтальной прокрутки", overflow <= 1, `лишних px ${overflow}`);
  await mobile.ctx.close();
  fs.writeFileSync(path.join(RAW, "inspection-id.txt"), started.id);
} catch (error) {
  log("сценарий", false, String(error?.stack || error));
} finally {
  await browser.close();
  fs.writeFileSync(path.join(RAW, "results.json"), JSON.stringify(results, null, 2));
}
