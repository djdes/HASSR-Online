// Verifier stand helpers: login once per user (UI form), session kept OUTSIDE the repo.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire("/home/user/HASSR-Online/package.json");
export const { chromium } = require("/opt/node-tools/node_modules/playwright");
const { Client } = require("pg");

export const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const AUTH_DIR = process.env.VERIFIER_AUTH_DIR ?? "/tmp/claude-0/-home-user-HASSR-Online/d71dfd22-e8ae-5524-a77c-52d9336f142f/scratchpad/auth";
fs.mkdirSync(AUTH_DIR, { recursive: true });

export async function db() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const q = async (sql, params = []) => (await client.query(sql, params)).rows;
  return { client, q };
}

export function reporter(outFile) {
  const results = [];
  const check = (name, ok, detail = "") => {
    results.push({ name, ok: Boolean(ok), detail });
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  };
  const finish = () => {
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} PASS`);
    if (outFile) fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
    return failed;
  };
  return { check, finish, results };
}

/** Moscow «today» ± offset, YYYY-MM-DD (org timezone Europe/Moscow, UTC+3). */
export const dayKey = (offset = 0) => {
  const d = new Date(Date.now() + 3 * 3600 * 1000);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

export async function session(browser, email, password, { viewport = { width: 1280, height: 900 } } = {}) {
  const file = path.join(AUTH_DIR, `${email.replace(/[^a-z0-9]/gi, "_")}.json`);
  if (fs.existsSync(file)) {
    const ctx = await browser.newContext({ viewport, storageState: file, locale: "ru-RU" });
    const res = await ctx.request.get(`${BASE}/api/auth/session`);
    const body = await res.json().catch(() => ({}));
    if (body?.user?.email === email) return ctx;
    await ctx.close();
  }
  const ctx = await browser.newContext({ viewport, locale: "ru-RU" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 240000 });
  await page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled, null, { timeout: 120000 });
  await page.fill("#email", email);
  await page.fill("#password", password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 240000 }),
    page.click('button[type="submit"]'),
  ]);
  await ctx.storageState({ path: file });
  await page.close();
  return ctx;
}

export async function acceptLegal(page) {
  const legal = page.locator('[data-testid="legal-update-modal"]');
  if (await legal.isVisible({ timeout: 1500 }).catch(() => false)) {
    await legal.locator('input[type="checkbox"], [role="checkbox"]').first().click();
    await page.click('[data-testid="legal-update-accept"]');
    await legal.waitFor({ state: "hidden", timeout: 15000 }).catch(() => {});
  }
}
