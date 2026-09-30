// Общие помощники e2e задачи orgsw (переключатель организаций, бейдж, перевод организации в партнёрский
// кабинет и обратно). Dev-сервер :3196 (NEXT_DIST_DIR=.next-e2e), база wesetup_wt_orgsw. Робокасса —
// фиктивный тестовый магазин в env процесса dev-сервера (ROBOKASSA_IS_TEST=1 и фиктивные пароли, боевые ключи
// не используются); любые запросы браузера к *.robokassa.ru перехватываются (скрипт — abort, переход на форму
// оплаты — заглушка). Оплату подтверждаем как касса: POST на наш ResultURL /payment с подписью фиктивным
// паролем №2 — как в promo-personal.
const { createRequire } = require("node:module");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const WT = "d:/wt/orgsw";
const req = createRequire(path.join(WT, "package.json"));
const { chromium } = req("playwright-core");
const { Client } = req("pg");

const BASE = process.env.E2E_BASE || "http://localhost:3196";
// Прогон пишет вне проекта: любой файл в .agent/… — пересборка dev-сервера.
const OUT = process.env.E2E_OUT || "d:/wt/tmp-orgsw";
const EVID = path.join(OUT, "evidence");
const RAW = path.join(OUT, "raw");
const CREDS = path.join(OUT, "creds.json");
const SERVER_LOG = path.join(OUT, "dev-server.log");
const DB = "postgresql://postgres:postgres@localhost:5432/wesetup_wt_orgsw?sslmode=disable";
// Тот же фиктивный пароль №2, что в env dev-сервера (ROBOKASSA_TEST_PASSWORD2).
const FAKE_PASSWORD2 = "orgsw-fake-pass-2";

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
 * Контекст браузера: Робокасса перехвачена, значок dev-сервера спрятан, тема светлая. Свой
 * X-Forwarded-For — лимитеры по IP считают каждый контекст отдельным клиентом.
 */
let clientSeq = 0;
async function newContext(browser, viewport, robokassa = []) {
  clientSeq += 1;
  const ip = `10.${Math.floor(Date.now() / 65536) % 250}.${Math.floor(Date.now() / 256) % 250}.${clientSeq % 250}`;
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    locale: "ru-RU",
    reducedMotion: "reduce",
    hasTouch: viewport.width < 500,
    isMobile: viewport.width < 500,
    extraHTTPHeaders: { "X-Forwarded-For": ip },
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  await context.route(/robokassa\.ru/i, async (route) => {
    robokassa.push(route.request().url());
    if (route.request().resourceType() === "document") {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: '<!doctype html><meta charset="utf-8"><h1 id="rk-stub">Робокасса (заглушка e2e)</h1>',
      });
    } else {
      await route.abort();
    }
  });
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("wesetup-theme-auto-schedule", "0");
      window.localStorage.setItem("wesetup-theme-mode", "light");
    } catch {}
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal{display:none!important}";
      document.head.appendChild(style);
    });
  });
  return context;
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

/** Открыть страницу и дождаться, пока она успокоится (dev-сервер после компиляции иногда перезагружает). */
async function open(page, url, selector, results, quietMs = 2000) {
  let navigated = false;
  const onLoad = () => {
    navigated = true;
  };
  await page.goto(url.startsWith("http") ? url : `${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 300000 });
  page.on("domcontentloaded", onLoad);
  try {
    for (let i = 0; i < 6; i += 1) {
      navigated = false;
      try {
        await page.waitForSelector(selector, { timeout: 240000 });
        await waitHydrated(page, selector, 120000);
      } catch (err) {
        if (i >= 3) throw err;
        if (results) results.devReloads = (results.devReloads || 0) + 1;
        await page.waitForTimeout(4000);
        await page.reload({ waitUntil: "domcontentloaded", timeout: 300000 });
        continue;
      }
      await page.waitForTimeout(quietMs);
      if (!navigated) return;
      if (results) results.devReloads = (results.devReloads || 0) + 1;
    }
    throw new Error(`страница не успокоилась: ${url} ${selector}`);
  } finally {
    page.off("domcontentloaded", onLoad);
  }
}

function md5(value) {
  return crypto.createHash("md5").update(value, "utf8").digest("hex");
}

/** Текст без неразрывных пробелов — для сравнений «1 990 ₽». */
function norm(text) {
  return String(text ?? "").replace(/[\u00a0\u202f]/g, " ").replace(/\s+/g, " ").trim();
}

function readCreds() {
  return JSON.parse(fs.readFileSync(CREDS, "utf8"));
}

/** Подтверждение оплаты «от кассы»: ResultURL с подписью тестовым паролем №2. */
async function payResult(request, invId, outSum) {
  const res = await request.post(`${BASE}/payment`, {
    form: { OutSum: outSum, InvId: String(invId), SignatureValue: md5(`${outSum}:${invId}:${FAKE_PASSWORD2}`) },
    timeout: 300000,
  });
  return { status: res.status(), body: (await res.text()).trim() };
}

module.exports = {
  WT,
  BASE,
  OUT,
  EVID,
  RAW,
  CREDS,
  SERVER_LOG,
  FAKE_PASSWORD2,
  launch,
  sql,
  login,
  newContext,
  waitHydrated,
  open,
  md5,
  norm,
  readCreds,
  payResult,
};
