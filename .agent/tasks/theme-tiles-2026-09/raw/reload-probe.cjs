// Проба «что происходит с темой при полной загрузке страницы».
// Выбор человека — «Тёмная» (localStorage + User.themePreference = dark), тема устройства — светлая.
// Пишет: смены data-app-theme у .app-shell (с DOMContentLoaded) и все POST /api/me/theme.
// Запуск (dev-сервер :3046): node .agent/tasks/theme-tiles-2026-09/raw/reload-probe.cjs <label>
const { createRequire } = require("node:module");
const path = require("node:path");
const fs = require("node:fs");

const WT = "C:/wt/theme";
const req = createRequire(path.join(WT, "package.json"));
const { chromium } = req("playwright-core");
const { Client } = req("pg");

const BASE = "http://localhost:3046";
const CHROME = path.join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1232/chrome-win64/chrome.exe");
const DB = "postgresql://postgres:postgres@localhost:5432/wesetup_wt_theme?sslmode=disable";
const OUT = path.join(WT, ".agent/tasks/theme-tiles-2026-09/raw/reload-probe.json");
const RUN = JSON.parse(fs.readFileSync(path.join(WT, ".agent/tasks/theme-tiles-2026-09/raw/e2e-results.json"), "utf8")).run;
const OWNER = `theme-owner-${RUN}@example.com`;
const PASSWORD = "ThemeTiles2026!";
const label = process.argv[2] || "run";

async function sql(text, params = []) {
  const c = new Client({ connectionString: DB });
  await c.connect();
  try {
    return (await c.query(text, params)).rows;
  } finally {
    await c.end();
  }
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--use-gl=swiftshader"] });
  let result;
  try {
    await sql('update "User" set "themePreference" = $1 where email = $2', ["dark", OWNER]);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", locale: "ru-RU" });
    const csrf = await (await ctx.request.get(`${BASE}/api/auth/csrf`)).json();
    await ctx.request.post(`${BASE}/api/auth/callback/credentials`, {
      form: { csrfToken: csrf.csrfToken, email: OWNER, password: PASSWORD, json: "true", callbackUrl: `${BASE}/dashboard` },
      maxRedirects: 0,
    });
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem("wesetup.last-seen-build-sha", "e2e");
        localStorage.setItem("wesetup-theme-mode", "dark");
        localStorage.setItem("wesetup-theme-auto-schedule", "0");
        localStorage.setItem("wesetup-app-theme", "dark");
      } catch {}
      window.__themeLog = [];
      const t0 = performance.now();
      document.addEventListener("DOMContentLoaded", () => {
        window.__themeLog.push(`dcl@${Math.round(performance.now() - t0)}:${document.querySelector(".app-shell")?.getAttribute("data-app-theme")}`);
      });
      new MutationObserver((muts) => {
        for (const m of muts) {
          if (m.target.classList && m.target.classList.contains("app-shell")) {
            window.__themeLog.push(`${Math.round(performance.now() - t0)}:${m.target.getAttribute("data-app-theme")}`);
          }
        }
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-app-theme"] });
    });
    const page = await ctx.newPage();
    const posts = [];
    page.on("request", (r) => {
      if (r.url().endsWith("/api/me/theme") && r.method() === "POST") posts.push(r.postDataJSON().theme);
    });
    await page.goto(`${BASE}/dashboard`, { waitUntil: "load", timeout: 240000 });
    await page.waitForTimeout(5000);
    const log = await page.evaluate(() => window.__themeLog);
    result = {
      label,
      at: new Date().toISOString(),
      themeChanges: log,
      lightWhileChoiceIsDark: log.filter((e) => e.endsWith(":light")).length,
      posts,
      final: await page.evaluate(() => document.querySelector(".app-shell").getAttribute("data-app-theme")),
      db: (await sql('select "themePreference" from "User" where email = $1', [OWNER]))[0].themePreference,
    };
  } catch (e) {
    result = { label, error: String(e.stack || e).slice(0, 1500) };
  } finally {
    await browser.close();
  }
  const all = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : [];
  all.push(result);
  fs.writeFileSync(OUT, JSON.stringify(all, null, 2));
  console.log(JSON.stringify(result));
})();
