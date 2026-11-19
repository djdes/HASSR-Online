// Live check of part 1, phase B: expiry → lock → pay → unlock; free plan; INN reuse.
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const BASE = "http://localhost:3000";
const OUT = path.join(__dirname, "raw1");
const ids = require("./raw1/ids.json");
const stamp = Date.now().toString(36);
const log = [];
const say = (label, value) => {
  const line = `${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`;
  log.push(line);
  console.log(line);
};
const sql = (query) =>
  execSync(`su postgres -c "psql -d haccp_online -tA -F '|' -c \\"${query.replace(/"/g, '\\\\\\"')}\\""`, { encoding: "utf8" }).trim();
async function api(page, method, url, body) {
  return page.evaluate(async ({ method, url, body }) => {
    const res = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
    return { status: res.status, json };
  }, { method, url, body });
}
async function register(browser, email) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ru-RU" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/register`, { waitUntil: "networkidle", timeout: 240000 });
  await page.fill("#register-email", email);
  await page.check('[data-testid="legal-consent"]');
  await page.waitForTimeout(2500);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/home/, { timeout: 240000 });
  return page;
}
async function login(browser, email, password) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ru-RU" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 240000 });
  await page.fill('input[type="email"], input[name="email"], #email', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !/\/login/.test(url.pathname), { timeout: 240000 });
  return page;
}
const shot = (page, name, opts = {}) => page.screenshot({ path: path.join(OUT, name), type: "jpeg", quality: 72, ...opts });
const open = async (page, url) => { await page.goto(`${BASE}${url}`, { waitUntil: "networkidle", timeout: 240000 }); await page.waitForTimeout(1500); };
const modal = (page) => page.locator('[data-testid="org-trial-lock-modal"]');

(async () => {
  const browser = await chromium.launch();
  try {
    // ---- free plan: no second organization
    sql(`update "PlatformSetting" set value = jsonb_set(value::jsonb, '{launchedAt}', to_jsonb('2026-08-01T00:00:00.000Z'::text))::text where key='billing.trial'`);
    const freeEmail = `free-${stamp}@example.com`;
    const free = await register(browser, freeEmail);
    await api(free, "POST", "/api/profile/complete", {
      organizationName: "Бывший клиент", phone: "+79995556677", sphere: "restaurant", ownershipKind: "private",
      locationsCount: 1, inn: "7728168971", name: "Бывший", newPassword: "Passw0rd-1", asEmployee: false,
    });
    sql(`update "Account" set "createdAt" = now() - interval '40 days' where "ownerUserId" = (select id from "User" where email='${freeEmail}')`);
    say("free account: preview", (await api(free, "GET", "/api/organizations/creation-preview")).json);
    say("free account: create 2nd", await api(free, "POST", "/api/organizations", { name: "Вторая даром", sphere: "restaurant" }));

    // ---- the same INN in a fresh account: its trial ends
    const againEmail = `again-${stamp}@example.com`;
    const again = await register(browser, againEmail);
    const before = sql(`select coalesce(to_char(a."trialEndsAt",'YYYY-MM-DD HH24:MI'),'null') from "Account" a join "User" u on u.id=a."ownerUserId" where u.email='${againEmail}'`);
    const saved = await api(again, "POST", "/api/profile/complete", {
      organizationName: "Тот же ИНН", phone: "+79997778899", sphere: "restaurant", ownershipKind: "private",
      locationsCount: 1, inn: "7728168971", name: "Снова", newPassword: "Passw0rd-1", asEmployee: false,
    });
    say("same INN: profile response", saved);
    say("same INN: account trialEndsAt before → after", `${before} → ${sql(`select coalesce(to_char(a."trialEndsAt",'YYYY-MM-DD HH24:MI'),'null') from "Account" a join "User" u on u.id=a."ownerUserId" where u.email='${againEmail}'`)}`);
    say("same INN: audit", sql(`select action, details::text from "AuditLog" where action='billing.trial.inn_reused' order by "createdAt" desc limit 1`));
    await open(again, "/dashboard");
    say("same INN: tariff window shown", await again.locator('[data-testid="billing-transition-modal"]').count());
    await shot(again, "07-same-inn-trial-ended.jpg");

    // A different INN in a fresh account keeps its trial.
    const cleanEmail = `clean-${stamp}@example.com`;
    const clean = await register(browser, cleanEmail);
    say("other INN: profile response", await api(clean, "POST", "/api/profile/complete", {
      organizationName: "Новый клиент", phone: "+79990001122", sphere: "restaurant", ownershipKind: "private",
      locationsCount: 1, inn: "7707083893", name: "Новый", newPassword: "Passw0rd-1", asEmployee: false,
    }));
    say("other INN: account trialEndsAt", sql(`select coalesce(to_char(a."trialEndsAt",'YYYY-MM-DD'),'null') from "Account" a join "User" u on u.id=a."ownerUserId" where u.email='${cleanEmail}'`));
  } finally {
    fs.writeFileSync(path.join(OUT, "phaseC.log"), log.join("\n"));
    await browser.close();
  }
})().catch((error) => { console.error("FAILED", error); process.exit(1); });
