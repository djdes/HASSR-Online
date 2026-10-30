// Проверка в браузере на ЛОКАЛЬНОЙ тестовой базе (wesetup_access, 127.0.0.1:5432), не на проде.
// Запуск: BASE=http://localhost:3034 node .agent/tasks/point-skeleton-access-2026-10-29/raw/e2e.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3034";
const CHROME =
  process.env.CHROME ?? "C:\\Users\\Two\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe";
const OUT = new URL("./shots/", import.meta.url);
mkdirSync(OUT, { recursive: true });
const shot = (name) => new URL(name, OUT).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

async function login(page, email) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 180000 });
      await page.waitForSelector("#email", { timeout: 120000 });
      await page.fill("#email", email);
      await page.fill("#password", "Test-12345");
      await page.click('button[type="submit"]');
      await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 180000 });
      return;
    } catch (error) {
      console.log(`login ${email} attempt ${attempt} failed: ${String(error).slice(0, 160)}`);
      if (attempt === 5) throw error;
    }
  }
}

/** Порядок событий на странице: скелет контента, скелет списка, тост. */
async function watch(page) {
  await page.evaluate(() => {
    const t0 = performance.now();
    const state = { content: false, list: false, toast: false };
    window.__events = [];
    const tick = () => {
      const now = Math.round(performance.now() - t0);
      const content = Boolean(document.querySelector("[data-content-pending]"));
      const list = Boolean(document.querySelector("[data-place-results-pending]"));
      const toast = Boolean(document.querySelector("[data-sonner-toast]"));
      if (content !== state.content) window.__events.push([content ? "content-on" : "content-off", now]);
      if (list !== state.list) window.__events.push([list ? "list-on" : "list-off", now]);
      if (toast && !state.toast) window.__events.push(["toast", now]);
      Object.assign(state, { content, list, toast: state.toast || toast });
    };
    new MutationObserver(tick).observe(document.body, { childList: true, subtree: true, attributes: true });
  });
}
const events = (page) => page.evaluate(() => window.__events);
const at = (list, name) => list.find(([event]) => event === name)?.[1];

/** Медленная сеть: окно ожидания видно и на быстром сервере. */
async function throttle(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 600,
    downloadThroughput: 400 * 1024,
    uploadThroughput: 400 * 1024,
  });
  return cdp;
}

const browser = await chromium.launch({ executablePath: CHROME });
try {
  // ---- (a) Владелец: смена точки в шапке и чип места ------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await login(page, "dk-owner@test.local");
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 180000 });
    await page.waitForSelector('[data-current-point="switch"]', { timeout: 180000 });
    const before = (await page.textContent('[data-current-point="switch"] [data-point-title]'))?.trim();
    await page.click('[data-current-point="switch"]');
    await page.waitForSelector("[data-point-option]", { timeout: 30000 });
    const options = await page.$$eval("[data-point-option]", (els) =>
      els.map((el) => ({ id: el.getAttribute("data-point-option"), text: el.textContent?.trim() ?? "" })),
    );
    const target = options.find((option) => !option.text.startsWith(before ?? "\u0000")) ?? options[1];
    await watch(page);
    const cdp = await throttle(page);
    await page.click(`[data-point-option="${target.id}"]`);
    await page.waitForSelector("[data-content-pending]", { state: "attached", timeout: 30000 });
    const busy = await page.getAttribute('[data-current-point="switch"]', "aria-busy");
    await page.screenshot({ path: shot("a-point-pending.png") });
    await page.waitForSelector("[data-content-pending]", { state: "detached", timeout: 180000 });
    await page.waitForSelector("[data-sonner-toast]", { timeout: 30000 });
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    const list = await events(page);
    const after = (await page.textContent('[data-current-point="switch"] [data-point-title]'))?.trim();
    check("AC1 смена точки: скелет в контенте появился и ушёл", at(list, "content-on") !== undefined && at(list, "content-off") !== undefined, JSON.stringify(list));
    check("AC1 тост — после прихода новой страницы", at(list, "toast") >= at(list, "content-off"), JSON.stringify(list));
    check("AC1 переключатель занят, пока идёт смена", busy === "true", String(busy));
    check("AC1 в шапке — новая точка", after && after !== before, `${before} → ${after}`);
    await page.screenshot({ path: shot("a-point-done.png") });

    // Чип места на «Оборудовании».
    await page.goto(`${BASE}/settings/equipment`, { waitUntil: "domcontentloaded", timeout: 180000 });
    const chipsVisible = await page
      .waitForSelector('[data-place-filter="equipment"]', { timeout: 120000 })
      .then(() => true)
      .catch(() => false);
    check("AC2 чипы мест на «Оборудовании» есть", chipsVisible);
    if (chipsVisible) {
      const chip = await page.$eval(
        '[data-place-filter="equipment"] [data-place-chip]:not([aria-current])',
        (el) => el.getAttribute("data-place-chip"),
      );
      await watch(page);
      const cdpChip = await throttle(page);
      await page.click(`[data-place-chip="${chip}"]`);
      const optimistic = await page.getAttribute(`[data-place-chip="${chip}"]`, "aria-current");
      await page.waitForSelector("[data-place-results-pending]", { state: "attached", timeout: 30000 });
      const chipsDuring = await page.isVisible('[data-place-filter="equipment"]');
      await page.screenshot({ path: shot("a-chip-pending.png") });
      await page.waitForSelector("[data-place-results-pending]", { state: "detached", timeout: 180000 });
      await cdpChip.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      const chipEvents = await events(page);
      check("AC2 чип отмечен сразу (оптимистично)", optimistic === "true", String(optimistic));
      check("AC2 скелет списка появился и ушёл", at(chipEvents, "list-on") !== undefined && at(chipEvents, "list-off") !== undefined, JSON.stringify(chipEvents));
      check("AC2 чипы видны во время загрузки", chipsDuring);
      check("AC2 адрес с выбранным местом", new URL(page.url()).searchParams.get("place") === chip, page.url());
      check("AC2 общий скелет контента не включался", at(chipEvents, "content-on") === undefined, JSON.stringify(chipEvents));
    }

    // (c) Неизвестный адрес раздела — «Такой страницы нет» в макете.
    await page.goto(`${BASE}/settings/does-not-exist`, { waitUntil: "domcontentloaded", timeout: 180000 });
    await page.waitForSelector('[data-access-denied="not-found"]', { timeout: 120000 });
    check("AC6 неизвестный адрес: панель внутри макета", await page.isVisible("[data-app-sidebar]"));
    check("AC6 подсказка «меню слева»", await page.isVisible('[data-menu-hint="sidebar"]'));
    await page.screenshot({ path: shot("c-not-found.png") });

    // (AC3) Раздел без своего loading.tsx: переход показывает скелет.
    await page.goto(`${BASE}/home`, { waitUntil: "domcontentloaded", timeout: 180000 });
    await page.waitForSelector("[data-home-page]", { timeout: 120000 });
    await page.evaluate(() => {
      window.__skeleton = false;
      new MutationObserver(() => {
        if (document.querySelector("[data-page-skeleton]")) window.__skeleton = true;
      }).observe(document.body, { childList: true, subtree: true });
    });
    const cdpNav = await throttle(page);
    // Клиентский переход через роутер Next (пункт главного меню).
    await page.click('[data-app-sidebar] [data-nav-section="monitoring"]');
    await page.waitForURL((url) => url.pathname.startsWith("/monitoring"), { timeout: 180000 });
    await cdpNav.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    check("AC3 переход в «Мониторинг» — со скелетом", await page.evaluate(() => window.__skeleton));
    check("(a) без ошибок страницы", errors.length === 0, errors.slice(0, 3).join(" | "));
    await ctx.close();
  }

  // ---- (b) Заведующая на странице руководства (admin.full) -------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await login(page, "dk-chef@test.local");
    const response = await page.goto(`${BASE}/settings/organization`, { waitUntil: "domcontentloaded", timeout: 180000 });
    await page.waitForSelector('[data-access-denied="forbidden"]', { timeout: 120000 });
    check("AC4 «Нет доступа» внутри макета, сайдбар на месте", await page.isVisible("[data-app-sidebar]"));
    check("AC4 подсказка «меню слева» на компьютере", await page.isVisible('[data-menu-hint="sidebar"]'));
    check("AC4 адрес не подменён редиректом", new URL(page.url()).pathname === "/settings/organization", page.url());
    check("AC4 статус ответа", [200, 403].includes(response?.status() ?? 0), String(response?.status()));
    const home = await page.getAttribute("[data-access-home]", "href");
    check("AC4 «На главную» — домашняя человека", home === "/home", String(home));
    await page.screenshot({ path: shot("b-forbidden-desktop.png") });
    // Телефон: подсказка про ☰.
    await page.setViewportSize({ width: 390, height: 844 });
    check("AC4 на телефоне — «откройте меню ☰»", await page.isVisible('[data-menu-hint="burger"]'));
    await page.screenshot({ path: shot("b-forbidden-phone.png") });
    await ctx.close();
  }

  // ---- (d) Тихий редирект proxy — объяснение один раз ------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await login(page, "dk-admin5@test.local");
    await page.goto(`${BASE}/settings/organization`, { waitUntil: "domcontentloaded", timeout: 180000 });
    await page.waitForSelector("[data-denied-notice]", { timeout: 120000 });
    const landed = new URL(page.url());
    check("AC8 руководитель точки: увели на «Сегодня»", landed.pathname === "/dashboard", page.url());
    const text = (await page.textContent("[data-denied-notice]"))?.trim() ?? "";
    check("AC8 плашка называет раздел", text.includes("закрыт для вашей роли"), text);
    await page.waitForFunction(() => !new URLSearchParams(location.search).has("denied"), null, { timeout: 30000 });
    check("AC8 метка убрана из адреса", !new URL(page.url()).searchParams.has("denied"), page.url());
    await page.screenshot({ path: shot("d-notice-site.png") });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("main", { timeout: 120000 });
    await page.waitForTimeout(1500);
    check("AC8 после обновления плашки нет", !(await page.isVisible("[data-denied-notice]")));
    await ctx.close();

    const cookCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const cook = await cookCtx.newPage();
    await login(cook, "dk-cook@test.local");
    // Proxy → «Журналы» → (у повара нет журналов) «Сегодня» приложения: метка
    // едет дальше, на «Журналах» плашка не мелькает.
    let flashedOnJournals = false;
    cook.on("framenavigated", async (frame) => {
      if (frame !== cook.mainFrame() || !frame.url().includes("/journals")) return;
      flashedOnJournals ||= Boolean(await cook.$("[data-denied-notice]").catch(() => null));
    });
    await cook.goto(`${BASE}/settings/users`, { waitUntil: "domcontentloaded", timeout: 180000 });
    await cook.waitForURL((url) => url.pathname === "/mini/today", { timeout: 180000 });
    await cook.waitForSelector("[data-denied-notice]", { timeout: 120000 });
    check("AC8 повар: «Сегодня» приложения объясняет отказ", new URL(cook.url()).pathname === "/mini/today", cook.url());
    await cook.waitForFunction(() => !new URLSearchParams(location.search).has("denied"), null, { timeout: 30000 });
    check("AC8 повар: метка убрана", !new URL(cook.url()).searchParams.has("denied"), cook.url());
    check("AC8 повар: на «Журналах» плашка не мелькала", !flashedOnJournals);
    await cook.screenshot({ path: shot("d-notice-cook.png") });
    // Регрессия: «Журналы» — домашняя повара по роли, не «Нет доступа».
    await cook.goto(`${BASE}/journals`, { waitUntil: "domcontentloaded", timeout: 180000 });
    await cook.waitForURL((url) => url.pathname === "/mini/today", { timeout: 180000 });
    check("AC7 повар на «Журналах» уходит на «Сегодня», а не застревает на «Нет доступа»", true, cook.url());
    await cookCtx.close();
  }

  // ---- (e) Оболочка Mini App ------------------------------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await login(page, "dk-chef@test.local");
    // Куку оболочки ставим после входа: вход сайта её снимает.
    await ctx.addCookies([{ name: "ws-shell", value: "mini", url: BASE }]);
    await page.goto(`${BASE}/settings/organization`, { waitUntil: "domcontentloaded", timeout: 180000 });
    await page.waitForSelector('[data-access-denied="forbidden"]', { timeout: 120000 });
    check(
      "AC4/П-3 Mini App: «Нет доступа» в оболочке приложения",
      (await page.$("#mini-root [data-access-denied]")) !== null && !(await page.isVisible("[data-app-sidebar]")),
    );
    check("AC4/П-3 Mini App: подсказка про меню приложения", await page.isVisible('[data-menu-hint="mini"]'));
    await page.screenshot({ path: shot("e-mini-forbidden.png") });
    await page.goto(`${BASE}/production-control/nope`, { waitUntil: "domcontentloaded", timeout: 180000 });
    await page.waitForSelector('[data-access-denied="not-found"]', { timeout: 120000 });
    check("AC6/П-3 Mini App: «Такой страницы нет» в оболочке", (await page.$("#mini-root [data-access-denied]")) !== null);
    await ctx.close();

    // Руководитель точки в оболочке: редирект proxy объясняется и в приложении.
    const pointCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const point = await pointCtx.newPage();
    await login(point, "dk-admin5@test.local");
    await pointCtx.addCookies([{ name: "ws-shell", value: "mini", url: BASE }]);
    await point.goto(`${BASE}/settings/subscription`, { waitUntil: "domcontentloaded", timeout: 180000 });
    await point.waitForSelector("#mini-root [data-denied-notice]", { timeout: 120000 });
    check("AC8/П-3 Mini App: плашка в оболочке приложения", await point.isVisible('#mini-root [data-menu-hint="mini"]'));
    await point.screenshot({ path: shot("e-mini-notice.png") });
    await pointCtx.close();
  }
} finally {
  await browser.close();
  writeFileSync(new URL("./e2e-results.json", import.meta.url), JSON.stringify(results, null, 2));
  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) process.exitCode = 1;
}
