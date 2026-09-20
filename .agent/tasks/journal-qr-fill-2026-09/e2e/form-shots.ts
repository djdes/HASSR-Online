// Скриншоты формы (390px): шапка, «Вы», пункты, плавающие подписи, живая проверка нормы.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
const BASE = process.env.BASE ?? "http://localhost:3020";
const ROOT = path.resolve(process.cwd(), ".agent/tasks/journal-qr-fill-2026-09/e2e");
const probe = JSON.parse(fs.readFileSync(path.join(ROOT, "probe.json"), "utf8")) as { tokens: Record<string, string>; users: Array<{ id: string; email: string }> };
const ORG = "cmoe6rpt4000097ts71yb922y";
const E2E = probe.users.find((u) => u.email === "e2e-fill-guide@wesetup.local")!;
(async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  for (const code of ["finished_product", "hygiene"]) {
    const t = code === "hygiene" ? probe.tokens.hygiene : probe.tokens.finished_product;
    await page.goto(`${BASE}/journal-fill/${ORG}/${code}?token=${encodeURIComponent(t)}&employee=${E2E.id}`, { waitUntil: "load", timeout: 240_000 });
    await page.waitForSelector("#qr-form", { timeout: 120_000 });
    await page.waitForTimeout(400);
    if (code === "finished_product") {
      await page.locator("#f-productName").fill("Борщ украинский");
      await page.locator("#f-productTemp").fill("135");
      await page.waitForTimeout(200);
    }
    await page.screenshot({ path: path.join(ROOT, "shots", `form-${code}.png`), fullPage: true });
    console.log(code, "steps:", await page.evaluate(() => Array.from(document.querySelectorAll(".steps li")).map((l) => l.textContent?.trim())));
    console.log(code, "who:", (await page.locator(".who").first().innerText()).replace(/\s+/g, " "));
    if (code === "finished_product") console.log("live:", await page.locator("#f-productTemp").evaluate((el) => `${el.closest(".fl")?.className} | ${el.closest(".fl")?.querySelector(".st")?.textContent}`));
  }
  await browser.close();
})();
