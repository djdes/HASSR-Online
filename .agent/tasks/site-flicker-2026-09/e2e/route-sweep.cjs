// Обход разделов кабинета: какие медленные и что видно, пока грузятся.
//
// Для каждой страницы (group (dashboard), без динамических сегментов + журнал/документ из посева):
//  • время серверного ответа: полный GET HTML (второй, прогретый запрос);
//  • клиентский переход с /dashboard: prefetch (как у видимой ссылки) → router.push; по журналу
//    DOM на каждом кадре — когда сменился адрес, какой скелетон и сколько, сколько «пусто»
//    (адрес уже новый, скелетона нет, содержимого нет), когда появилось содержимое.
//
// Запуск: node .agent/tasks/site-flicker-2026-09/e2e/route-sweep.cjs --label before [--only /settings]
const { createRequire } = require("node:module");
const fs = require("node:fs");
const path = require("node:path");

const WT = "d:/wt/flicker";
const req = createRequire(path.join(WT, "package.json"));
const { chromium } = req("playwright-core");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const LABEL = arg("label", "run");
const BASE = arg("base", "http://localhost:3197");
const ONLY = arg("only", "");
const OUT = path.join("d:/wt/tmp-flicker", LABEL);
const SEED = JSON.parse(fs.readFileSync("d:/wt/tmp-flicker/seed.json", "utf8"));
const CHROME = path.join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1232/chrome-win64/chrome.exe");

function listRoutes() {
  const root = path.join(WT, "src/app/(dashboard)");
  const out = [];
  (function walk(dir, rel) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name), `${rel}/${e.name}`);
      else if (e.name === "page.tsx") out.push(rel || "/");
    }
  })(root, "");
  const routes = out
    .map((r) => r.replace(/\/\([^)]+\)/g, ""))
    .filter((r) => !r.includes("["))
    .sort();
  routes.push(`/journals/${SEED.journalCode}`, `/journals/${SEED.journalCode}/documents/${SEED.docId}`, `/journals/${SEED.journalCode}/new`);
  return routes.filter((r) => !ONLY || r.startsWith(ONLY));
}

function initProbe() {
  const probe = { samples: [], reset() { this.samples = []; } };
  window.__probe = probe;
  function contentLength(main) {
    if (!main) return -1;
    let n = main.textContent.length;
    for (const nav of main.querySelectorAll("nav")) n -= nav.textContent.length;
    return n;
  }
  function snap() {
    try {
      const main = document.querySelector("main");
      const busyEl = document.querySelector('main [aria-busy="true"], [aria-busy="true"][data-page-skeleton]');
      probe.samples.push({
        t: Math.round(performance.now()),
        p: location.pathname,
        sk: busyEl
          ? ((busyEl.querySelector(".sr-only") || {}).textContent || "busy").slice(0, 40) +
            (busyEl.getAttribute("data-page-skeleton") ? `#${busyEl.getAttribute("data-page-skeleton")}` : "")
          : null,
        h1: Boolean(main && main.querySelector("h1")),
        ml: contentLength(main),
        spin: Boolean(main && main.querySelector(".animate-spin")),
      });
    } catch {}
    requestAnimationFrame(snap);
  }
  requestAnimationFrame(snap);
  try {
    localStorage.setItem("wesetup-theme-mode", "light");
    localStorage.setItem("wesetup-theme-auto-schedule", "0");
  } catch {}
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const routes = listRoutes();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--use-gl=swiftshader"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "ru-RU", colorScheme: "light" });
  await context.addInitScript(initProbe);
  const csrf = await (await context.request.get(`${BASE}/api/auth/csrf`)).json();
  await context.request.post(`${BASE}/api/auth/callback/credentials`, {
    form: { csrfToken: csrf.csrfToken, email: SEED.owner, password: SEED.password, json: "true", callbackUrl: `${BASE}/dashboard` },
    maxRedirects: 0,
  });
  const page = await context.newPage();
  const rows = [];
  for (const route of routes) {
    const row = { route };
    try {
      // 1) Сервер: два GET подряд, берём второй (первый прогревает кеши процесса).
      let ms = null;
      let status = null;
      let finalUrl = null;
      for (let i = 0; i < 2; i++) {
        const t0 = Date.now();
        const r = await context.request.get(`${BASE}${route}`, { maxRedirects: 5, timeout: 60000 });
        await r.body();
        ms = Date.now() - t0;
        status = r.status();
        finalUrl = new URL(r.url()).pathname;
      }
      row.serverMs = ms;
      row.status = status;
      row.finalPath = finalUrl;
      // 2) Клиентский переход с дашборда.
      await page.goto(`${BASE}/dashboard`, { waitUntil: "load", timeout: 120000 });
      await page.waitForTimeout(800);
      await page.evaluate((r) => window.next.router.prefetch(r), route).catch(() => {});
      await page.waitForTimeout(1200);
      const fromT = await page.evaluate((r) => {
        window.__probe.reset();
        const t = Math.round(performance.now());
        window.next.router.push(r);
        return t;
      }, route);
      await page.waitForTimeout(3500);
      const samples = await page.evaluate(() => window.__probe.samples);
      const s = samples.filter((x) => x.t >= fromT);
      const target = finalUrl;
      const dur = (i) => (i + 1 < s.length ? s[i + 1].t - s[i].t : 16);
      let urlAt = null;
      let contentAt = null;
      let blank = 0;
      let blankRun = 0;
      let blankMax = 0;
      let spinMs = 0;
      const sk = [];
      for (let i = 0; i < s.length; i++) {
        const x = s[i];
        const at = x.p === target;
        if (at && urlAt === null) urlAt = x.t - fromT;
        const content = x.h1 || x.ml > 300;
        if (at && !x.sk && content && contentAt === null) contentAt = x.t - fromT;
        if (x.sk) {
          const last = sk[sk.length - 1];
          if (last && last.sk === x.sk) last.ms += dur(i);
          else sk.push({ sk: x.sk, atMs: x.t - fromT, ms: dur(i) });
        }
        if (at && !x.sk && !content) {
          blankRun += dur(i);
          blank += dur(i);
          blankMax = Math.max(blankMax, blankRun);
          if (x.spin) spinMs += dur(i);
        } else blankRun = 0;
      }
      Object.assign(row, { urlAtMs: urlAt, contentAtMs: contentAt, blankMs: blank, blankMaxMs: blankMax, spinnerOnlyMs: spinMs, skeletons: sk, finalMl: s.length ? s[s.length - 1].ml : null });
    } catch (e) {
      row.error = String(e && e.message).slice(0, 200);
    }
    rows.push(row);
    console.log(
      `${route.padEnd(58)} srv ${String(row.serverMs).padStart(5)}ms ${row.status} url ${String(row.urlAtMs).padStart(5)} content ${String(row.contentAtMs).padStart(5)} blank ${String(row.blankMaxMs).padStart(4)} spin ${String(row.spinnerOnlyMs).padStart(4)} ` +
        (row.skeletons && row.skeletons.length ? row.skeletons.map((x) => `${x.sk.replace(/^Загружаем /, "").slice(0, 22)}+${x.ms}`).join(">") : "") +
        (row.finalPath && row.finalPath !== row.route ? ` → ${row.finalPath}` : "") +
        (row.error ? ` ERR ${row.error}` : ""),
    );
    fs.writeFileSync(path.join(OUT, "route-sweep.json"), JSON.stringify(rows, null, 2));
  }
  await browser.close();
})();
