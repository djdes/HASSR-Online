// Live check of the review fix (series C1): a company connected to the cabinet menu cannot join the owner's
// master cabinet through POST /api/settings/master-cabinet without cabinetId. Logs in as company A of the
// previous live run (email given as the first argument; password from that run).
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const BASE = "http://localhost:3000";
const email = process.argv[2];
const sql = (query) => execSync(`su postgres -c "psql -d haccp_online -tA -c \\"${query.replace(/"/g, '\\\\\\"')}\\""`, { encoding: "utf8" }).trim();
(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const page = await (await browser.newContext({ locale: "ru-RU" })).newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 240000 });
  await page.fill('input[type="email"], input[name="email"], #email', email);
  await page.fill('input[type="password"]', "Passw0rd-1");
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !/\/login/.test(url.pathname), { timeout: 240000 });
  const userId = sql(`select id from "User" where email='${email}'`);
  const before = sql(`select count(*) from "OrganizationMember" m join "Organization" o on o.id=m."organizationId" where o.kind='directory' and m."userId"='${userId}'`).trim();
  const res = await page.evaluate(async () => {
    const r = await fetch("/api/settings/master-cabinet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Оператор Компании", email: `op-${Date.now()}@example.com` }) });
    return { status: r.status, body: (await r.text()).slice(0, 200) };
  });
  const after = sql(`select count(*) from "OrganizationMember" m join "Organization" o on o.id=m."organizationId" where o.kind='directory' and m."userId"='${userId}'`).trim();
  console.log(`company A joins the owner's cabinet by API: ${JSON.stringify(res)}`);
  console.log(`membership rows of A's owner before/after: ${before}/${after}`);
  await browser.close();
})();
