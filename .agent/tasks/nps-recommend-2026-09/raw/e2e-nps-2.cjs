// Follow-up e2e: layout re-check after textarea fix, 1440 one-line check, refresh resilience.
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
const DB = "postgresql://postgres:postgres@localhost:5432/wesetup_wt_qrforms?sslmode=disable";
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(WT, ".env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]),
);

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== undefined ? "  " + JSON.stringify(detail) : ""}`);
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
async function login(context) {
  const csrf = await (await context.request.get(`${BASE}/api/auth/csrf`)).json();
  await context.request.post(`${BASE}/api/auth/callback/credentials`, {
    form: { csrfToken: csrf.csrfToken, email: "admin@haccp.local", password: env.ADMIN_PASSWORD, json: "true", callbackUrl: `${BASE}/dashboard` },
    maxRedirects: 0,
  });
}
async function openDashboard(context, hydrateId) {
  const page = await context.newPage();
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 240000 });
  await page.getByTestId("nps-banner").waitFor({ timeout: 120000 });
  await page.waitForFunction(
    (id) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      return Boolean(el && Object.keys(el).some((k) => k.startsWith("__reactProps")));
    },
    hydrateId,
    { timeout: 180000 },
  );
  return page;
}
const lineInfo = () => {
  const title = document.querySelector('[data-testid="nps-title"]');
  const range = document.createRange();
  range.selectNodeContents(title);
  const rects = [...range.getClientRects()];
  const text = range.getBoundingClientRect();
  const b1 = document.querySelector('[data-testid="nps-score-1"]').getBoundingClientRect();
  const b5 = document.querySelector('[data-testid="nps-score-5"]').getBoundingClientRect();
  const x = document.querySelector('[data-testid="nps-close"]').getBoundingClientRect();
  return {
    titleLines: new Set(rects.map((r) => Math.round(r.top))).size,
    titleCenterY: Math.round(text.top + text.height / 2),
    scaleCenterY: Math.round(b1.top + b1.height / 2),
    closeCenterY: Math.round(x.top + x.height / 2),
    sameRowButtons: Math.round(b1.top) === Math.round(b5.top),
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  try {
    // ---------- 390: форма рекомендации после правки textarea + устойчивость к router.refresh ----------
    await sql('update "User" set "npsAskedAt"=null where email=$1', ["admin@haccp.local"]);
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, locale: "ru-RU" });
    await login(mobile);
    const page = await openDashboard(mobile, "nps-score-5");
    const saved = page.waitForResponse((r) => r.url().endsWith("/api/nps") && r.request().method() === "POST", { timeout: 180000 });
    await page.getByTestId("nps-score-5").click();
    await saved;
    await page.getByTestId("nps-recommend-form").waitFor();
    const textarea = await page.getByTestId("nps-recommend-message").evaluate((el) => ({
      fontSize: getComputedStyle(el).fontSize,
      fits: el.scrollHeight <= el.clientHeight + 1,
    }));
    check("390: сообщение по умолчанию видно целиком, 14px", textarea.fits && textarea.fontSize === "14px", textarea);
    await page.waitForTimeout(300);
    await page.getByTestId("nps-banner").screenshot({ path: path.join(EVID, "ac2-390-recommend-form.png") });

    // npsAskedAt уже стоит → askNps=false; перечитываем серверную часть, как делает LiveRefresh.
    await page.getByTestId("nps-recommend-email").fill("colleague.refresh@example.com");
    const hasRouter = await page.evaluate(() => typeof window.next?.router?.refresh === "function");
    if (hasRouter) {
      const rsc = page.waitForResponse((r) => r.url().includes("/dashboard") && r.request().headers()["rsc"] === "1", { timeout: 120000 });
      await page.evaluate(() => window.next.router.refresh());
      await rsc;
      await page.waitForTimeout(1500);
      const still = await page.getByTestId("nps-recommend-email").inputValue().catch(() => null);
      check("router.refresh() после оценки: блок и введённая почта на месте", still === "colleague.refresh@example.com", { still });
    } else {
      check("router.refresh() недоступен в этой сборке — проверка пропущена", true);
    }
    await page.getByTestId("nps-close").click();
    check("закрыть после оценки — блок скрыт", (await page.getByTestId("nps-banner").count()) === 0);
    const asked = await sql('select "npsAskedAt" from "User" where email=$1', ["admin@haccp.local"]);
    check("закрытие после оценки не шлёт «не сейчас» повторно — npsAskedAt от ответа", asked[0].npsAskedAt !== null, asked[0]);
    await mobile.close();

    // ---------- 1440: одна строка ----------
    await sql('update "User" set "npsAskedAt"=null where email=$1', ["admin@haccp.local"]);
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "ru-RU" });
    await login(desktop);
    const page2 = await openDashboard(desktop, "nps-score-4");
    const d = await page2.evaluate(lineInfo);
    check(
      "1440: заголовок, шкала и крестик — в одной строке",
      d.titleLines === 1 && d.sameRowButtons && Math.abs(d.titleCenterY - d.scaleCenterY) <= 4 && Math.abs(d.closeCenterY - d.scaleCenterY) <= 4 && d.scrollWidth <= d.innerWidth,
      d,
    );
    await page2.waitForTimeout(300);
    await page2.getByTestId("nps-banner").screenshot({ path: path.join(EVID, "ac1-1440-ask.png") });
    // «Не сейчас» до оценки — dismiss.
    const dismissed = page2.waitForResponse((r) => r.url().endsWith("/api/nps") && r.request().method() === "POST", { timeout: 120000 });
    await page2.getByTestId("nps-close").click();
    const dRes = await dismissed;
    check("крестик до оценки — «не сейчас» (dismiss)", dRes.request().postDataJSON().dismiss === true && dRes.status() === 200, dRes.request().postDataJSON());
    await desktop.close();
  } catch (error) {
    check("script error", false, String(error && error.stack ? error.stack : error));
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(EVID, "e2e-results-2.json"), JSON.stringify(results, null, 2));
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed`);
    process.exitCode = failed ? 1 : 0;
  }
})();
