// Скриншот шапки журнала на заданной ширине (проверка промежуточных ширин).
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
const BASE = process.env.BASE ?? "http://localhost:3020";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const state = JSON.parse(fs.readFileSync(path.join(HERE, "qr-state.json"), "utf8"));
const CODES = (process.env.CODES ?? "sanitary_day_control").split(",");
const WIDTH = Number(process.env.WIDTH ?? 640);
(async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 240_000 });
  await page.fill("#email", state.users.manager.email);
  await page.fill("#password", state.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120_000 });
  await page.setViewportSize({ width: WIDTH, height: 700 });
  for (const code of CODES) {
    await page.goto(`${BASE}/journals/${code}`, { waitUntil: "load", timeout: 240_000 });
    await page.locator("[data-journal-list-actions]").first().waitFor({ timeout: 120_000 }).catch(() => null);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(HERE, "..", "shots", `qr-width-${WIDTH}-${code}.png`) });
  }
  await browser.close();
})();
