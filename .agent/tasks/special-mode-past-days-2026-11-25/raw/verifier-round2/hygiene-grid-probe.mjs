// Verifier round 2: hygiene grid (second grid client) follows the same rule.
// Staff view of a plain document: off → all non-today days «только сегодня»; window 3 → 3 days open.
// Owner view of an automation document: off → every past day locked; window 3 → 3 days open.
// Usage: node hygiene-grid-probe.mjs <outdir> <pointId> <hygieneDocId>. Restores special mode, point automation, doc autoFill.
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire("/home/user/HASSR-Online/package.json");
const { chromium } = require("/opt/node-tools/node_modules/playwright");
const { Client } = require("pg");

const BASE = "http://localhost:3000";
const [OUT, POINT, DOC] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const pg = new Client({ connectionString: process.env.DATABASE_URL });
await pg.connect();
const q = async (sql, params = []) => (await pg.query(sql, params)).rows;
const ADMIN = (await q(`select id, "organizationId" from "User" where email='admin@haccp.local'`))[0];
const KEY = `org-journal-controls:${ADMIN.organizationId}`;
const rawSetting = (await q(`select value from "PlatformSetting" where key=$1`, [KEY]))[0]?.value ?? null;
const ru = JSON.parse(fs.readFileSync("/home/user/HASSR-Online/src/i18n/messages/ru.json", "utf8"));
const NOT_TODAY = ru.hygiene.errors.notToday;
const WINDOW3 = "Прошлые записи можно менять только за последние 3 дня.";
const LOCKED = ru.hygiene.errors.pastDaysLocked;
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${detail}`); };
const msk = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
const daysBefore = Number(msk.slice(8, 10)) - 1;
const monthEnd = new Date(Date.UTC(Number(msk.slice(0, 4)), Number(msk.slice(5, 7)), 0)).toISOString().slice(0, 10);
const daysAfter = Number(monthEnd.slice(8, 10)) - Number(msk.slice(8, 10));

const browser = await chromium.launch();
async function login(email, password) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: "ru-RU" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "load" });
  await page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled, null, { timeout: 60000 });
  await page.fill("#email", email);
  await page.fill("#password", password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120000 }), page.click('button[type="submit"]')]);
  await ctx.request.post(`${BASE}/api/me/active-building`, { data: { buildingId: POINT } });
  return { ctx, page };
}
async function counts(page, shot) {
  await page.goto(`${BASE}/journals/hygiene/documents/${DOC}`, { waitUntil: "networkidle", timeout: 180000 });
  const legal = page.locator('[data-testid="legal-update-modal"]');
  if (await legal.count()) {
    await legal.locator('input[type="checkbox"], [role="checkbox"]').first().click();
    await page.click('[data-testid="legal-update-accept"]');
  }
  await page.waitForTimeout(2500);
  if (shot) await page.screenshot({ path: `${OUT}/${shot}`, fullPage: false });
  return page.evaluate(([a, b, c]) => ({
    notToday: document.querySelectorAll(`[title="${a}"]`).length,
    window: document.querySelectorAll(`[title="${b}"]`).length,
    locked: document.querySelectorAll(`[title="${c}"]`).length,
  }), [NOT_TODAY, WINDOW3, LOCKED]);
}
const OFF = { enabled: false, autoFill: false, autoCreate: false, copyYesterday: false, closeDayAutofill: false, catchUp: false, pastDays: false, pastDaysLimit: 7 };
const owner = await login("admin@haccp.local", "admin1234");
const cook = await login("cook-e2e-special@haccp.local", "cook-e2e-2026");
const setAutomation = (automation) => owner.ctx.request.patch(`${BASE}/api/settings/journal-controls`, { data: { automation } });
try {
  await setAutomation(OFF);
  const cookOff = await counts(cook.page);
  await setAutomation({ ...OFF, enabled: true, pastDays: true, pastDaysLimit: 3 });
  const cookOn = await counts(cook.page, "hygiene-cook-window3.png");
  const k = cookOff.notToday / (daysBefore + daysAfter);
  check("HG-1 staff hygiene grid: off → «только сегодня» on every other day; window 3 → 3 days open, older ones say «за последние 3 дня», future closed",
    Number.isInteger(k) && k > 0 && cookOn.window === (daysBefore - 3) * k && cookOn.notToday === daysAfter * k,
    JSON.stringify({ cookOff, cookOn, k, daysBefore, daysAfter }));
  // Automation document (owner view).
  await q(`update "Building" set "journalAutomationJson"=$2::jsonb where id=$1`, [POINT, JSON.stringify({ hygiene: { autoCreate: true, autoFill: true } })]);
  await q(`update "JournalDocument" set "autoFill"=true where id=$1`, [DOC]);
  await setAutomation({ ...OFF, enabled: true, autoFill: true });
  const ownerOff = await counts(owner.page, "hygiene-owner-auto-off.png");
  await setAutomation({ ...OFF, enabled: true, autoFill: true, pastDays: true, pastDaysLimit: 3 });
  const ownerOn = await counts(owner.page, "hygiene-owner-auto-window3.png");
  const rows = ownerOff.locked / daysBefore;
  check("HG-2 owner, automation hygiene doc: box off → every past day locked; window 3 → 3 past days open, older still locked",
    Number.isInteger(rows) && rows > 0 && ownerOn.locked === (daysBefore - 3) * rows,
    JSON.stringify({ ownerOff, ownerOn, rows }));
} finally {
  await q(`update "Building" set "journalAutomationJson"=null where id=$1`, [POINT]);
  await q(`update "JournalDocument" set "autoFill"=false where id=$1`, [DOC]);
  if (rawSetting === null) await q(`delete from "PlatformSetting" where key=$1`, [KEY]);
  else await q(`update "PlatformSetting" set value=$2 where key=$1`, [KEY, rawSetting]);
  const restored = (await q(`select value from "PlatformSetting" where key=$1`, [KEY]))[0]?.value ?? null;
  check("restore special mode / point / doc", restored === rawSetting, restored);
  fs.writeFileSync(`${OUT}/hygiene-grid-probe-results.json`, JSON.stringify(results, null, 2));
  await browser.close();
  await pg.end();
}
