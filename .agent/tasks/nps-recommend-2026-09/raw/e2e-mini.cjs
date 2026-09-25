const { createRequire } = require("node:module");
const fs = require("node:fs");
const path = require("node:path");
const WT = "C:/wt/qrforms";
const req = createRequire(path.join(WT, "package.json"));
const { chromium } = req("playwright-core");
const { Client } = req("pg");
const BASE = "http://localhost:3042";
const EVID = path.join(WT, ".agent/tasks/nps-recommend-2026-09/evidence");
const CHROME = path.join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1232/chrome-win64/chrome.exe");
const env = Object.fromEntries(fs.readFileSync(path.join(WT, ".env"), "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
(async () => {
  const c = new Client({ connectionString: "postgresql://postgres:postgres@localhost:5432/wesetup_wt_qrforms?sslmode=disable" });
  await c.connect();
  await c.query('update "User" set "npsAskedAt"=null where email=$1', ["admin@haccp.local"]);
  await c.end();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, locale: "ru-RU" });
    const csrf = await (await ctx.request.get(`${BASE}/api/auth/csrf`)).json();
    await ctx.request.post(`${BASE}/api/auth/callback/credentials`, { form: { csrfToken: csrf.csrfToken, email: "admin@haccp.local", password: env.ADMIN_PASSWORD, json: "true" }, maxRedirects: 0 });
    const page = await ctx.newPage();
    const res = await page.goto(`${BASE}/mini`, { waitUntil: "domcontentloaded", timeout: 240000 });
    console.log("mini status", res.status(), page.url());
    const banner = page.getByTestId("nps-banner");
    const found = await banner.waitFor({ timeout: 90000 }).then(() => true).catch(() => false);
    console.log("mini banner found", found);
    if (found) {
      await page.waitForFunction(() => { const el = document.querySelector('[data-testid="nps-score-4"]'); return Boolean(el && Object.keys(el).some((k) => k.startsWith("__reactProps"))); }, null, { timeout: 180000 });
      const saved = page.waitForResponse((r) => r.url().endsWith("/api/nps") && r.request().method() === "POST", { timeout: 120000 });
      await page.getByTestId("nps-score-4").click();
      await saved;
      await page.getByTestId("nps-recommend-form").waitFor();
      await page.waitForTimeout(400);
      await banner.screenshot({ path: path.join(EVID, "mini-390-recommend-form.png") });
      const lines = await page.evaluate(() => { const t = document.querySelector('[data-testid="nps-title"]'); const r = document.createRange(); r.selectNodeContents(t); return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size; });
      console.log("mini title lines", lines);
      await page.getByTestId("nps-close").click();
    } else {
      await page.screenshot({ path: path.join(SPDIR(), "mini-probe.png") }).catch(() => null);
    }
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
function SPDIR() { return path.dirname(__filename); }
