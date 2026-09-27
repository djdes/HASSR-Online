// Общие помощники e2e задачи mini-theme-tiles-2026-09.
// Dev-сервер :3132 (NEXT_DIST_DIR=.next-e2e), база wesetup_wt_minitheme, фиктивный токен Telegram.
const { createRequire } = require("node:module");
const fs = require("node:fs");
const path = require("node:path");

const WT = "C:/wt/minitheme";
const req = createRequire(path.join(WT, "package.json"));
const { chromium } = req("playwright-core");
const { Client } = req("pg");

const BASE = process.env.E2E_BASE || "http://localhost:3132";
const TASK = path.join(WT, ".agent/tasks/mini-theme-tiles-2026-09");
// Куда писать снимки и результаты во время прогона. Dev-сервер следит за всеми
// файлами проекта: любой записанный файл в .agent/… — пересборка («[Fast Refresh]
// rebuilding»), посреди прогона это давало полные перезагрузки и недописанные чанки.
// Поэтому прогон пишет в E2E_OUT (вне проекта), а в папку задачи — копия после.
const OUT = process.env.E2E_OUT || TASK;
const EVID = path.join(OUT, "evidence");
const RAW = path.join(OUT, "raw");
const CREDS = path.join(TASK, "e2e/creds.json");
const DB = "postgresql://postgres:postgres@localhost:5432/wesetup_wt_minitheme?sslmode=disable";

function chromePath() {
  const root = path.join(process.env.LOCALAPPDATA, "ms-playwright");
  const dir = fs
    .readdirSync(root)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))[0];
  return path.join(root, dir, "chrome-win64/chrome.exe");
}

async function launch() {
  return chromium.launch({
    executablePath: chromePath(),
    headless: true,
    args: ["--no-sandbox", "--use-gl=swiftshader"],
  });
}

async function sql(text, params = []) {
  const c = new Client({ connectionString: DB });
  await c.connect();
  try {
    return (await c.query(text, params)).rows;
  } finally {
    await c.end();
  }
}

async function login(context, email, password) {
  const csrf = await (await context.request.get(`${BASE}/api/auth/csrf`, { timeout: 240000 })).json();
  const res = await context.request.post(`${BASE}/api/auth/callback/credentials`, {
    form: { csrfToken: csrf.csrfToken, email, password, json: "true", callbackUrl: `${BASE}/dashboard` },
    maxRedirects: 0,
    timeout: 240000,
  });
  const cookies = await context.cookies();
  return { status: res.status(), session: cookies.some((c) => c.name.includes("session-token")) };
}

/**
 * Страница без посторонних окон: «Что нового» помечено прочитанным, значок
 * dev-сервера Next спрятан. Журнал смен темы: что было на DOMContentLoaded и
 * каждое изменение data-theme / data-app-theme у #mini-root и .app-shell.
 */
async function quietPage(context, label, results) {
  const page = await context.newPage();
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("wesetup.last-seen-build-sha", "e2e");
    } catch {}
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal{display:none!important}";
      document.head.appendChild(style);
    });
    window.__themeFlips = [];
    const t0 = performance.now();
    const read = () => {
      const el = document.getElementById("mini-root") || document.querySelector(".app-shell");
      return el ? `${el.getAttribute("data-theme") ?? "-"}/${el.getAttribute("data-app-theme") ?? "-"}` : "none";
    };
    const push = (when) => {
      const v = read();
      const last = window.__themeFlips[window.__themeFlips.length - 1];
      if (!last || !last.endsWith("=" + v)) window.__themeFlips.push(`${when}=${v}`);
    };
    document.addEventListener("DOMContentLoaded", () => push(`dcl@${Math.round(performance.now() - t0)}`));
    new MutationObserver(() => push(String(Math.round(performance.now() - t0)))).observe(document, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-theme", "data-app-theme"],
    });
  });
  if (results) {
    page.on("pageerror", (err) =>
      results.pageErrors.push({ page: label, message: String(err && err.message).slice(0, 300) }),
    );
  }
  return page;
}

/** SSR-разметка видна раньше гидратации — кликать можно, когда React повесил обработчики. */
async function waitHydrated(page, selector, timeout = 240000) {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return Boolean(el && Object.keys(el).some((k) => k.startsWith("__reactProps")));
    },
    selector,
    { timeout },
  );
}

async function gotoHydrated(page, url, selector, results) {
  await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 240000 });
  await hydratedOrReload(page, selector, results);
}

/**
 * Dev-сервер иногда отдаёт недописанный чанк, пока компилирует другой
 * маршрут («Loading chunk app/layout failed») — тогда страница не оживает.
 * Перезагружаем до трёх раз, с паузой, чтобы сборка успела закончиться.
 */
async function hydratedOrReload(page, selector, results, attempts = 4) {
  for (let i = 1; ; i += 1) {
    try {
      await waitHydrated(page, selector, 90000);
      return;
    } catch (err) {
      if (i >= attempts) throw err;
      if (results) results.devReloadRetries = (results.devReloadRetries || 0) + 1;
      await page.waitForTimeout(5000);
      await page.reload({ waitUntil: "domcontentloaded", timeout: 240000 });
    }
  }
}

/**
 * Дождаться, пока страница успокоится: элемент есть, React его оживил и
 * `quietMs` не было навигации. Dev-сервер после компиляции маршрута иногда
 * перезагружает страницу сам («Fast Refresh had to perform a full reload»),
 * а оболочка приложения на широком экране снимает свою куку и тоже
 * перезагружает страницу.
 */
async function settle(page, selector, results, quietMs = 2500, timeout = 180000) {
  const end = Date.now() + timeout;
  let navigated = false;
  // Только загрузка нового документа: `history.replaceState` роутера Next
  // тоже даёт `framenavigated`, но страница при этом жива.
  const onLoad = () => {
    navigated = true;
  };
  page.on("domcontentloaded", onLoad);
  try {
    while (Date.now() < end) {
      navigated = false;
      await page.waitForSelector(selector, { timeout: 240000 });
      await waitHydrated(page, selector, 240000);
      await page.waitForTimeout(quietMs);
      if (!navigated) return;
      if (results) results.devReloads = (results.devReloads || 0) + 1;
    }
    throw new Error(`страница не успокоилась: ${selector}`);
  } finally {
    page.off("domcontentloaded", onLoad);
  }
}

function parseRgb(s) {
  const m = String(s).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const [r, g, b] = m[1].split(",").map((x) => parseFloat(x));
  return [r, g, b];
}
function luminance([r, g, b]) {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) {
  const pa = parseRgb(a);
  const pb = parseRgb(b);
  if (!pa || !pb) return null;
  const [x, y] = [luminance(pa), luminance(pb)].sort((p, q) => q - p);
  return Number(((x + 0.05) / (y + 0.05)).toFixed(2));
}

function readCreds() {
  return JSON.parse(fs.readFileSync(CREDS, "utf8"));
}

module.exports = {
  WT,
  BASE,
  TASK,
  EVID,
  RAW,
  CREDS,
  launch,
  sql,
  login,
  quietPage,
  waitHydrated,
  gotoHydrated,
  hydratedOrReload,
  settle,
  contrast,
  readCreds,
};
