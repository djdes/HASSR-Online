// Общие помощники e2e задачи bzhgp (БЖГП: подпись комиссии = бракераж + 1 минута).
// Стенд: next dev --webpack -p 3195 из d:/wt/bzhgp, база wesetup_wt_bzhgp,
// SMTP пустой, Telegram-токен фиктивный.
const { createRequire } = require("node:module");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const WT = "d:/wt/bzhgp";
const req = createRequire(path.join(WT, "package.json"));
const { chromium } = req("playwright-core");
const { Client } = req("pg");
const bcrypt = req("bcryptjs");

const BASE = process.env.E2E_BASE || "http://localhost:3195";
// Выхлоп — вне проекта: next dev пересобирает страницы на любую запись в .agent/.
const OUT = process.env.E2E_OUT || "d:/wt/tmp-bzhgp/e2e-out";
const SHOTS = path.join(OUT, "shots");
const DB = "postgresql://postgres:postgres@localhost:5432/wesetup_wt_bzhgp?sslmode=disable";

fs.mkdirSync(SHOTS, { recursive: true });

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

/** Страница без посторонних окон (что нового, cookie, оверлей next dev). */
async function quietPage(context, label, results) {
  const page = await context.newPage();
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("wesetup.last-seen-build-sha", "e2e");
      window.localStorage.setItem("wesetup.cookie-consent", JSON.stringify({ accepted: true, at: Date.now() }));
    } catch {}
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal{display:none!important}";
      document.head.appendChild(style);
    });
  });
  if (results) {
    page.on("pageerror", (err) =>
      results.pageErrors.push({ page: label, message: String(err && err.message).slice(0, 300) })
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
    { timeout }
  );
}

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

async function shot(page, name, fullPage = false) {
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file, fullPage });
  return file;
}

function hash(password) {
  return bcrypt.hashSync(password, 10);
}

async function api(context, method, url, data, headers) {
  const res = await context.request.fetch(`${BASE}${url}`, {
    method,
    data,
    headers,
    timeout: 240000,
    maxRedirects: 0,
  });
  let body = null;
  try {
    body = await res.json();
  } catch {}
  return { status: res.status(), body, headers: res.headers() };
}

/** Помощник на tsx из рабочей копии (модули проекта: QR-токен, PDF, Word). */
function helper(args) {
  const res = spawnSync(
    process.execPath,
    [path.join(WT, "node_modules/tsx/dist/cli.mjs"), path.join(__dirname, "helpers.ts"), ...args],
    { cwd: WT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...envSecrets() } }
  );
  if (res.status !== 0) throw new Error(`helper ${args[0]} failed: ${res.stderr || res.stdout}`);
  return JSON.parse(res.stdout.trim().split(/\r?\n/).pop());
}

/** Секреты подписи из .env рабочей копии (база и прочее — не нужны). */
function envSecrets() {
  const out = {};
  for (const line of fs.readFileSync(path.join(WT, ".env"), "utf8").split(/\r?\n/)) {
    const m = /^(EQUIPMENT_QR_TOKEN_SECRET|NEXTAUTH_SECRET|TELEGRAM_LINK_TOKEN_SECRET)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  return out;
}

/** Сегодня и ISO для местного времени Москвы (UTC+3, без перехода на летнее). */
function moscowToday(at = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(at)
      .map((p) => [p.type, p.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function moscowIso(dateKey, hhmm) {
  return new Date(`${dateKey}T${hhmm}:00+03:00`).toISOString();
}
function moscowHhmm(iso) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit", hour12: false }).format(
    new Date(iso)
  );
}

module.exports = {
  WT,
  BASE,
  OUT,
  SHOTS,
  launch,
  sql,
  login,
  quietPage,
  waitHydrated,
  gotoHydrated,
  shot,
  hash,
  api,
  helper,
  moscowToday,
  moscowIso,
  moscowHhmm,
};
