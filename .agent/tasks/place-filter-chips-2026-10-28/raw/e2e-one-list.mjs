// «Один список» (2026-10-29): на вкладках с фильтром по точкам переключатель в шапке скрыт,
// без выбора — «Все», новый сотрудник по умолчанию — в точку из фильтра, а не из шапки.
// ЛОКАЛЬНАЯ база wesetup_memos (не прод).
//   BASE=http://localhost:3026 CHROME=<chrome.exe> node .agent/tasks/place-filter-chips-2026-10-28/raw/e2e-one-list.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE ?? "http://localhost:3026";
const OUT = new URL("./shots/", import.meta.url);
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail: String(detail) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  // В шапке выбрана точка № 5 — фильтр на вкладках её больше не подхватывает.
  await ctx.addCookies([{ name: "wesetup.building", value: "org-dk:b-dk-5", domain: "localhost", path: "/" }]);
  const page = await ctx.newPage();
  page.setDefaultTimeout(240000);
  page.setDefaultNavigationTimeout(240000);
  await page.goto(`${BASE}/login`, { waitUntil: "load" });
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.fill("#email", "dk-owner@test.local");
    await page.fill("#password", "Test-12345");
    if ((await page.inputValue("#email")) !== "dk-owner@test.local") continue;
    await page.click('button[type="submit"]');
    try {
      await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20000 });
      break;
    } catch {
      await page.waitForTimeout(1500);
    }
  }

  for (const [path, kind] of [
    ["/settings/users", "staff"],
    ["/settings/areas", "areas"],
    ["/settings/equipment", "equipment"],
  ]) {
    await page.goto(`${BASE}${path}`, { waitUntil: "load" });
    await page.waitForSelector(`[data-place-filter="${kind}"]`, { timeout: 120000 });
    const switcher = await page.locator("[data-current-point]").count();
    const active = await page.getAttribute(`[data-place-filter="${kind}"] [aria-current="true"]`, "data-place-chip");
    check(`${path}: переключателя точки в шапке нет`, switcher === 0, `[data-current-point]: ${switcher}`);
    check(`${path}: без выбора — «Все», хотя в шапке была точка № 5`, active === "all", String(active));
  }
  await page.goto(`${BASE}/settings/qr-posters`, { waitUntil: "load" });
  await page.waitForSelector("[data-qr-page]");
  check("/settings/qr-posters: переключатель в шапке остаётся", (await page.locator("[data-current-point]").count()) > 0);

  // Новый сотрудник — в точку из фильтра (112), а не из шапки (№ 5).
  await page.goto(`${BASE}/settings/users?place=b-dk-112`, { waitUntil: "load" });
  await page.waitForSelector('[data-place-filter="staff"] [data-place-chip="b-dk-112"][aria-current="true"]');
  const addButtons = page.locator("button", { hasText: /^\s*Добавить\s*$/ });
  if ((await addButtons.count()) === 0) {
    // Свёрнутая должность «Повар» (тестовая): раскрыть.
    await page.locator("button", { hasText: /^\s*Повар\s*\d*\s*$/ }).first().click().catch(() => {});
  }
  const add = page.locator("button", { hasText: /^\s*Добавить\s*$/ }).first();
  await add.click({ timeout: 30000 });
  await page.waitForSelector("[data-building-chip]", { timeout: 60000 });
  const pressed = await page.$$eval('[data-building-chip][aria-pressed="true"]', (nodes) => nodes.map((node) => node.getAttribute("data-building-chip")));
  check("Добавление сотрудника: «Где работает» — точка из фильтра (112)", JSON.stringify(pressed) === JSON.stringify(["b-dk-112"]), JSON.stringify(pressed));
  await page.screenshot({ path: fileURLToPath(new URL("8-add-staff-from-filter.png", OUT)) });
  await ctx.close();
} catch (error) {
  check("скрипт без исключений", false, error?.stack ?? String(error));
} finally {
  await browser.close();
  const failed = results.filter((result) => !result.ok);
  writeFileSync(fileURLToPath(new URL("e2e-one-list.json", OUT)), JSON.stringify({ base: BASE, total: results.length, failed: failed.length, results }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  process.exitCode = failed.length ? 1 : 0;
}
