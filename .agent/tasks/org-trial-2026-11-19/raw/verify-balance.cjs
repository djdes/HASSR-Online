// Live check: every organization of one account has its own balance and history.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = "http://localhost:3000";
const OUT = path.join(__dirname, "raw");
fs.mkdirSync(OUT, { recursive: true });
const stamp = Date.now().toString(36);
const EMAIL = `owner-${stamp}@example.com`;
const STRANGER = `stranger-${stamp}@example.com`;
const log = [];
const say = (label, value) => {
  const line = `${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`;
  log.push(line);
  console.log(line);
};

async function api(page, method, url, body) {
  return page.evaluate(
    async ({ method, url, body }) => {
      const res = await fetch(url, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      let json = null;
      const text = await res.text();
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text.slice(0, 200) };
      }
      return { status: res.status, json };
    },
    { method, url, body },
  );
}

async function register(browser, email) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ru-RU" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/register`, { waitUntil: "networkidle", timeout: 180000 });
  await page.fill("#register-email", email);
  await page.check('[data-testid="legal-consent"]');
  await page.waitForTimeout(2500); // anti-bot stamp must be older than 1.5 s
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/home/, { timeout: 180000 });
  return { ctx, page };
}

function summary(balance) {
  const j = balance.json || {};
  const rows = j.transactions || j.history || j.overview?.transactions || [];
  return {
    status: balance.status,
    balanceRub: j.balanceRub ?? j.balance ?? j.overview?.balanceRub,
    rows: rows.map((r) => `${r.amount > 0 ? "+" : ""}${r.amount} ${r.kind} · ${r.description}`),
  };
}

(async () => {
  const browser = await chromium.launch();
  try {
    // ---- owner registers, fills the questionnaire for organization A
    const owner = await register(browser, EMAIL);
    say("registered", EMAIL);
    await owner.page.screenshot({ path: path.join(OUT, "01-after-register.jpg"), type: "jpeg", quality: 70 });
    const profile = await api(owner.page, "POST", "/api/profile/complete", {
      organizationName: "ООО Первая",
      phone: "+79991112233",
      sphere: "restaurant",
      ownershipKind: "private",
      locationsCount: 1,
      inn: "7707083893",
      name: "Владелец Тестов",
      newPassword: "Passw0rd-1",
      asEmployee: false,
    });
    say("profile/complete", profile);

    const orgsA = await api(owner.page, "GET", "/api/organizations");
    const orgA = orgsA.json.organizations[0];
    say("orgs after register", orgsA.json.organizations.map((o) => ({ id: o.id, name: o.name })));
    say("A balance at start", summary(await api(owner.page, "GET", "/api/balance")));

    // ---- A: invoice for balance top-up and invoice for the tariff
    const topupA = await api(owner.page, "POST", "/api/balance/topup", { amountRub: 5000, method: "invoice" });
    say("A topup invoice", { status: topupA.status, json: topupA.json });
    const planA = await api(owner.page, "POST", "/api/payments/invoice", { plan: "standard", cycle: "month", points: 1 });
    say("A tariff invoice", { status: planA.status, json: planA.json });

    // ---- root marks both invoices as paid
    const rootCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ru-RU" });
    const root = await rootCtx.newPage();
    await root.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 180000 });
    await root.fill('input[type="email"], input[name="email"], #email', "root@local.test");
    await root.fill('input[type="password"]', process.env.ROOT_PASSWORD);
    await root.click('button[type="submit"]');
    await root.waitForURL((url) => !/\/login/.test(url.pathname), { timeout: 180000 });
    say("root logged in at", root.url());
    const orders = async () =>
      (await api(owner.page, "GET", "/api/balance")).json;
    const idOf = (res) => res.json?.orderId ?? res.json?.order?.id ?? res.json?.id ?? res.json?.invoice?.id;
    for (const [name, res] of [["topup", topupA], ["tariff", planA]]) {
      const id = idOf(res);
      const paid = await api(root, "POST", `/api/root/orders/${id}/mark-paid`);
      say(`root mark-paid ${name} #${id}`, paid);
    }
    void orders;

    say("A balance after payments", summary(await api(owner.page, "GET", "/api/balance")));

    // ---- owner creates organization B
    let createB = await api(owner.page, "POST", "/api/organizations", { name: "ООО Вторая", sphere: "restaurant" });
    say("create B (account paid for 1 point)", createB);
    if (createB.status !== 200) {
      const up = await api(owner.page, "POST", "/api/payments/invoice", { plan: "standard", cycle: "month", points: 2 });
      say("A invoice for 2 points", { status: up.status, json: up.json });
      const paid = await api(root, "POST", `/api/root/orders/${idOf(up)}/mark-paid`);
      say("root mark-paid 2 points", paid);
      createB = await api(owner.page, "POST", "/api/organizations", { name: "ООО Вторая", sphere: "restaurant" });
      say("create B (after paying 2 points)", createB);
    }
    const orgBId = createB.json.organizationId;
    fs.writeFileSync(path.join(OUT, "ids.json"), JSON.stringify({ EMAIL, STRANGER, orgA: orgA.id, orgB: orgBId }, null, 2));

    await owner.page.goto(`${BASE}/dashboard?welcome-org=1`, { waitUntil: "networkidle", timeout: 180000 });
    await owner.page.waitForTimeout(1500);
    await owner.page.screenshot({ path: path.join(OUT, "02-new-org-dashboard.jpg"), type: "jpeg", quality: 70 });
    say("B: setup wizard dialog visible", await owner.page.locator('[role="dialog"]').count());
    say("B balance right after creation", summary(await api(owner.page, "GET", "/api/balance")));
    await owner.page.goto(`${BASE}/settings/balance`, { waitUntil: "networkidle", timeout: 180000 });
    await owner.page.waitForTimeout(1000);
    await owner.page.screenshot({ path: path.join(OUT, "03-balance-org-B-empty.jpg"), type: "jpeg", quality: 70, fullPage: true });

    // ---- B: its own top-up (B needs an INN for an invoice)
    const noInn = await api(owner.page, "POST", "/api/balance/topup", { amountRub: 700, method: "invoice" });
    say("B topup invoice without INN", { status: noInn.status, json: noInn.json });
    fs.writeFileSync(path.join(OUT, "need-inn.flag"), orgBId);
  } finally {
    fs.writeFileSync(path.join(OUT, "phase1.log"), log.join("\n"));
    await browser.close();
  }
})().catch((error) => {
  console.error("FAILED", error);
  process.exit(1);
});
