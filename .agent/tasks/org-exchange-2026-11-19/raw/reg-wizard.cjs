// First registration must keep its own wizard: full questionnaire, and no offer line without sibling organizations.
const { chromium } = require("playwright");
const path = require("path");
const BASE = "http://localhost:3000";
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ru-RU" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/register`, { waitUntil: "networkidle", timeout: 240000 });
  await page.fill("#register-email", `first-${Date.now().toString(36)}@example.com`);
  await page.check('[data-testid="legal-consent"]');
  await page.waitForTimeout(2500);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/home/, { timeout: 240000 });
  await page.waitForSelector("#complete-profile-form", { timeout: 60000 });
  const labels = await page.locator("#complete-profile-form label").allInnerTexts();
  console.log("registration step 1 fields:", JSON.stringify(labels.map((s) => s.split("\n")[0].trim()).filter(Boolean)));
  const form = page.locator("#complete-profile-form");
  await form.locator("input").first().fill("Первое кафе");
  await form.locator('input[type="tel"], input[inputmode="tel"]').first().fill("+79167770011");
  await page.locator('button[form="complete-profile-form"], #complete-profile-form button[type="submit"]').first().click();
  await page.waitForSelector("[data-setup-next]", { timeout: 60000 });
  await page.waitForTimeout(2500);
  console.log("step 2 reached; offer line present:", await page.locator('[data-testid="exchange-offer-line"]').count());
  await page.screenshot({ path: path.join(__dirname, "raw2", "07-first-registration-step2.jpg"), type: "jpeg", quality: 72 });
  await browser.close();
})().catch((e) => { console.error("FAILED", String(e).slice(0, 500)); process.exit(1); });
