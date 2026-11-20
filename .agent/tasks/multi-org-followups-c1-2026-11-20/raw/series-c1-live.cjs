// Live check of series C1 through the browser (local `next dev` on port 3000 with the repo .env loaded).
// Two companies linked to one cabinet; the «Меню и сырьё мастер-кабинета» checkbox in the request and on the
// confirmation page; the company's «Мастер-кабинет» page shows only the cabinet name.
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
  const weights = [2, 4, 10, 3, 5, 9, 4, 6, 8];
  const sum = prefix9.split("").reduce((acc, digit, i) => acc + Number(digit) * weights[i], 0);
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
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ru-RU" });
  return ctx.newPage();
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
const profile = (page, name, digit, phoneTail) => api(page, "POST", "/api/profile/complete", {
  organizationName: name, phone: `+7916${phoneTail}`, sphere: "restaurant", ownershipKind: "private", locationsCount: 1,
  inn: inn10(`5${digit}${seed}0`.slice(0, 9)), name: "Владелец", newPassword: "Passw0rd-1", asEmployee: false,
});
const shot = (page, name, opts = {}) => page.screenshot({ path: path.join(OUT, name), type: "jpeg", quality: 74, ...opts });
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const open = async (page, url) => { await page.goto(`${BASE}${url}`, { waitUntil: "networkidle", timeout: 240000 }); await page.waitForTimeout(1500); };
async function payAndRequest(browser, root, label, digit, phoneTail, code, withPool) {
  const page = await register(browser, `${label}-${stamp}@example.com`);
  await profile(page, `Компания ${label}`, digit, phoneTail);
  const invoice = await api(page, "POST", "/api/payments/invoice", { plan: "standard", cycle: "month", points: 1 });
  await api(root, "POST", `/api/root/orders/${invoice.json.orderId}/mark-paid`);
  await api(page, "POST", "/api/products", { name: `Продукт ${label}`, unit: "kg", kind: "raw" });
  await open(page, "/settings/master-cabinet");
  await tid(page, "exchange-card").waitFor({ timeout: 60000 });
  await tid(page, "exchange-foreign-open").click();
  await tid(page, "exchange-dialog").waitFor({ timeout: 30000 });
  await page.waitForTimeout(1000);
  const products = tid(page, "exchange-kind-products");
  if (!(await products.isChecked())) await products.check({ force: true });
  await tid(page, "exchange-foreign-code").fill(code);
  if (withPool) {
    const pool = tid(page, "exchange-foreign-pool");
    say(`${label}: pool checkbox off by default`, !(await pool.isChecked()));
    await pool.check({ force: true });
    await shot(page, "01-request-with-pool.jpg");
  }
  await tid(page, "exchange-foreign-send").click();
  await tid(page, "exchange-foreign-pending").waitFor({ timeout: 60000 });
  return page;
}

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  try {
    const root = await login(browser, "root@local.test", process.env.ROOT_PASSWORD);
    const owner = await register(browser, `cab-${stamp}@example.com`);
    await profile(owner, "Сеть Обед-Сити", "1", "8000001");
    for (const name of ["Молоко 3,2 %", "Курица охлаждённая"]) await api(owner, "POST", "/api/products", { name, unit: "kg", kind: "raw" });
    await open(owner, "/settings/master-cabinet");
    await tid(owner, "exchange-card").waitFor({ timeout: 60000 });
    await owner.waitForTimeout(1000);
    if ((await tid(owner, "exchange-cabinet-code-value").count()) === 0) await tid(owner, "exchange-cabinet-code-get").click();
    await tid(owner, "exchange-cabinet-code-value").waitFor({ timeout: 60000 });
    const code = (await tid(owner, "exchange-cabinet-code-value").innerText()).trim();

    // Company A asks with the menu and raw materials; the owner allows it.
    const a = await payAndRequest(browser, root, "A", "2", "8000002", code, true);
    await owner.waitForTimeout(2500);
    let incoming = (await api(owner, "GET", "/api/settings/directory-exchange/requests")).json.incoming ?? [];
    await open(owner, `/exchange-request/${incoming[incoming.length - 1].id}`);
    await tid(owner, "exchange-request-card").waitFor({ timeout: 60000 });
    const poolBox = tid(owner, "exchange-request-pool");
    say("confirmation page: pool line off by default", !(await poolBox.isChecked()));
    await poolBox.check({ force: true });
    await shot(owner, "02-confirmation-pool.jpg", { fullPage: true });
    await tid(owner, "exchange-request-approve").click();
    await tid(owner, "exchange-request-approve-confirm").click();
    await owner.waitForTimeout(6000);
    const orgA = (await api(a, "GET", "/api/organizations")).json.organizations[0];
    say("A connected to the cabinet menu (poolConnected | linkedServiceCode set)", sql(`select "poolConnected" || '|' || (select ("linkedServiceCode" is not null)::text from "Organization" where id='${orgA.id}') from "DirectoryExchangeMember" where "organizationId"='${orgA.id}'`));

    // Company B asks without the menu; the owner approves; both companies are linked.
    const b = await payAndRequest(browser, root, "B", "3", "8000003", code, false);
    await owner.waitForTimeout(2500);
    incoming = (await api(owner, "GET", "/api/settings/directory-exchange/requests")).json.incoming ?? [];
    const decided = await api(owner, "POST", `/api/exchange-requests/${incoming[incoming.length - 1].id}`, { decision: "approve", allowedKinds: ["products"] });
    say("B approved (second company on the same cabinet)", { status: decided.status, result: decided.json?.status });
    await api(owner, "POST", "/api/settings/directory-exchange/sync");
    await owner.waitForTimeout(3000);
    const orgB = (await api(b, "GET", "/api/organizations")).json.organizations[0];
    const products = (orgId) => sql(`select string_agg(name, ', ' order by name) from "Product" where "organizationId"='${orgId}' and "isActive"`);
    say("A products", products(orgA.id));
    say("B products (owner's yes, A's no)", products(orgB.id));
    await open(owner, "/settings/master-cabinet");
    await tid(owner, "exchange-card").waitFor({ timeout: 60000 });
    await owner.waitForTimeout(1500);
    say("owner card: companies", await tid(owner, "exchange-foreign-member").count());
    await tid(owner, "exchange-card").screenshot({ path: path.join(OUT, "03-owner-two-companies.jpg"), type: "jpeg", quality: 80 });

    // A's «Мастер-кабинет» page: only the cabinet's name.
    await open(a, "/settings/master-cabinet");
    await a.waitForTimeout(1500);
    await shot(a, "04-company-cabinet-page.jpg", { fullPage: true });
    const pageText = (await a.locator("main").first().innerText()).replace(/\n+/g, " | ");
    say("A's page names the owner's organization", pageText.includes("Сеть Обед-Сити"));
    say("A cannot join the owner's cabinet by API", (await api(a, "POST", "/api/settings/master-cabinet", { name: "Оператор Компании", email: `op-${stamp}@example.com` })).status);
  } catch (error) {
    say("SCRIPT ERROR", String(error && error.stack ? error.stack : error));
  } finally {
    fs.writeFileSync(path.join(OUT, "series-c1-live.log"), log.join("\n") + "\n");
    await browser.close();
  }
})();
