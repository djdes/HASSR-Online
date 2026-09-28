// Общие помощники e2e задачи billing-cutover-2026-09.
// Dev-сервер :3171 (NEXT_DIST_DIR=.next-e2e), база wesetup_wt_billing, Telegram-токен фиктивный.
const { createRequire } = require("node:module");
const fs = require("node:fs");
const path = require("node:path");

const WT = "C:/wt/billing";
const req = createRequire(path.join(WT, "package.json"));
const { chromium } = req("playwright-core");
const { Client } = req("pg");
const bcrypt = req("bcryptjs");

const BASE = process.env.E2E_BASE || "http://localhost:3171";
// Прогон пишет вне проекта: dev-сервер пересобирается на любую запись в .agent/.
const OUT = process.env.E2E_OUT || "D:/wt-build/tmp-billing/out";
const SHOTS = path.join(OUT, "shots");
const CREDS = path.join(OUT, "creds.json");
const DB = "postgresql://postgres:postgres@localhost:5432/wesetup_wt_billing?sslmode=disable";

fs.mkdirSync(SHOTS, { recursive: true });

function envValue(key) {
  const text = fs.readFileSync(path.join(WT, ".env"), "utf8");
  const m = text.match(new RegExp(`^${key}=(.*)$`, "m"));
  return m ? m[1].trim().replace(/^"|"$/g, "") : "";
}

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
  return { status: res.status(), location: res.headers()["location"] ?? null, session: cookies.some((c) => c.name.includes("session-token")) };
}

/** Страница без посторонних окон; ошибки страниц — в results. */
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
  });
  if (results) {
    page.on("pageerror", (err) =>
      results.pageErrors.push({ page: label, message: String(err && err.message).slice(0, 300) }),
    );
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

/** Открыть страницу и дождаться, пока React оживит `selector` (с перезагрузкой при недописанном чанке). */
async function gotoHydrated(page, url, selector, attempts = 4) {
  await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 240000 });
  for (let i = 1; ; i += 1) {
    try {
      await waitHydrated(page, selector, 120000);
      return;
    } catch (err) {
      if (i >= attempts) throw err;
      await page.waitForTimeout(4000);
      await page.reload({ waitUntil: "domcontentloaded", timeout: 240000 });
    }
  }
}

async function shot(page, name) {
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

function readCreds() {
  return JSON.parse(fs.readFileSync(CREDS, "utf8"));
}

function hash(password) {
  return bcrypt.hashSync(password, 10);
}

module.exports = {
  WT,
  BASE,
  OUT,
  SHOTS,
  CREDS,
  envValue,
  launch,
  sql,
  login,
  quietPage,
  waitHydrated,
  gotoHydrated,
  shot,
  readCreds,
  hash,
};
