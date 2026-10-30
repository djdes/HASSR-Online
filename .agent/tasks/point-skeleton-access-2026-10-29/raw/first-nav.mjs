import { chromium } from "playwright";
const BASE = "http://localhost:3034";
const browser = await chromium.launch({ executablePath: "C:/Users/Two/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
for (const [label, path, settle] of [
  ["allowed page first", "/settings/users", 0],
  ["forbidden after settle", "/settings/organization", 8000],
  ["forbidden immediately", "/settings/organization", 0],
]) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.fill("#email", "dk-chef@test.local");
  await page.fill("#password", "Test-12345");
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 180000 });
  const landed = page.url();
  if (settle) await page.waitForTimeout(settle);
  const response = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 180000 });
  const body = (await response?.text()) ?? "";
  console.log(label, "landed:", landed, "→", path, response?.status(), body.includes("__next_error__") ? "errorShell" : "");
  const template = /<template[^>]*data-next-error[^>]*>/.exec(body)?.[0];
  if (template) console.log(template.replace(/&#x27;|&quot;/g, "'").slice(0, 3000));
  await ctx.close();
}
await browser.close();
