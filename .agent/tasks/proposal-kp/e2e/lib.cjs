// Общие помощники e2e задачи proposal-kp.
// Dev-сервер :3192 (NEXT_DIST_DIR=.next-e2e, из d:/wt/kp), база wesetup_wt_kp, SMTP выключен.
// Выхлоп — вне проекта (d:/wt/tmp-kp/e2e): любая запись в .agent/ пересобирает dev-сервер.
const { createRequire } = require("node:module");
const fs = require("node:fs");
const path = require("node:path");

const WT = "d:/wt/kp";
const req = createRequire(path.join(WT, "package.json"));
const { chromium } = req("playwright-core");
const { Client } = req("pg");

const BASE = process.env.E2E_BASE || "http://localhost:3192";
const OUT = process.env.E2E_OUT || "d:/wt/tmp-kp/e2e";
const EVID = path.join(OUT, "evidence");
const RAW = path.join(OUT, "raw");
const CREDS = path.join(OUT, "creds.json");
const DB = "postgresql://postgres:postgres@localhost:5432/wesetup_wt_kp?sslmode=disable";

for (const dir of [EVID, RAW]) fs.mkdirSync(dir, { recursive: true });

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
    args: ["--no-sandbox", "--use-gl=swiftshader", "--lang=ru-RU"],
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
  const csrf = await (await context.request.get(`${BASE}/api/auth/csrf`, { timeout: 300000 })).json();
  const res = await context.request.post(`${BASE}/api/auth/callback/credentials`, {
    form: { csrfToken: csrf.csrfToken, email, password, json: "true", callbackUrl: `${BASE}/root` },
    maxRedirects: 0,
    timeout: 300000,
  });
  const cookies = await context.cookies();
  return { status: res.status(), session: cookies.some((c) => c.name.includes("session-token")) };
}

async function newContext(browser, viewport, options = {}) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    locale: "ru-RU",
    reducedMotion: "reduce",
    colorScheme: options.colorScheme || "light",
    acceptDownloads: true,
  });
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("wesetup.last-seen-build-sha", "e2e");
      window.localStorage.setItem("wesetup-theme-auto-schedule", "0");
      window.localStorage.setItem("wesetup-theme-mode", "light");
      window.localStorage.setItem("wesetup.cookie-consent", "1");
    } catch {}
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal{display:none!important}";
      document.head.appendChild(style);
    });
  });
  return context;
}

async function waitHydrated(page, selector, timeout = 300000) {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return Boolean(el && Object.keys(el).some((k) => k.startsWith("__reactProps")));
    },
    selector,
    { timeout },
  );
}

/** Открыть страницу и дождаться элемента (dev-сервер компилирует маршрут при первом заходе). */
async function open(page, url, selector, hydrate = false) {
  await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 300000 });
  await page.waitForSelector(selector, { timeout: 300000 });
  if (hydrate) await waitHydrated(page, selector);
  await page.waitForTimeout(1200);
}

function norm(text) {
  return String(text ?? "").replace(/[\u00a0\u202f]/g, " ").replace(/\s+/g, " ").trim();
}

function readCreds() {
  return JSON.parse(fs.readFileSync(CREDS, "utf8"));
}

module.exports = { WT, BASE, OUT, EVID, RAW, CREDS, DB, launch, sql, login, newContext, waitHydrated, open, norm, readCreds };
