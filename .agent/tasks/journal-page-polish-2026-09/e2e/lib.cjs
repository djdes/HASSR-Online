// Общие помощники e2e задачи journal-page-polish-2026-09.
// Dev-сервер :3143 (NEXT_DIST_DIR=.next-e2e), база wesetup_wt_jpage, фиктивный токен Telegram.
// Прогон пишет в OUT (вне проекта: dev-сервер пересобирается на любую запись в .agent/),
// в папку задачи — копия после.
const { createRequire } = require("node:module");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const WT = "C:/wt/jpage";
const req = createRequire(path.join(WT, "package.json"));
const { chromium, webkit } = req("playwright-core");
const { Client } = req("pg");

const BASE = process.env.E2E_BASE || "http://localhost:3143";
const HERE = __dirname;
// По умолчанию — временная папка системы: вне проекта (запись в .agent/ пересобирает dev-сервер)
// и вне git (state-*.json — куки сессий).
const OUT = process.env.E2E_OUT || path.join(os.tmpdir(), "journal-page-polish-e2e");
const CREDS = path.join(HERE, "creds.json");
const DB = "postgresql://postgres:postgres@localhost:5432/wesetup_wt_jpage?sslmode=disable";

// Сборка Chromium под playwright-core 1.59.1 (browsers.json → chromium 1217).
function browserPath(kind) {
  const root = path.join(process.env.LOCALAPPDATA, "ms-playwright");
  if (kind === "webkit") return path.join(root, "webkit-2272", "Playwright.exe");
  return path.join(root, "chromium-1217", "chrome-win64", "chrome.exe");
}

async function launch(kind = "chromium") {
  if (kind === "webkit") {
    return webkit.launch({ executablePath: browserPath("webkit"), headless: true });
  }
  return chromium.launch({
    executablePath: browserPath("chromium"),
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

function readCreds() {
  return JSON.parse(fs.readFileSync(CREDS, "utf8"));
}

/**
 * Вход через /api/auth/login (как форма входа). Лимит — 5 попыток за 5 минут
 * с одного IP, поэтому куки сохраняем в state-<role>.json и берём оттуда.
 */
async function loggedInState(browser, role) {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `state-${role}.json`);
  if (fs.existsSync(file)) return file;
  const creds = readCreds();
  const email = role === "cook" ? creds.cookEmail : creds.managerEmail;
  const ctx = await browser.newContext();
  const res = await ctx.request.post(`${BASE}/api/auth/login`, {
    data: { email, password: creds.password },
    timeout: 240000,
  });
  if (!res.ok()) throw new Error(`login ${role}: ${res.status()} ${await res.text()}`);
  await ctx.storageState({ path: file });
  await ctx.close();
  return file;
}

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

async function newContext(browser, viewport, role, extra = {}) {
  const phone = viewport.width < 640;
  return browser.newContext({
    viewport,
    deviceScaleFactor: phone ? 2 : 1,
    isMobile: phone,
    hasTouch: phone,
    locale: "ru-RU",
    reducedMotion: "reduce",
    storageState: await loggedInState(browser, role),
    ...extra,
  });
}

/** Без «Что нового» и без значка dev-сервера Next. */
async function quietPage(context, results) {
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
  });
  if (results) {
    page.on("pageerror", (err) => results.pageErrors.push(String(err && err.message).slice(0, 300)));
  }
  return page;
}

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

/** Dev-сервер иногда отдаёт недописанный чанк — перезагружаем, пока страница не оживёт. */
async function gotoHydrated(page, url, selector, attempts = 4) {
  await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 240000 });
  for (let i = 1; ; i += 1) {
    try {
      await waitHydrated(page, selector, 120000);
      break;
    } catch (err) {
      if (i >= attempts) throw err;
      await page.waitForTimeout(5000);
      await page.reload({ waitUntil: "domcontentloaded", timeout: 240000 });
    }
  }
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(800);
}

module.exports = {
  WT,
  BASE,
  OUT,
  CREDS,
  PHONE,
  DESKTOP,
  launch,
  sql,
  readCreds,
  loggedInState,
  newContext,
  quietPage,
  waitHydrated,
  gotoHydrated,
};
