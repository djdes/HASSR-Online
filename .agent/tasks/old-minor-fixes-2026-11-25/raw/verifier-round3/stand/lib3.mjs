// Verifier round 3 stand helpers (own code): login through the UI form once, keep the session outside the repo.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire("/home/user/HASSR-Online/package.json");
export const { chromium, devices } = require("/opt/node-tools/node_modules/playwright");
const { Client } = require("pg");

export const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const AUTH_DIR = process.env.V3_AUTH_DIR ?? "/tmp/claude-0/-home-user-HASSR-Online/d71dfd22-e8ae-5524-a77c-52d9336f142f/scratchpad/v3/auth";
fs.mkdirSync(AUTH_DIR, { recursive: true });
export const OWNER = { email: "admin@haccp.local", password: "admin1234" };

export async function db() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return { client, q: async (sql, params = []) => (await client.query(sql, params)).rows };
}

/** Storage state file of a logged-in owner (UI login once, reused). */
export async function ownerState(browser) {
  const file = path.join(AUTH_DIR, "owner.json");
  if (fs.existsSync(file)) {
    const ctx = await browser.newContext({ storageState: file });
    const body = await (await ctx.request.get(`${BASE}/api/auth/session`)).json().catch(() => ({}));
    await ctx.close();
    if (body?.user?.email === OWNER.email) return file;
  }
  const ctx = await browser.newContext({ locale: "ru-RU" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 240000 });
  await page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled, null, { timeout: 120000 });
  await page.fill("#email", OWNER.email);
  await page.fill("#password", OWNER.password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 240000 }), page.click('button[type="submit"]')]);
  await ctx.storageState({ path: file });
  await ctx.close();
  return file;
}

export async function acceptLegal(page) {
  const legal = page.locator('[data-testid="legal-update-modal"]');
  if (await legal.isVisible({ timeout: 1500 }).catch(() => false)) {
    await legal.locator('input[type="checkbox"], [role="checkbox"]').first().click();
    await page.click('[data-testid="legal-update-accept"]');
    await legal.waitFor({ state: "hidden", timeout: 15000 }).catch(() => {});
  }
}

export function reporter(file) {
  const rows = [];
  const check = (name, ok, detail = "") => {
    rows.push({ name, ok: Boolean(ok), detail });
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  };
  const finish = () => {
    const failed = rows.filter((r) => !r.ok).length;
    console.log(`\n${rows.length - failed}/${rows.length} PASS`);
    if (file) fs.writeFileSync(file, JSON.stringify(rows, null, 1));
    return failed;
  };
  return { check, finish, rows };
}
