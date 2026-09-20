// Отладка: почему на проде после выбора сотрудника не находится #qr-form.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
const BASE = "https://wesetup.ru";
const creds = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), ".agent/tasks/journal-fill-guide-2026-09/e2e/creds.json"), "utf8")) as { email: string; password: string };
(async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  const admin = await browser.newContext();
  const ap = await admin.newPage();
  await ap.goto(`${BASE}/login`, { waitUntil: "load", timeout: 120_000 });
  await ap.waitForTimeout(2500);
  await ap.locator("#email").fill(creds.email);
  await ap.locator("#password").fill(creds.password);
  await Promise.all([ap.waitForResponse((r) => r.url().includes("/api/auth/login")), ap.locator('button[type="submit"]').first().click()]);
  await ap.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120_000 });
  const r = await ap.request.get(`${BASE}/api/qr-fill/journal/cold_equipment_control`);
  const j = (await r.json()) as { poster?: { url?: string } };
  const href = String(j.poster?.url ?? "").replace(/^https?:\/\/[^/]+/, "");
  await admin.close();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const page = await ctx.newPage();
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) console.log("nav:", page.url().replace(/token=[^&]+/, "token=…")); });
  page.on("console", (m) => { if (m.type() === "error") console.log("console:", m.text().slice(0, 160)); });
  await page.goto(`${BASE}${href}`, { waitUntil: "load", timeout: 120_000 });
  console.log("step1 forms:", await page.locator("form").count(), "qr-form:", await page.locator("#qr-form").count());
  await page.locator('a[href*="employee="]').first().click();
  for (let i = 0; i < 6; i += 1) {
    await page.waitForTimeout(700);
    const html = await page.content();
    console.log(`t${i} qr-form(locator)=${await page.locator("#qr-form").count()} qr-form(html)=${html.includes('id="qr-form"')} forms=${await page.locator("form").count()} obj=${await page.locator(".obj").count()} len=${html.length}`);
  }
  const html = await page.content();
  fs.writeFileSync(path.resolve(process.cwd(), ".agent/tasks/journal-qr-fill-2026-09/e2e/prod-cold-page.html"), html.replace(/token=[^&"]+/g, "token=…"));
  await browser.close();
})();
