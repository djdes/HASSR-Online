import path from "node:path";
import { chromium } from "playwright";
const URL = "https://wesetup.ru/journal-fill/cmtwzhw9700w73vts4z0z254u/hygiene?token=journal%3Acmtwzhw9700w73vts4z0z254u%3Ahygiene.1789891851224.WoAWIF46a8Qjzd3Cc15iKsL0wTX237YM_Ra1oR1Qq8g";
const ROOT = path.resolve(process.cwd(), ".agent/tasks/journal-qr-fill-2026-09/e2e/shots");
(async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "load", timeout: 120_000 });
  await page.locator('a[href*="employee="]').first().click();
  await page.waitForSelector("#qr-form", { timeout: 60_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(ROOT, "prod-form-hygiene.png"), fullPage: false });
  console.log("who:", (await page.locator(".who").first().innerText()).replace(/\s+/g, " "));
  console.log("steps:", await page.evaluate(() => Array.from(document.querySelectorAll(".steps li")).map((l) => l.textContent?.trim())));
  console.log("html bytes:", (await page.content()).length);
  await browser.close();
})();
