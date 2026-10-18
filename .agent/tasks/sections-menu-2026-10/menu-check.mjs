// Проверка меню разделов в браузере: три роли × сайт (1440×900), телефон
// (390×800) и Mini App-оболочка (390×800, кука ws-shell=mini).
// Запуск из корня worktree: node .agent/tasks/sections-menu-2026-10/menu-check.mjs [base]
// Пишет скриншоты и results.json (с ROLES=… — results-<роли>.json) в raw/.
// Роли можно гонять параллельно: у ограничителя переходов бюджет на человека.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] || "http://localhost:3053";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(HERE, "raw");
fs.mkdirSync(RAW, { recursive: true });

async function launch() {
  try {
    return await chromium.launch({ args: ["--lang=ru-RU"] });
  } catch (error) {
    const base = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
    const dirs = fs.existsSync(base)
      ? fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d) || /^chromium_headless_shell-\d+$/.test(d))
      : [];
    dirs.sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
    for (const dir of dirs) {
      const exe = dir.startsWith("chromium_headless_shell")
        ? path.join(base, dir, "chrome-headless-shell-win64", "chrome-headless-shell.exe")
        : path.join(base, dir, "chrome-win64", "chrome.exe");
      if (fs.existsSync(exe)) return chromium.launch({ executablePath: exe, args: ["--lang=ru-RU"] });
    }
    throw error;
  }
}

const ROLES = [
  { id: "owner", title: "руководитель", email: "admin@haccp.local" },
  { id: "headchef", title: "заведующая", email: "chef@haccp.local" },
  { id: "cook", title: "повар", email: "hotcook1@haccp.local" },
];
const PASSWORD = "admin1234";

const results = { base: BASE, startedAt: new Date().toISOString(), roles: {} };
const problems = [];
function problem(text) {
  problems.push(text);
  console.log("  ✗", text);
}

async function signIn(page, email) {
  // Вход тем же запросом, что и форма (`/api/auth/login`): кука сессии
  // ложится в контекст браузера. Форма на dev-сервере до гидрации
  // отправлялась бы обычным GET.
  const res = await page.request.post(`${BASE}/api/auth/login`, {
    data: { email, password: PASSWORD },
    timeout: 600_000,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok() || body?.requiresCode) throw new Error(`вход ${email}: HTTP ${res.status()} ${JSON.stringify(body)}`);
  await goto(page, "/dashboard");
}

/** Ошибки страницы (упала в error boundary, исключение в браузере) — тоже проблема. */
function watchErrors(page, roleId) {
  page.on("pageerror", (error) => problem(`${roleId} ${page.url()}: pageerror ${error.message.slice(0, 160)}`));
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().startsWith("[app-error]")) problem(`${roleId} ${page.url()}: ${message.text().slice(0, 160)}`);
  });
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  // Демо-пользователь ещё не принял новую редакцию оферты — модалка
  // «Мы обновили условия» закрывает экран. Принимаем, как человек.
  const terms = page.locator("div.fixed").filter({ hasText: "Мы обновили условия" }).last();
  if (await terms.isVisible().catch(() => false)) {
    await terms.locator('input[type="checkbox"]').first().check().catch(() => {});
    await terms.getByRole("button", { name: "Принять и продолжить" }).click().catch(() => {});
    await page.waitForTimeout(1_500);
  }
  // Закрыть «Что нового», если всплыло.
  for (let i = 0; i < 2; i++) {
    const dialog = page.locator('[role="dialog"]').first();
    if (await dialog.isVisible().catch(() => false)) {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(300);
    }
  }
  await page.waitForTimeout(400);
}

// Ограничитель переходов (`page-navigation-limit.ts`): headless-браузеру —
// не больше 6 страниц за 10 с и 30 в минуту. Ходим не чаще раза в 2,6 с, а
// на 429 ждём Retry-After и повторяем — ограничитель не обходим.
let lastNavigation = 0;
async function throttle() {
  const wait = lastNavigation + 2_600 - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastNavigation = Date.now();
}

async function goto(page, href) {
  let response = null;
  for (let attempt = 0; attempt < 3; attempt++) {
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

async function desktop(browser, role) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
  const page = await context.newPage();
  watchErrors(page, role.id);
  await signIn(page, role.email);
  const out = { sections: {}, home: page.url() };
  await settle(page);
  const sidebar = page.locator("[data-app-sidebar]");
  if (!(await sidebar.isVisible().catch(() => false))) {
    out.sidebar = false;
    await page.screenshot({ path: path.join(RAW, `desktop-${role.id}-home.png`) });
    await context.close();
    return out;
  }
  out.sidebar = true;
  // «‹ Главное меню» → девять (или сколько видно роли) разделов.
  const back = sidebar.locator("button[data-back-to-main]");
  if (await back.isVisible().catch(() => false)) {
    await back.click();
    await page.waitForTimeout(400);
  }
  const keys = await sidebar.locator("[data-nav-section]").evaluateAll((els) =>
    els.filter((el) => el.closest("[inert]") === null).map((el) => ({ key: el.getAttribute("data-nav-section"), href: el.getAttribute("href"), label: el.textContent.trim() })),
  );
  out.mainMenu = keys;
  await page.screenshot({ path: path.join(RAW, `desktop-${role.id}-main-menu.png`) });

  for (const { key, href, label } of keys) {
    // Вход в раздел — нажатием в главном меню.
    await goto(page, "/dashboard");
    const backBtn = sidebar.locator("button[data-back-to-main]");
    if (await backBtn.isVisible().catch(() => false)) {
      await backBtn.click();
      await page.waitForTimeout(400);
    }
    await sidebar.locator(`[data-nav-section="${key}"]`).filter({ visible: true }).first().click();
    await page.waitForURL((url) => url.pathname === href || url.pathname.startsWith(href), { timeout: 600_000 }).catch(() => {});
    const attached = await sidebar
      .waitFor({ state: "attached", timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    if (!attached) {
      // Переход нажатием упёрся в ограничитель (страница «Небольшая пауза») —
      // ждём паузу и открываем раздел адресом, с повтором на 429.
      console.log(`  … ${key}: после нажатия нет сайдбара (${await page.title()}), пауза и повтор`);
      await new Promise((resolve) => setTimeout(resolve, 31_000));
      await goto(page, href);
      await sidebar.waitFor({ state: "attached", timeout: 120_000 });
    }
    await settle(page);
    const mode = await sidebar.getAttribute("data-sidebar-mode", { timeout: 120_000 });
    const menu = await sidebar.locator(`nav[data-section-menu="${key}"] [data-menu-item]`).evaluateAll((els) =>
      els.map((el) => ({ id: el.getAttribute("data-menu-item"), href: el.getAttribute("href"), label: el.textContent.trim(), current: el.getAttribute("aria-current") === "page" })),
    );
    const brand = await sidebar.locator('[data-sidebar-logo]').filter({ visible: true }).first().innerText().catch(() => "");
    const h1 = await page.locator("main h1").first().innerText().catch(() => "");
    out.sections[key] = { label, href, mode, brand, h1, items: menu, pages: {} };
    console.log(`  ${role.id} ${key}: mode=${mode} items=${menu.map((m) => m.id).join(",")} h1=${h1}`);
    if (key === "more") {
      if (mode === "section") problem(`${role.id}/${key}: у «Остального» не должно быть своего меню`);
    } else {
      if (mode !== "section") problem(`${role.id}/${key}: левое меню не сменилось (mode=${mode})`);
      if (menu.length === 0) problem(`${role.id}/${key}: в меню раздела нет пунктов`);
    }
    await page.screenshot({ path: path.join(RAW, `desktop-${role.id}-${key}.png`) });

    // Каждый пункт открывает свою страницу и подсвечивается.
    for (const item of menu) {
      const response = await goto(page, item.href);
      const status = response?.status() ?? 0;
      const finalPath = new URL(page.url()).pathname;
      const active = await sidebar
        .locator(`nav[data-section-menu="${key}"] [data-menu-item="${item.id}"]`)
        .getAttribute("aria-current", { timeout: 30_000 })
        .catch(() => null);
      await sidebar.waitFor({ state: "attached", timeout: 600_000 }).catch(() => {});
      const pageMode = await sidebar.getAttribute("data-sidebar-mode", { timeout: 60_000 }).catch(() => null);
      const title = await page.locator("main h1").first().innerText().catch(() => "");
      out.sections[key].pages[item.id] = { href: item.href, status, finalPath, active, mode: pageMode, h1: title };
      if (status >= 400) problem(`${role.id}/${key}/${item.id}: ${item.href} → HTTP ${status}`);
      if (finalPath !== item.href) problem(`${role.id}/${key}/${item.id}: ${item.href} увёл на ${finalPath}`);
      if (active !== "page") problem(`${role.id}/${key}/${item.id}: пункт не подсвечен на своей странице`);
      if (pageMode !== "section") problem(`${role.id}/${key}/${item.id}: на странице пункта меню раздела не показано`);
    }
  }
  await context.close();
  return out;
}

async function phone(browser, role, sections, mini) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 800 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "ru-RU",
  });
  const page = await context.newPage();
  watchErrors(page, role.id);
  await signIn(page, role.email);
  if (mini) {
    await context.addCookies([{ name: "ws-shell", value: "mini", url: BASE }]);
  }
  const out = {};
  const tag = mini ? "mini" : "mobile";
  if (!sections.length) {
    await goto(page, "/dashboard");
    out.burger = await page.locator("[data-nav-burger]").isVisible().catch(() => false);
    out.menuButton = await page.locator("[data-section-menu-button]").isVisible().catch(() => false);
    if (out.burger || out.menuButton) problem(`${role.id}/${tag}: у роли без меню видна кнопка меню`);
    await page.screenshot({ path: path.join(RAW, `${tag}-${role.id}-home.png`) });
    await context.close();
    return out;
  }
  for (const { key, href } of sections) {
    await goto(page, href);
    // Сама страница раздела на телефоне — без открытого меню.
    await page.screenshot({ path: path.join(RAW, `${tag}-${role.id}-${key}-page.png`) });
    if (mini) {
      const button = page.locator("[data-section-menu-button]");
      const visible = await button.isVisible().catch(() => false);
      if (!visible) {
        out[key] = { menuButton: false };
        if (key !== "more") problem(`${role.id}/mini/${key}: нет кнопки меню раздела`);
        await page.screenshot({ path: path.join(RAW, `${tag}-${role.id}-${key}.png`) });
        continue;
      }
      await button.click();
      await page.waitForTimeout(600);
      const sheet = page.locator("[data-mini-menu-mode]");
      const items = await sheet.locator("[data-menu-item]").evaluateAll((els) => els.map((el) => el.getAttribute("data-menu-item")));
      const brand = await sheet.locator("[data-organization-brand]").count();
      await page.screenshot({ path: path.join(RAW, `${tag}-${role.id}-${key}.png`) });
      await sheet.locator("button[data-back-to-main]").click();
      await page.waitForTimeout(400);
      const main = await page.locator('[data-mini-menu-mode="main"] [data-nav-section]').count();
      if (key === sections[0].key) await page.screenshot({ path: path.join(RAW, `${tag}-${role.id}-main-menu.png`) });
      out[key] = { menuButton: true, items, brand, mainSections: main };
      if (!brand) problem(`${role.id}/mini/${key}: в листе нет логотипа`);
      if (main !== sections.length) problem(`${role.id}/mini/${key}: «Главное меню» показало ${main} разделов из ${sections.length}`);
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(300);
    } else {
      const burger = page.locator("[data-nav-burger]");
      await burger.click();
      await page.waitForTimeout(600);
      const nav = page.locator("[data-mobile-nav]");
      const mode = await nav.getAttribute("data-mobile-nav-mode");
      const items = await nav.locator("[data-menu-item]").evaluateAll((els) => els.map((el) => el.getAttribute("data-menu-item")));
      const brand = await nav.locator("[data-organization-brand]").count();
      await page.screenshot({ path: path.join(RAW, `${tag}-${role.id}-${key}.png`) });
      let main = null;
      if (mode === "section") {
        await nav.locator("button[data-back-to-main]").click();
        await page.waitForTimeout(400);
        main = await nav.locator("[data-nav-section]").count();
        if (key === sections[0].key) await page.screenshot({ path: path.join(RAW, `${tag}-${role.id}-main-menu.png`) });
      }
      out[key] = { mode, items, brand, mainSections: main };
      if (!brand) problem(`${role.id}/mobile/${key}: в листе нет логотипа`);
      if (key !== "more" && mode !== "section") problem(`${role.id}/mobile/${key}: лист открылся без меню раздела`);
      if (main !== null && main !== sections.length) problem(`${role.id}/mobile/${key}: «Главное меню» показало ${main} из ${sections.length}`);
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(300);
    }
  }
  await context.close();
  return out;
}

const only = process.env.ROLES ? process.env.ROLES.split(",") : null;
const RESULTS_FILE = only ? `results-${only.join("-")}.json` : "results.json";
const browser = await launch();
try {
  for (const role of ROLES) {
    if (only && !only.includes(role.id)) continue;
    console.log(`== ${role.title} (${role.email})`);
    const desk = await desktop(browser, role);
    const sections = (desk.mainMenu ?? []).map(({ key, href }) => ({ key, href }));
    const mobile = await phone(browser, role, sections, false);
    const mini = await phone(browser, role, sections, true);
    results.roles[role.id] = { desktop: desk, mobile, mini };
    fs.writeFileSync(path.join(RAW, RESULTS_FILE), JSON.stringify({ ...results, problems }, null, 2));
  }
} finally {
  await browser.close();
}
results.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(RAW, RESULTS_FILE), JSON.stringify({ ...results, problems }, null, 2));
console.log(problems.length ? `ПРОБЛЕМ: ${problems.length}` : "OK: проблем нет");
process.exit(problems.length ? 1 : 0);
