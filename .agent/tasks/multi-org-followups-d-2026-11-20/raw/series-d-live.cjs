// Live check of series D through the browser (local `next dev` on port 3000 with the repo .env loaded).
// Network summary page, exchange history with undo, ROOT «Обмен справочниками», subscription ?addPoints=1.
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const BASE = "http://localhost:3000";
const OUT = __dirname;
const stamp = Date.now().toString(36);
const log = [];
const say = (label, value) => {
  const line = `${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`;
  log.push(line);
  console.log(line);
};
const sql = (query) =>
  execSync(`su postgres -c "psql -d haccp_online -tA -F '|' -c \\"${query.replace(/"/g, '\\\\\\"')}\\""`, { encoding: "utf8" }).trim();
function inn10(prefix9) {
  const w = [2, 4, 10, 3, 5, 9, 4, 6, 8];
  const sum = prefix9.split("").reduce((acc, d, i) => acc + Number(d) * w[i], 0);
  return prefix9 + String((sum % 11) % 10);
}
const seed = String(Date.now()).slice(-6);
async function api(page, method, url, body) {
  return page.evaluate(async ({ method, url, body }) => {
    const res = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 160) }; }
    return { status: res.status, json };
  }, { method, url, body });
}
async function newPage(browser) {
  return (await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ru-RU" })).newPage();
}
async function register(browser, email) {
  const page = await newPage(browser);
  await page.goto(`${BASE}/register`, { waitUntil: "networkidle", timeout: 240000 });
  await page.fill("#register-email", email);
  await page.check('[data-testid="legal-consent"]');
  await page.waitForTimeout(2500);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/home/, { timeout: 240000 });
  return page;
}
async function login(browser, email, password) {
  const page = await newPage(browser);
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 240000 });
  await page.fill('input[type="email"], input[name="email"], #email', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !/\/login/.test(url.pathname), { timeout: 240000 });
  return page;
}
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const open = async (page, url) => { await page.goto(`${BASE}${url}`, { waitUntil: "networkidle", timeout: 240000 }); await page.waitForTimeout(1500); };
const switchTo = async (page, id) => { await api(page, "POST", "/api/me/active-organization", { organizationId: id }); await page.reload({ waitUntil: "networkidle" }); };

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  try {
    const root = await login(browser, "root@local.test", process.env.ROOT_PASSWORD);
    const owner = await register(browser, `net-${stamp}@example.com`);
    await api(owner, "POST", "/api/profile/complete", {
      organizationName: "Сеть Завтрак", phone: `+7916${seed.slice(0, 6)}1`, sphere: "restaurant", ownershipKind: "private",
      locationsCount: 1, inn: inn10(`57${seed}0`.slice(0, 9)), name: "Владелец", newPassword: "Passw0rd-1", asEmployee: false,
    });
    const orgA = (await api(owner, "GET", "/api/organizations")).json.organizations[0];
    for (const name of ["Молоко 3,2 %", "Кефир 1 %"]) await api(owner, "POST", "/api/products", { name, unit: "kg", kind: "raw" });
    say("org B", (await api(owner, "POST", "/api/organizations", { name: "Завтрак на Пресне", sphere: "restaurant" })).status);
    const orgB = (await api(owner, "GET", "/api/organizations")).json.organizations.find((o) => o.name === "Завтрак на Пресне");
    sql(`update "Organization" set "balanceRub"=4200 where id='${orgA.id}'`);
    sql(`update "Organization" set "balanceRub"=800 where id='${orgB.id}'`);
    await switchTo(owner, orgA.id);
    const saved = await api(owner, "PUT", "/api/settings/directory-exchange", { members: [{ organizationId: orgA.id, kinds: ["products"] }, { organizationId: orgB.id, kinds: ["products"] }] });
    say("exchange A↔B saved", saved.status);
    // An edit in A reaches B, so B's history has a create and an update.
    const milk = sql(`select id from "Product" where "organizationId"='${orgA.id}' and name='Молоко 3,2 %'`);
    await api(owner, "PUT", "/api/products", { id: milk, name: "Молоко 3,2 %", unit: "kg", kind: "raw", supplier: "Ферма А" });
    say("sync", (await api(owner, "POST", "/api/settings/directory-exchange/sync")).status);

    // Network summary
    await open(owner, "/settings/network");
    await owner.locator("[data-network-summary]").waitFor({ timeout: 60000 });
    say("network summary", (await owner.locator("[data-network-summary]").innerText()).replace(/\n+/g, " | ").slice(0, 500));
    await owner.screenshot({ path: path.join(OUT, "01-network-summary.jpg"), type: "jpeg", quality: 74, fullPage: true });

    // History in B with undo of the supplier change
    await switchTo(owner, orgB.id);
    await open(owner, "/settings/master-cabinet");
    await tid(owner, "exchange-history-open").waitFor({ timeout: 60000 });
    await tid(owner, "exchange-history-open").click();
    await tid(owner, "exchange-history-dialog").waitFor({ timeout: 30000 });
    await owner.waitForTimeout(1000);
    say("history rows", (await tid(owner, "exchange-history-dialog").innerText()).replace(/\n+/g, " | ").slice(0, 500));
    await owner.screenshot({ path: path.join(OUT, "02-history-dialog.jpg"), type: "jpeg", quality: 74 });
    const updateRow = tid(owner, "exchange-history-row").filter({ hasText: "Ферма" }).first();
    const target = (await updateRow.count()) ? updateRow : tid(owner, "exchange-history-row").first();
    await target.locator('[data-testid="exchange-history-undo"]').click();
    await tid(owner, "exchange-history-undo-confirm").first().click();
    await owner.waitForTimeout(2500);
    say("history result", (await tid(owner, "exchange-history-dialog").innerText()).replace(/\n+/g, " | ").slice(0, 300));
    say("B milk supplier after undo", sql(`select coalesce(supplier,'-') from "Product" where "organizationId"='${orgB.id}' and name='Молоко 3,2 %'`));
    await api(owner, "POST", "/api/settings/directory-exchange/sync");
    await owner.waitForTimeout(1500);
    say("A milk supplier after the next sync (undo did not go back)", sql(`select coalesce(supplier,'-') from "Product" where "organizationId"='${orgA.id}' and name='Молоко 3,2 %'`));

    // Subscription with addPoints — on a paid plan (1 point).
    await switchTo(owner, orgA.id);
    const invoice = await api(owner, "POST", "/api/payments/invoice", { plan: "standard", cycle: "month", points: 1 });
    say("owner pays the tariff", (await api(root, "POST", `/api/root/orders/${invoice.json.orderId}/mark-paid`)).status);
    await open(owner, "/settings/subscription?addPoints=1");
    await owner.waitForTimeout(2000);
    say("subscription url after open (param removed)", owner.url());
    say("subscription note about +1 point", (await owner.locator("main").first().innerText()).match(/[^\n]*точ[^\n]*/gi)?.slice(0, 4));
    await owner.screenshot({ path: path.join(OUT, "03-subscription-add-points.jpg"), type: "jpeg", quality: 74 });

    // ROOT page
    await open(root, "/root/directory-exchange");
    await tid(root, "exchange-runs-table").waitFor({ timeout: 60000 });
    say("ROOT runs table rows", await tid(root, "exchange-runs-table").locator("tbody tr").count());
    await root.screenshot({ path: path.join(OUT, "04-root-exchange-runs.jpg"), type: "jpeg", quality: 74, fullPage: true });
    say("non-root opens ROOT page", (await owner.goto(`${BASE}/root/directory-exchange`, { waitUntil: "networkidle" })).status());
  } catch (error) {
    say("SCRIPT ERROR", String(error && error.stack ? error.stack : error));
  } finally {
    fs.writeFileSync(path.join(OUT, "series-d-live.log"), log.join("\n") + "\n");
    await browser.close();
  }
})();
