// Live check of part 1: 14 days for additional organizations of an account.
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const BASE = "http://localhost:3000";
const OUT = path.join(__dirname, "raw1");
const stamp = Date.now().toString(36);
const EMAIL = `chain-${stamp}@example.com`;
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
const orgState = () => sql(`select o.name, coalesce(to_char(o."trialEndsAt",'YYYY-MM-DD'),'-'), a."planPoints", a."orgTrialsGranted" from "Organization" o join "Account" a on a.id=o."accountId" join "User" u on u.id=a."ownerUserId" where u.email='${EMAIL}' order by o."createdAt"`);

(async () => {
  const browser = await chromium.launch();
  try {
    const owner = await register(browser, EMAIL);
    say("registered", EMAIL);
    say("profile", await api(owner, "POST", "/api/profile/complete", {
      organizationName: "Кафе Первое", phone: "+79993334455", sphere: "restaurant", ownershipKind: "private",
      locationsCount: 1, inn: "7702070139", name: "Владелец Сети", newPassword: "Passw0rd-1", asEmployee: false,
    }));
    const first = (await api(owner, "GET", "/api/organizations")).json.organizations[0];

    // Account still in its own trial: preview says "account trial, own 14 days".
    say("preview in account trial", (await api(owner, "GET", "/api/organizations/creation-preview")).json);

    // Pay the tariff for one point.
    const invoice = await api(owner, "POST", "/api/payments/invoice", { plan: "standard", cycle: "month", points: 1 });
    const root = await login(browser, "root@local.test", process.env.ROOT_PASSWORD);
    say("pay 1 point", await api(root, "POST", `/api/root/orders/${invoice.json.orderId}/mark-paid`));
    say("preview paid, 1 point used", (await api(owner, "GET", "/api/organizations/creation-preview")).json);

    // Dialog with the preview line.
    await owner.goto(`${BASE}/settings/users`, { waitUntil: "networkidle", timeout: 240000 });
    const addButton = owner.getByRole("button", { name: /Добавить организацию/ }).first();
    if (await addButton.count()) {
      await addButton.click();
      await owner.waitForSelector('[data-testid="org-creation-preview"]', { timeout: 30000 }).catch(() => null);
      await shot(owner, "01-dialog-org-trial.jpg");
      say("dialog preview text", await owner.locator('[data-testid="org-creation-preview"]').innerText().catch(() => "(not found)"));
      await owner.keyboard.press("Escape");
    } else say("dialog", "button not found on /settings/users");

    const second = await api(owner, "POST", "/api/organizations", { name: "Кафе Второе", sphere: "restaurant" });
    say("create 2nd", second);
    await owner.goto(`${BASE}/dashboard`, { waitUntil: "networkidle", timeout: 240000 });
    await owner.waitForTimeout(1500);
    say("2nd: notice", await owner.locator('[data-testid="org-trial-notice"]').innerText().catch(() => "(no notice)"));
    await shot(owner, "02-second-org-notice.jpg");
    // Inside its own 14 days limits do not apply: a building beyond the paid point is allowed.
    say("2nd: add building #1", (await api(owner, "POST", "/api/settings/buildings", { name: "Зал", address: "ул. Тестовая, 1" })).status);
    say("2nd: add building #2", (await api(owner, "POST", "/api/settings/buildings", { name: "Цех", address: "ул. Тестовая, 2" })).status);

    await api(owner, "POST", "/api/me/active-organization", { organizationId: first.id });
    await owner.reload({ waitUntil: "networkidle" });
    const third = await api(owner, "POST", "/api/organizations", { name: "Кафе Третье", sphere: "restaurant" });
    say("create 3rd", third);
    await api(owner, "POST", "/api/me/active-organization", { organizationId: first.id });
    await owner.reload({ waitUntil: "networkidle" });
    say("preview after two grants", (await api(owner, "GET", "/api/organizations/creation-preview")).json);
    say("create 4th", await api(owner, "POST", "/api/organizations", { name: "Кафе Четвёртое", sphere: "restaurant" }));
    say("db after creations", orgState());

    // The paid organization is not squeezed by the trial ones: points in use stay 1 of 1.
    await owner.goto(`${BASE}/settings/subscription`, { waitUntil: "networkidle", timeout: 240000 });
    await owner.waitForTimeout(1200);
    say("tariff page card", await owner.locator('[data-testid="org-trials-card"]').innerText().catch(() => "(no card)"));
    await shot(owner, "03-tariff-page-trials.jpg", { fullPage: true });

    fs.writeFileSync(path.join(OUT, "ids.json"), JSON.stringify({ EMAIL, first: first.id, second: second.json.organizationId, third: third.json.organizationId }, null, 2));
  } finally {
    fs.writeFileSync(path.join(OUT, "phaseA.log"), log.join("\n"));
    await browser.close();
  }
})().catch((error) => { console.error("FAILED", error); process.exit(1); });
