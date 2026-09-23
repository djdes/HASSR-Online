// Смоук вкладок точек (location-tabs-2026-09) на своей организации e2e-org-loc.
// Перед запуском: npx tsx .agent/tasks/location-tabs-2026-09/e2e/setup.ts
// Запуск: npx tsx .agent/tasks/location-tabs-2026-09/e2e/smoke.ts
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const BASE = process.env.E2E_BASE ?? "http://localhost:3025";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SHOTS = path.join(HERE, "..", "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const state = JSON.parse(fs.readFileSync(path.join(HERE, "state.json"), "utf8"));

const PAGES = ["/dashboard", "/journals", "/journals/hygiene", "/settings/users"];
const WIDTHS = [360, 390, 768, 1280];
const THEMES = ["light", "dark"] as const;

const results: Array<{ id: string; name: string; ok: boolean; details?: unknown }> = [];
const errors: string[] = [];
function check(id: string, name: string, ok: boolean, details?: unknown) {
  results.push({ id, name, ok, details });
  console.log(`${ok ? "PASS" : "FAIL"} [${id}] ${name}${details ? " " + JSON.stringify(details) : ""}`);
}

function watchErrors(page: Page, label: string) {
  page.on("pageerror", (error) => errors.push(`${label} pageerror: ${String(error).slice(0, 300)}`));
}

async function makeContext(browser: Browser, width: number, theme: "light" | "dark", storage?: string) {
  const mobile = width < 768;
  const context = await browser.newContext({
    viewport: { width, height: mobile ? 844 : 900 },
    isMobile: mobile,
    hasTouch: mobile,
    deviceScaleFactor: mobile ? 2 : 1,
    storageState: storage,
  });
  await context.addInitScript(
    `try{localStorage.setItem("wesetup-theme-mode",${JSON.stringify(theme)});localStorage.setItem("wesetup-app-theme",${JSON.stringify(theme)});localStorage.setItem("wesetup-theme-auto-schedule","0")}catch(e){}
     document.addEventListener("DOMContentLoaded",function(){var s=document.createElement("style");s.textContent="nextjs-portal{display:none!important}";document.head.appendChild(s)})`,
  );
  return context;
}

async function login(browser: Browser, email: string): Promise<string> {
  const context = await makeContext(browser, 1280, "light");
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
  const file = path.join(HERE, `storage-${email.split("@")[0]}.json`);
  await context.storageState({ path: file });
  await context.close();
  return file;
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
    .click({ timeout: 1_500 })
    .catch(() => {});
}

async function open(page: Page, url: string) {
  await page.goto(`${BASE}${url}`, { waitUntil: "load", timeout: 600_000 });
  await page.locator("main, #mini-root").first().waitFor({ timeout: 120_000 });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => null);
  await page.waitForTimeout(700);
  await dismissOverlays(page);
}

type Measure = {
  vw: number;
  scrollW: number;
  tabs: number;
  tabLabels: string[];
  active: string | null;
  counters: string[];
  navTop: number | null;
  crumbsTop: number | null;
  stripScrollable: boolean;
  headerPill: number;
  headerHeight: number | null;
  firstInPage: boolean | null;
};

async function measure(page: Page): Promise<Measure> {
  return page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>('nav[aria-label="Точки"]');
    const buttons = nav ? Array.from(nav.querySelectorAll<HTMLButtonElement>("button")) : [];
    const scroller = buttons[0]?.parentElement ?? null;
    const crumbs = document.querySelector<HTMLElement>('nav[aria-label="Хлебные крошки"]');
    const header = document.querySelector<HTMLElement>("header");
    // Первый видимый блок страницы дашборда (space-y-5 контейнер).
    let firstInPage: boolean | null = null;
    if (nav && location.pathname === "/dashboard") {
      const container = nav.parentElement;
      const visible = container
        ? Array.from(container.children).filter((el) => {
            const r = (el as HTMLElement).getBoundingClientRect();
            return r.height > 0 && r.width > 0;
          })
        : [];
      firstInPage = visible[0] === nav;
    }
    return {
      vw: window.innerWidth,
      scrollW: document.documentElement.scrollWidth,
      tabs: buttons.length,
      tabLabels: buttons.map((b) => b.title),
      active: buttons.find((b) => b.getAttribute("aria-current"))?.title ?? null,
      counters: buttons.map((b) => b.querySelector("span[aria-label]")?.textContent ?? ""),
      navTop: nav ? Math.round(nav.getBoundingClientRect().top) : null,
      crumbsTop: crumbs ? Math.round(crumbs.getBoundingClientRect().top) : null,
      stripScrollable: scroller ? scroller.scrollWidth > scroller.clientWidth : false,
      headerPill:
        document.querySelectorAll('[data-tour="location-switcher"]').length +
        (header ? header.querySelectorAll('[aria-label^="Точка:"]').length : 0),
      headerHeight: header ? Math.round(header.getBoundingClientRect().height) : null,
      firstInPage,
    };
  });
}

function shotName(pageUrl: string, width: number, theme: string) {
  const slug = pageUrl.replace(/^\//, "").replace(/\//g, "-") || "root";
  return path.join(SHOTS, `${slug}-${width}-${theme}.png`);
}

async function matrix(browser: Browser, storage: string) {
  const expected = state.buildings.map((b: { expected: string }) => b.expected);
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      const context = await makeContext(browser, width, theme, storage);
      const page = await context.newPage();
      watchErrors(page, `${theme}-${width}`);
      for (const url of PAGES) {
        await open(page, url);
        const m = await measure(page);
        const where = `${url} ${width} ${theme}`;
        check("AC1", `${where}: нет горизонтального выезда`, m.scrollW <= m.vw, { scrollW: m.scrollW, vw: m.vw });
        check("AC1", `${where}: строка «Точки» с 3 вкладками`, m.tabs === 3, { tabs: m.tabs });
        check("AC3", `${where}: в шапке нет пилюли точки`, m.headerPill === 0, { headerPill: m.headerPill });
        if (width < 768) check("AC3", `${where}: шапка без второй строки (≈72px)`, (m.headerHeight ?? 0) <= 80, { headerHeight: m.headerHeight });
        if (url === "/dashboard") {
          check("AC2", `${where}: вкладки первым блоком`, m.firstInPage === true);
          check("AC2", `${where}: счётчики ${expected.join(", ")}`, JSON.stringify(m.counters) === JSON.stringify(expected), { counters: m.counters });
          const old = await page.locator('section[aria-label="Сводка по точкам"]').count();
          check("AC2", `${where}: старого блока «Точки сегодня» нет`, old === 0);
        } else if (m.crumbsTop !== null) {
          check("AC1", `${where}: вкладки над крошками`, (m.navTop ?? 9999) < m.crumbsTop, { navTop: m.navTop, crumbsTop: m.crumbsTop });
        }
        await page.screenshot({ path: shotName(url, width, theme) });
      }
      await context.close();
    }
  }
}

async function activeName(page: Page) {
  return page.locator('nav[aria-label="Точки"] button[aria-current]').getAttribute("title");
}

async function switching(browser: Browser, storage: string) {
  const context = await makeContext(browser, 390, "light", storage);
  const page = await context.newPage();
  watchErrors(page, "switch");
  const names = state.buildings.map((b: { name: string; address: string | null }) =>
    b.address ? `${b.name}, ${b.address}` : b.name,
  );

  // С /journals: на вторую точку.
  await open(page, "/journals");
  const before = await activeName(page);
  await page.locator(`nav[aria-label="Точки"] button[title="${names[1]}"]`).click();
  await page.waitForFunction(
    (title) => document.querySelector('nav[aria-label="Точки"] button[aria-current]')?.getAttribute("title") === title,
    names[1],
    { timeout: 60_000 },
  );
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(800);
  const afterJournals = await activeName(page);
  check("AC3", "переключение с /journals: после reload активна вторая точка", afterJournals === names[1], { before, afterJournals });
  await page.screenshot({ path: path.join(SHOTS, "switch-journals-390.png") });

  // С /dashboard: на третью точку; сводка дашборда — уже для неё (0 из 4).
  await open(page, "/dashboard");
  const subtitleBefore = await page.getByText(/Есть запись за сегодня: \d+ из \d+/).first().textContent();
  await page.locator(`nav[aria-label="Точки"] button[title="${names[2]}"]`).click();
  await page.waitForFunction(
    (title) => document.querySelector('nav[aria-label="Точки"] button[aria-current]')?.getAttribute("title") === title,
    names[2],
    { timeout: 60_000 },
  );
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(800);
  const afterDashboard = await activeName(page);
  const subtitleAfter = await page.getByText(/Есть запись за сегодня: \d+ из \d+/).first().textContent();
  check("AC3", "переключение с /dashboard: после reload активна третья точка", afterDashboard === names[2], { afterDashboard });
  check(
    "AC3",
    "данные дашборда для новой точки: «2 из 4» → «0 из 4»",
    /2 из 4/.test(subtitleBefore ?? "") && /0 из 4/.test(subtitleAfter ?? ""),
    { subtitleBefore, subtitleAfter },
  );
  // Активная вкладка прокручена в видимую часть строки.
  const inView = await page.evaluate(() => {
    const btn = document.querySelector<HTMLElement>('nav[aria-label="Точки"] button[aria-current]');
    const box = btn?.parentElement;
    if (!btn || !box) return false;
    const b = btn.getBoundingClientRect();
    const s = box.getBoundingClientRect();
    return b.left >= s.left - 1 && b.right <= s.right + 1;
  });
  check("AC1", "активная вкладка прокручена в видимую часть строки", inView);
  await page.screenshot({ path: path.join(SHOTS, "switch-dashboard-390.png") });

  // Вернуть первую точку — чтобы повторный прогон начинался одинаково.
  await page.locator(`nav[aria-label="Точки"] button[title="${names[0]}"]`).click();
  await page.waitForFunction(
    (title) => document.querySelector('nav[aria-label="Точки"] button[aria-current]')?.getAttribute("title") === title,
    names[0],
    { timeout: 60_000 },
  );
  await context.close();
}

async function noTabs(browser: Browser, email: string, label: string) {
  const storage = await login(browser, email);
  const context = await makeContext(browser, 390, "light", storage);
  const page = await context.newPage();
  watchErrors(page, label);
  for (const url of ["/dashboard", "/journals"]) {
    await open(page, url);
    const m = await measure(page);
    check("AC5", `${label} ${url}: вкладок нет`, m.tabs === 0 && (await page.locator('nav[aria-label="Точки"]').count()) === 0);
    check("AC5", `${label} ${url}: пилюли в шапке нет`, m.headerPill === 0);
  }
  await page.screenshot({ path: path.join(SHOTS, `${label}-journals-390.png`) });
  await context.close();
}

async function mini(browser: Browser, storage: string) {
  for (const theme of THEMES) {
    const context: BrowserContext = await makeContext(browser, 390, theme, storage);
    await context.addCookies([{ name: "ws-shell", value: "mini", url: BASE }]);
    const page = await context.newPage();
    watchErrors(page, `mini-${theme}`);
    await open(page, "/dashboard");
    const shell = await page.evaluate(() => document.getElementById("mini-root") !== null);
    const m = await measure(page);
    const overflow = await page.evaluate(() => {
      const nav = document.querySelector<HTMLElement>('nav[aria-label="Точки"]');
      if (!nav) return null;
      const r = nav.getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right), vw: window.innerWidth };
    });
    check("AC6", `Mini App ${theme}: /dashboard в оболочке`, shell);
    check("AC6", `Mini App ${theme}: вкладки со счётчиками`, m.tabs === 3 && m.counters.every(Boolean), { counters: m.counters });
    check(
      "AC6",
      `Mini App ${theme}: ничего не переполняется на 390`,
      m.scrollW <= m.vw && !!overflow && overflow.left >= 0 && overflow.right <= overflow.vw,
      { scrollW: m.scrollW, vw: m.vw, overflow },
    );
    await page.screenshot({ path: path.join(SHOTS, `mini-dashboard-390-${theme}.png`) });
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const storage = await login(browser, state.users.manager.email);
    const only = process.env.ONLY;
    if (!only || only === "matrix") await matrix(browser, storage);
    if (!only || only === "switch") await switching(browser, storage);
    if (!only || only === "none") {
      await noTabs(browser, state.users.managerOne.email, "one-point");
      await noTabs(browser, state.users.managerOff.email, "points-off");
    }
    if (!only || only === "mini") await mini(browser, storage);
  } finally {
    await browser.close();
    for (const f of fs.readdirSync(HERE)) if (f.startsWith("storage-")) fs.rmSync(path.join(HERE, f));
  }
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(
    path.join(HERE, `smoke-result${process.env.ONLY ? "-" + process.env.ONLY : ""}.json`),
    JSON.stringify({ at: new Date().toISOString(), total: results.length, failed: failed.length, errors, results }, null, 2),
  );
  console.log(`\nИТОГО: ${results.length - failed.length}/${results.length} PASS, ошибок страницы: ${errors.length}`);
  for (const e of errors.slice(0, 10)) console.log(" ", e);
  process.exit(failed.length ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
