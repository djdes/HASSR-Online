// Ошибки консоли и Next-оверлея на страницах журналов (dev).
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
const BASE = process.env.BASE ?? "http://localhost:3020";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const state = JSON.parse(fs.readFileSync(path.join(HERE, "qr-state.json"), "utf8"));
const CODES = (process.env.CODES ?? "cleaning_ventilation_checklist,hygiene,accident_journal").split(",");
(async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text().slice(0, 6000)}`); });
  page.on("pageerror", (e) => errors.push(`[pageerror] ${String(e).slice(0, 400)}`));
  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 240_000 });
  await page.fill("#email", state.users.manager.email);
  await page.fill("#password", state.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120_000 });
  for (const code of CODES) {
    errors.push(`--- ${code}`);
    await page.goto(`${BASE}/journals/${code}`, { waitUntil: "load", timeout: 240_000 });
    await page.waitForTimeout(4000);
    const badge = page.locator("nextjs-portal");
    if (await badge.count()) {
      const text = await page.evaluate(`(() => { const p = document.querySelector("nextjs-portal"); const r = p && p.shadowRoot; return r ? r.textContent.slice(0, 1500) : ""; })()`);
      errors.push(`[overlay] ${String(text).replace(/\s+/g, " ").slice(0, 600)}`);
    }
  }
  console.log(errors.join("\n"));
  await browser.close();
})();
