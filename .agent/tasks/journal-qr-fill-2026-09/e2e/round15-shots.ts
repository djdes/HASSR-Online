// Круг 15 (390px, dev 3020): страницы помещения и оборудования в виде карточек HTML-формы (ReadingField).
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";
const BASE = process.env.BASE ?? "http://localhost:3020";
const ROOT = path.resolve(process.cwd(), ".agent/tasks/journal-qr-fill-2026-09/e2e");
const ORG = "cmoe6rpt4000097ts71yb922y";
const probe = JSON.parse(fs.readFileSync(path.join(ROOT, "probe.json"), "utf8")) as { tokens: Record<string, string>; users: Array<{ id: string; email: string }> };
const seed = JSON.parse(fs.readFileSync(path.join(ROOT, "seed-objects.json"), "utf8")) as { rooms: Array<{ href: string }>; equipment: Array<{ href: string }> };
const E2E = probe.users.find((u) => u.email === "e2e-fill-guide@wesetup.local")!;
const out: Record<string, unknown> = {};

async function pickEmployee(page: Page) {
  if (!(await page.locator("button[role=combobox]").count())) return;
  await page.locator("button[role=combobox]").first().click();
  const option = page.locator("[role=option]").filter({ hasText: "Гид" }).first();
  if (await option.count()) await option.click();
  else await page.locator("[role=option]").first().click();
  await page.waitForTimeout(150);
}

(async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));

  // ---- помещение
  await page.goto(`${BASE}${seed.rooms[0].href}`, { waitUntil: "load", timeout: 240_000 });
  await page.waitForSelector("#room-fill-temperature", { timeout: 120_000 });
  await pickEmployee(page);
  await page.locator("#room-fill-temperature").fill("");
  await page.getByRole("button", { name: "Минус: температура на шаг ниже" }).click();
  const r1 = await page.locator("#room-fill-temperature").inputValue();
  await page.getByRole("button", { name: "Плюс: температура на шаг выше" }).click();
  await page.getByRole("button", { name: "Плюс: температура на шаг выше" }).click();
  const r2 = await page.locator("#room-fill-temperature").inputValue();
  await page.getByRole("button", { name: "Плюс: влажность на шаг выше" }).click();
  const h1 = await page.locator("#room-fill-humidity").inputValue();
  out.room = { r1, r2, h1, label: (await page.locator('label[for="room-fill-temperature"]').innerText()).replace(/\s+/g, " ") };
  await page.screenshot({ path: path.join(ROOT, "shots", "r15-room.png"), fullPage: true });

  // ---- оборудование
  await page.goto(`${BASE}${seed.equipment[1].href}`, { waitUntil: "load", timeout: 240_000 });
  await page.waitForSelector("input[inputmode=decimal]", { timeout: 120_000 });
  await pickEmployee(page);
  const eq = page.locator("input[inputmode=decimal]").first();
  await eq.fill("");
  await page.getByRole("button", { name: "Минус: температура на шаг ниже" }).click();
  const e1 = await eq.inputValue();
  await page.getByRole("button", { name: "Минус: температура на шаг ниже" }).click();
  const e2 = await eq.inputValue();
  out.equipment = { e1, e2, label: (await page.locator("label", { hasText: "Температура" }).first().innerText()).replace(/\s+/g, " ") };
  await page.screenshot({ path: path.join(ROOT, "shots", "r15-eq.png"), fullPage: true });

  fs.writeFileSync(path.join(ROOT, "results-round15.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();
