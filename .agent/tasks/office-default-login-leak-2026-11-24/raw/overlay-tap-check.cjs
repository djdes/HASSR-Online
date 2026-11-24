// Local check: the Next.js dev overlay pill ("N Issues") covers the UKEP button on a phone
// and intercepts the click; removing the dev overlay node (as the smoke does before
// screenshots) lets the click through. Usage: node overlay-tap-check.cjs smoke-data.json
const { chromium, devices } = require("playwright");
const fs = require("node:fs");
const BASE = "http://localhost:3005";
const data = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--headless=new", "--no-sandbox"] });
  const context = await browser.newContext({ ...devices["iPhone 13"], locale: "ru-RU" });
  const page = await context.newPage();
  const out = {};
  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 180000 });
  await page.fill("#email", data.email);
  await page.fill("#password", data.password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120000 }), page.locator('button[type="submit"]').first().click()]);
  const docUrl = `/journals/incoming_control/documents/${data.documentId}`;
  await page.goto(`${BASE}${docUrl}`, { waitUntil: "load", timeout: 180000 });
  await page.waitForTimeout(3000);
  const ok = page.getByRole("button", { name: "Понятно" }).first();
  if (await ok.isVisible({ timeout: 4000 }).catch(() => false)) await ok.click();
  // An issue for the dev overlay, like the hydration errors in CI.
  await page.evaluate(() => { console.error("overlay-check: synthetic issue"); console.error("overlay-check: synthetic issue 2"); console.error("overlay-check: synthetic issue 3"); });
  await page.waitForTimeout(2500);
  out.portalCount = await page.evaluate(() => document.querySelectorAll("nextjs-portal").length);
  await page.getByRole("button", { name: /Ещё действия|More actions|Boshqa amallar/ }).first().click({ timeout: 20000 });
  await page.getByText("Подпись УКЭП").first().click({ timeout: 20000 });
  const ukep = page.locator("[data-ukep-dialog]");
  await ukep.waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${process.env.OUT_DIR || "."}/overlay-before.png` });
  try {
    await ukep.locator("[data-ukep-start]").click({ timeout: 5000 });
    out.withoutRemoval = "clicked";
  } catch (error) {
    out.withoutRemoval = /intercepts pointer events/.test(String(error)) ? "intercepted by nextjs-portal" : String(error).split("\n")[0];
  }
  await page.evaluate(() => document.querySelectorAll("nextjs-portal").forEach((node) => node.remove()));
  try {
    await ukep.locator("[data-ukep-start]").click({ timeout: 5000 });
    out.afterRemoval = "clicked";
  } catch (error) {
    out.afterRemoval = String(error).split("\n")[0];
  }
  out.signStepVisible = await ukep.locator("[data-ukep-sign], [data-ukep-signatures]").first().isVisible({ timeout: 10000 }).catch(() => false);
  console.log(JSON.stringify(out));
  await browser.close();
})().catch((error) => { console.error("CHECK FAILED", String(error).slice(0, 500)); process.exit(1); });
