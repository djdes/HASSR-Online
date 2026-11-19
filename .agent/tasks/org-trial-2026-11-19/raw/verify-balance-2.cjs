// Phase 2: organization B gets its own top-up; A stays untouched; a stranger cannot reach either.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const BASE = "http://localhost:3000";
const OUT = path.join(__dirname, "raw");
const ids = require("./raw/ids.json");
const log = [];
const say = (label, value) => {
  const line = `${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`;
  log.push(line);
  console.log(line);
};
async function api(page, method, url, body) {
  return page.evaluate(async ({ method, url, body }) => {
    const res = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
    return { status: res.status, json };
  }, { method, url, body });
}
async function login(browser, email, password) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ru-RU" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 180000 });
  await page.fill('input[type="email"], input[name="email"], #email', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !/\/login/.test(url.pathname), { timeout: 180000 });
  return page;
}
const summary = (res) => ({
  status: res.status,
  balanceRub: res.json?.balanceRub,
  rows: (res.json?.transactions || []).map((r) => `${r.amount > 0 ? "+" : ""}${r.amount} ${r.kind} · ${r.description}`),
});
(async () => {
  const browser = await chromium.launch();
  try {
    const owner = await login(browser, ids.EMAIL, "Passw0rd-1");
    const root = await login(browser, "root@local.test", process.env.ROOT_PASSWORD);

    let sw = await api(owner, "POST", "/api/me/active-organization", { organizationId: ids.orgB });
    say("switch to B", sw);
    await owner.reload({ waitUntil: "networkidle" });
    const topupB = await api(owner, "POST", "/api/balance/topup", { amountRub: 700, method: "invoice" });
    say("B topup invoice", { status: topupB.status, json: topupB.json });
    say("root mark-paid B topup", await api(root, "POST", `/api/root/orders/${topupB.json.orderId}/mark-paid`));
    say("B balance after its top-up", summary(await api(owner, "GET", "/api/balance")));
    await owner.goto(`${BASE}/settings/balance`, { waitUntil: "networkidle", timeout: 180000 });
    await owner.waitForTimeout(1200);
    await owner.screenshot({ path: path.join(OUT, "04-balance-org-B.jpg"), type: "jpeg", quality: 72, fullPage: true });

    sw = await api(owner, "POST", "/api/me/active-organization", { organizationId: ids.orgA });
    say("switch to A", sw);
    await owner.reload({ waitUntil: "networkidle" });
    say("A balance after B's top-up", summary(await api(owner, "GET", "/api/balance")));
    await owner.goto(`${BASE}/settings/balance`, { waitUntil: "networkidle", timeout: 180000 });
    await owner.waitForTimeout(1200);
    await owner.screenshot({ path: path.join(OUT, "05-balance-org-A.jpg"), type: "jpeg", quality: 72, fullPage: true });

    // A stranger from another account must not reach either organization.
    const sctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ru-RU" });
    const stranger = await sctx.newPage();
    await stranger.goto(`${BASE}/register`, { waitUntil: "networkidle", timeout: 180000 });
    await stranger.fill("#register-email", ids.STRANGER);
    await stranger.check('[data-testid="legal-consent"]');
    await stranger.waitForTimeout(2500);
    await stranger.click('button[type="submit"]');
    await stranger.waitForURL(/\/home/, { timeout: 180000 });
    say("stranger switch to A", await api(stranger, "POST", "/api/me/active-organization", { organizationId: ids.orgA }));
    say("stranger switch to B", await api(stranger, "POST", "/api/me/active-organization", { organizationId: ids.orgB }));
    say("stranger own balance", summary(await api(stranger, "GET", "/api/balance")));
  } finally {
    fs.writeFileSync(path.join(OUT, "phase2.log"), log.join("\n"));
    await browser.close();
  }
})().catch((error) => { console.error("FAILED", error); process.exit(1); });
