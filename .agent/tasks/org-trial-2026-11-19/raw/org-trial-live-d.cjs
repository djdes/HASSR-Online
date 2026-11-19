// Live check of part 1 after the review fixes.
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const BASE = "http://localhost:3000";
const OUT = path.join(__dirname, "raw1");
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
    try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 160) }; }
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
const profile = (page, name, inn, phone) =>
  api(page, "POST", "/api/profile/complete", {
    organizationName: name, phone, sphere: "restaurant", ownershipKind: "private", locationsCount: 1, inn,
    name: "Проверка", newPassword: "Passw0rd-1", asEmployee: false,
  });
const shot = (page, name, opts = {}) => page.screenshot({ path: path.join(OUT, name), type: "jpeg", quality: 72, ...opts });
const open = async (page, url) => { await page.goto(`${BASE}${url}`, { waitUntil: "networkidle", timeout: 240000 }); await page.waitForTimeout(1500); };
const modal = (page) => page.locator('[data-testid="org-trial-lock-modal"]');
const trialEnd = (email) => sql(`select coalesce(to_char(a."trialEndsAt",'YYYY-MM-DD HH24:MI'),'null') from "Account" a join "User" u on u.id=a."ownerUserId" where u.email='${email}'`);

(async () => {
  const browser = await chromium.launch();
  try {
    const root = await login(browser, "root@local.test", process.env.ROOT_PASSWORD);

    // ---- 1. Account in its own trial creates a second organization, then buys ONE point.
    const email = `fix-${stamp}@example.com`;
    const owner = await register(browser, email);
    say("profile", (await profile(owner, "Пекарня Раз", "5001000010", "+79161110001")).status);
    const first = (await api(owner, "GET", "/api/organizations")).json.organizations[0];
    const second = await api(owner, "POST", "/api/organizations", { name: "Пекарня Два", sphere: "restaurant" });
    say("create 2nd in account trial", second.json);
    say("2nd trialEndsAt in db (UTC)", sql(`select to_char("trialEndsAt" at time zone 'UTC','YYYY-MM-DD HH24:MI:SS') from "Organization" where id='${second.json.organizationId}'`));
    await api(owner, "POST", "/api/me/active-organization", { organizationId: first.id });
    await owner.reload({ waitUntil: "networkidle" });
    const one = await api(owner, "POST", "/api/payments/invoice", { plan: "standard", cycle: "month", points: 1 });
    say("invoice for ONE point while 2nd is in its 14 days", { status: one.status, amountRub: one.json.amountRub, error: one.json.error });
    say("pay", (await api(root, "POST", `/api/root/orders/${one.json.orderId}/mark-paid`)).status);

    // ---- 2. The second organization's days are over: closed for everyone, server refuses journal writes.
    sql(`update "Organization" set "trialEndsAt" = now() - interval '2 days' where id='${second.json.organizationId}'`);
    await api(owner, "POST", "/api/me/active-organization", { organizationId: second.json.organizationId });
    await owner.waitForTimeout(31000); // lock cache lives half a minute
    await open(owner, "/dashboard");
    say("locked: modal", await modal(owner).count());
    say("locked: modal text", (await modal(owner).innerText().catch(() => "")).replace(/\n+/g, " | "));
    await shot(owner, "09-locked-with-delete-link.jpg");
    say("locked: POST /api/journals", await api(owner, "POST", "/api/journals", { templateCode: "hygiene", data: {} }));
    await open(owner, "/settings/organization");
    say("locked: /settings/organization modal hidden", (await modal(owner).count()) === 0);
    await open(owner, "/settings/subscription");
    say("locked: tariff points picker", {
      value: (await owner.locator('[data-testid="tariff-points-dec"]').locator("xpath=following-sibling::*[1]").innerText().catch(() => "?")).trim(),
      canDecrease: !(await owner.locator('[data-testid="tariff-points-dec"]').isDisabled().catch(() => true)),
    });
    await api(owner, "POST", "/api/me/active-organization", { organizationId: first.id });
    await owner.reload({ waitUntil: "networkidle" });
    say("preview with locked org", (await api(owner, "GET", "/api/organizations/creation-preview")).json);
    // The owner does not want it: request deletion → it no longer blocks.
    await api(owner, "POST", "/api/me/active-organization", { organizationId: second.json.organizationId });
    await owner.reload({ waitUntil: "networkidle" });
    say("request deletion of the locked org", (await api(owner, "POST", "/api/settings/organization/deletion", { confirmName: "Пекарня Два" })).status);
    await api(owner, "POST", "/api/me/active-organization", { organizationId: first.id });
    await owner.reload({ waitUntil: "networkidle" });
    say("preview after deletion request", (await api(owner, "GET", "/api/organizations/creation-preview")).json);

    // ---- 3. Repeated trial: INN alone flags, INN + phone ends.
    const oldEmail = `lapsed-${stamp}@example.com`;
    const old = await register(browser, oldEmail);
    say("lapsed account profile", (await profile(old, "Старый клиент", "5001000002", "+79162220002")).status);
    sql(`update "Account" set "createdAt" = now() - interval '40 days' where "ownerUserId" = (select id from "User" where email='${oldEmail}')`);

    const innOnlyEmail = `innonly-${stamp}@example.com`;
    const innOnly = await register(browser, innOnlyEmail);
    say("same INN (typed with spaces), other phone", (await profile(innOnly, "Чужой ИНН", "5001 000 002", "+79163330003")).json);
    say("  account trialEndsAt", trialEnd(innOnlyEmail));
    say("  audit", sql(`select action from "AuditLog" where action like 'billing.trial.reuse%' order by "createdAt" desc limit 1`));

    const bothEmail = `both-${stamp}@example.com`;
    const both = await register(browser, bothEmail);
    say("same INN and same phone", (await profile(both, "Тот же человек", "5001000002", "+79162220002")).json);
    say("  account trialEndsAt", trialEnd(bothEmail));
    say("  audit", sql(`select action, details::text from "AuditLog" where action like 'billing.trial.reuse%' order by "createdAt" desc limit 1`));
  } finally {
    fs.writeFileSync(path.join(OUT, "phaseD.log"), log.join("\n"));
    await browser.close();
  }
})().catch((error) => { console.error("FAILED", error); process.exit(1); });
