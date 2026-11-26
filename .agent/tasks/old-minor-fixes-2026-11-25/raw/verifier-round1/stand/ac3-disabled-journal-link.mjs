// Verifier AC3 behaviour: the document page of a journal turned off in the organization shows the soft
// «disabled» screen whose «settings» link is now next/link — same href, same text, navigates to
// /settings/journals. Read-only (a document of an already disabled journal).
// Usage (env loaded, next dev on :3000): node ac3-disabled-journal-link.mjs <outdir> <code> <docId>
import fs from "node:fs";
import { BASE, chromium, reporter, session, acceptLegal } from "./lib.mjs";
const [OUT, CODE, DOC] = process.argv.slice(2);
fs.mkdirSync(`${OUT}/screens`, { recursive: true });
const { check, finish } = reporter(`${OUT}/ac3-results.json`);
const browser = await chromium.launch();
const owner = await session(browser, "admin@haccp.local", "admin1234");
const page = await owner.newPage();
try {
  await page.goto(`${BASE}/journals/${CODE}/documents/${DOC}`, { waitUntil: "networkidle", timeout: 240000 });
  await acceptLegal(page);
  const link = page.locator('main a[href="/settings/journals"]').filter({ hasText: /Открыть настройки|journal settings/i }).first();
  await link.waitFor({ timeout: 60000 });
  check("AC3 disabled journal screen: settings link present with the same href and text", (await link.getAttribute("href")) === "/settings/journals", `${await link.innerText()} → ${await link.getAttribute("href")}`);
  await page.screenshot({ path: `${OUT}/screens/ac3-disabled-journal.png` });
  await Promise.all([page.waitForURL((u) => u.pathname === "/settings/journals", { timeout: 120000 }), link.click()]);
  check("AC3 link navigates to /settings/journals", new URL(page.url()).pathname === "/settings/journals", page.url());
} finally {
  const failed = finish();
  await browser.close();
  process.exitCode = failed ? 1 : 0;
}
