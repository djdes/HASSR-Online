// Общие помощники e2e задачи price-promotions-2026-09.
// Dev-сервер :3172 (NEXT_DIST_DIR=.next-e2e), база wesetup_wt_promos, Робокасса — фиктивный
// тестовый магазин в env процесса dev-сервера; любые запросы к *.robokassa.ru перехватываются
// (скрипт iFrame — abort, переход на форму оплаты — заглушка), наружу ничего не уходит.
const { createRequire } = require("node:module");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const WT = "C:/wt/promos";
const req = createRequire(path.join(WT, "package.json"));
const { chromium } = req("playwright-core");
const { Client } = req("pg");

const BASE = process.env.E2E_BASE || "http://localhost:3172";
const TASK = path.join(WT, ".agent/tasks/price-promotions-2026-09");
// Прогон пишет вне проекта: любой файл в .agent/… — пересборка dev-сервера.
const OUT = process.env.E2E_OUT || "D:/wt-build/tmp-promos";
const EVID = path.join(OUT, "evidence");
const RAW = path.join(OUT, "raw");
const CREDS = path.join(OUT, "creds.json");
const DB = "postgresql://postgres:postgres@localhost:5432/wesetup_wt_promos?sslmode=disable";
// Тот же фиктивный пароль №2, что в env dev-сервера (ROBOKASSA_TEST_PASSWORD2).
const FAKE_PASSWORD2 = "e2e-fake-pass-2";

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
 * Контекст браузера: Робокасса перехвачена, «Что нового» прочитано, значок
 * dev-сервера Next спрятан. `robokassa` копит перехваченные адреса.
 */
let clientSeq = 0;
async function newContext(browser, viewport, robokassa = [], options = {}) {
  const theme = options.theme || "light";
  // Свой X-Forwarded-For на контекст: лимитеры по IP (10 заказов / 20 проверок кода
  // за 10 минут) считают каждый контекст отдельным клиентом, повторный прогон не
  // упирается в 429.
  clientSeq += 1;
  const ip = `10.${(Date.now() >> 16) % 250}.${(Date.now() >> 8) % 250}.${clientSeq % 250}`;
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    locale: "ru-RU",
    // Без анимаций появления секций: снимки не ловят карточку на середине въезда.
    reducedMotion: "reduce",
    extraHTTPHeaders: { "X-Forwarded-For": ip },
  });
  await context.route(/robokassa\.ru/i, async (route) => {
    const url = route.request().url();
    robokassa.push(url);
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
  await context.addInitScript((mode) => {
    try {
      window.localStorage.setItem("wesetup.last-seen-build-sha", "e2e");
      // Публичные страницы вечером сами уходят в ночную тему — фиксируем выбранную.
      window.localStorage.setItem("wesetup-theme-auto-schedule", "0");
      window.localStorage.setItem("wesetup-theme-mode", mode);
    } catch {}
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal{display:none!important}";
      document.head.appendChild(style);
    });
  }, theme);
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

/**
 * Открыть страницу и дождаться, пока она успокоится: элемент есть, React его
 * оживил, `quietMs` не было новой загрузки документа (dev-сервер после
 * компиляции маршрута иногда перезагружает страницу сам).
 */
async function open(page, url, selector, results, quietMs = 2000) {
  let navigated = false;
  const onLoad = () => {
    navigated = true;
  };
  await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 300000 });
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

/** Текст без неразрывных пробелов — для сравнений «1 592 ₽». */
function norm(text) {
  return String(text ?? "").replace(/[\u00a0\u202f]/g, " ").replace(/\s+/g, " ").trim();
}

function readCreds() {
  return JSON.parse(fs.readFileSync(CREDS, "utf8"));
}

module.exports = {
  WT,
  BASE,
  TASK,
  OUT,
  EVID,
  RAW,
  CREDS,
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
};
