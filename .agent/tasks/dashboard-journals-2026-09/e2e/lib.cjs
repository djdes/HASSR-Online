// Общие помощники e2e задачи dashboard-journals-2026-09.
// Dev-сервер :3161 (NEXT_DIST_DIR=.next-e2e), база wesetup_wt_dash, фиктивный токен Telegram, SMTP пуст.
// Всё, что пишет прогон (снимки, логи, creds), — ВНЕ проекта (E2E_OUT, по умолчанию D:/wt-build/tmp-dash):
// dev-сервер следит за файлами проекта и пересобирается на любую запись в .agent/…
const { createRequire } = require("node:module");
const fs = require("node:fs");
const path = require("node:path");

const WT = "C:/wt/dash";
const req = createRequire(path.join(WT, "package.json"));
const { chromium } = req("playwright-core");
const { Client } = req("pg");

const BASE = process.env.E2E_BASE || "http://localhost:3161";
const TASK = path.join(WT, ".agent/tasks/dashboard-journals-2026-09");
const OUT = process.env.E2E_OUT || "D:/wt-build/tmp-dash";
const SHOTS = path.join(OUT, "shots");
const CREDS = path.join(OUT, "creds.json");
const DB = "postgresql://postgres:postgres@localhost:5432/wesetup_wt_dash?sslmode=disable";

/** Набор организации: 10 электронных журналов (5 заполнены сегодня), остальные отключены. */
const FILLED = ["hygiene", "cold_equipment_control", "climate_control", "fryer_oil", "cleaning"];
const UNFILLED = ["finished_product", "incoming_control", "perishable_rejection", "med_books", "general_cleaning"];
const ENABLED = [...FILLED, ...UNFILLED];

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };

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

function readCreds() {
  return JSON.parse(fs.readFileSync(CREDS, "utf8"));
}

/**
 * «Заполнено сегодня» считается по записям с createdAt в сегодняшних сутках
 * организации (Москва). Прогоны идут и около полуночи — поэтому записи
 * пересоздаются перед каждым прогоном: FILLED — есть запись сейчас, остальные — нет.
 */
async function resetToday(creds) {
  const ids = await sql('select id, code from "JournalTemplate" where code = any($1)', [FILLED]);
  await sql('delete from "JournalEntry" where "organizationId" = $1', [creds.organizationId]);
  for (const t of ids) {
    await sql(
      'insert into "JournalEntry" (id, "templateId", "organizationId", "filledById", data, status, "createdAt", "updatedAt") values ($1,$2,$3,$4,$5,$6,now(),now())',
      [`e2e${t.code.slice(0, 12)}${Date.now().toString(36)}`, t.id, creds.organizationId, creds.userId, JSON.stringify({ e2e: true }), "approved"],
    );
  }
  return ids.length;
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
 * Вход один раз, дальше — сохранённые куки (AUTH): вход по паролю ограничен
 * пятью попытками за 5 минут на почту (lib/rate-limit.ts), а каждый снимок —
 * новый контекст браузера.
 */
const AUTH = path.join(OUT, "auth.json");
async function authState(browser, creds) {
  if (fs.existsSync(AUTH)) return JSON.parse(fs.readFileSync(AUTH, "utf8"));
  const context = await browser.newContext();
  try {
    const auth = await login(context, creds.email, creds.password);
    if (!auth.session) throw new Error(`login failed: ${JSON.stringify(auth)}`);
    const state = await context.storageState();
    fs.writeFileSync(AUTH, JSON.stringify(state));
    return state;
  } finally {
    await context.close();
  }
}

/**
 * Контекст с темой: тема профиля в БД (сервер рисует data-app-theme) и те же
 * ключи в localStorage (клиент не переключает её обратно), «Что нового» прочитано,
 * значок dev-сервера Next спрятан. `extraStorage` — ключи localStorage до загрузки.
 */
async function themedContext(browser, device, theme, creds, extraStorage = {}) {
  await sql('update "User" set "themePreference" = $1 where id = $2', [theme, creds.userId]);
  const state = await authState(browser, creds);
  const context = await browser.newContext({ ...device, storageState: { cookies: state.cookies, origins: [] } });
  await context.addInitScript(
    ([t, extra]) => {
      try {
        localStorage.setItem("wesetup-app-theme", t);
        localStorage.setItem("wesetup-theme-mode", t);
        localStorage.setItem("wesetup-theme-auto-schedule", "0");
        localStorage.setItem("wesetup.last-seen-build-sha", "e2e");
        // Начальные ключи — один раз на вкладку: перезагрузка не должна
        // стирать то, что страница сохранила сама.
        if (!sessionStorage.getItem("__e2e_initial_storage")) {
          sessionStorage.setItem("__e2e_initial_storage", "1");
          for (const [k, v] of Object.entries(extra)) {
            if (v === null) localStorage.removeItem(k);
            else localStorage.setItem(k, v);
          }
        }
      } catch {}
      // Значок dev-сервера Next — с первого кадра (скелет снимается до DOMContentLoaded).
      const style = document.createElement("style");
      style.textContent = "nextjs-portal{display:none!important}";
      document.documentElement.appendChild(style);
    },
    [theme, extraStorage],
  );
  return context;
}

/** SSR-разметка видна раньше гидратации — кликать можно, когда React повесил обработчики. */
async function waitHydrated(page, selector, timeout = 240000) {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return Boolean(el && Object.keys(el).some((k) => k.startsWith("__react")));
    },
    selector,
    { timeout },
  );
}

/**
 * Переход и ожидание, пока страница успокоится: элемент есть, React его оживил
 * и `quietMs` не было новой загрузки документа (dev-сервер после компиляции
 * иногда перезагружает страницу сам). Недописанный чанк — перезагрузка.
 */
async function gotoSettled(page, url, selector, results, quietMs = 2000) {
  await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 240000 });
  if (new URL(page.url()).pathname.startsWith("/login")) {
    throw new Error(`не вошли: ${page.url()} — удалите ${AUTH} и повторите`);
  }
  for (let attempt = 1; ; attempt += 1) {
    try {
      let navigated = false;
      const onLoad = () => {
        navigated = true;
      };
      page.on("domcontentloaded", onLoad);
      try {
        await page.waitForSelector(selector, { timeout: 120000 });
        await waitHydrated(page, selector, 120000);
        await page.waitForTimeout(quietMs);
      } finally {
        page.off("domcontentloaded", onLoad);
      }
      if (!navigated) return;
      if (results) results.devReloads = (results.devReloads || 0) + 1;
    } catch (err) {
      if (attempt >= 4) throw err;
      if (results) results.devReloadRetries = (results.devReloadRetries || 0) + 1;
      await page.waitForTimeout(4000);
      await page.reload({ waitUntil: "domcontentloaded", timeout: 240000 });
    }
  }
}

/** Все картинки строк догружены (loading=lazy — прокручиваем к каждой). */
async function loadAllThumbs(page) {
  const handles = await page.$$("[data-journal-thumb] img");
  for (const h of handles) {
    await h.scrollIntoViewIfNeeded().catch(() => {});
  }
  await page.waitForFunction(
    () => [...document.querySelectorAll("[data-journal-thumb] img")].every((img) => img.complete),
    null,
    { timeout: 60000 },
  ).catch(() => {});
}

module.exports = {
  WT,
  BASE,
  TASK,
  OUT,
  SHOTS,
  CREDS,
  DB,
  FILLED,
  UNFILLED,
  ENABLED,
  PHONE,
  DESKTOP,
  launch,
  sql,
  readCreds,
  resetToday,
  login,
  themedContext,
  waitHydrated,
  gotoSettled,
  loadAllThumbs,
};
