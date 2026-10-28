// Что видит руководитель в Mini App вне Telegram (e2e-база, порт 3020).
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

const dir = ".agent/tasks/deploy-server-pull-2026-10-28/raw/reverify";
const seed = JSON.parse(readFileSync(".agent/tasks/journals-point-mode-2026-10-28/raw/seed.json", "utf8"));
const base = "http://localhost:3020";
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(`${base}/login`, { timeout: 420000 });
await page.fill("#email", seed.manager);
await page.fill("#password", "Verify-2026!");
await page.keyboard.press("Enter");
await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 420000 });
for (const path of ["/mini", "/mini/sections"]) {
  await page.goto(`${base}${path}`, { timeout: 420000 });
  await page.waitForTimeout(30000);
  console.log("URL", path, "→", page.url());
  console.log("aria-pressed buttons:", await page.locator("button[aria-pressed]").count());
  console.log((await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 600));
  await page.screenshot({ path: `${dir}/debug${path.replace(/\//g, "-")}.png`, fullPage: true });
}
await browser.close();
