// Скриншоты страниц замера помещения/оборудования (390px): кнопка ±, имя в две
// строки, быстрая смена объектов (полоса сверху, «Дальше» после записи).
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";
const BASE = process.env.BASE ?? "http://localhost:3020";
const ROOT = path.resolve(process.cwd(), ".agent/tasks/journal-qr-fill-2026-09/e2e");
const seed = JSON.parse(fs.readFileSync(path.join(ROOT, "seed-objects.json"), "utf8")) as {
  rooms: Array<{ id: string; name: string; href: string }>;
  equipment: Array<{ id: string; name: string; href: string }>;
};
const out: Record<string, unknown> = {};

async function pickEmployee(page: Page) {
  const trigger = page.locator("button[role=combobox]").first();
  await trigger.click();
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

  // --- помещение 1: ввод, ±, запись, «Дальше»
  await page.goto(`${BASE}${seed.rooms[0].href}`, { waitUntil: "load", timeout: 240_000 });
  await page.waitForSelector("#room-fill-temperature", { timeout: 120_000 });
  await pickEmployee(page);
  const temp = page.locator("#room-fill-temperature");
  await temp.fill("20");
  const sign = page.getByRole("button", { name: "Сменить знак" });
  await sign.click();
  out.roomSignAfterMinus = await temp.inputValue();
  await sign.click();
  out.roomSignAfterPlus = await temp.inputValue();
  await page.locator("#room-fill-humidity").fill("50");
  out.roomStrip = (await page.locator("text=Помещения").first().locator("xpath=ancestor::div[1]/following-sibling::div[1]").innerText()).replace(/\s+/g, " ");
  out.roomEmployeeTrigger = (await page.locator("button[role=combobox]").first().innerText()).replace(/\s+/g, " | ");
  await page.screenshot({ path: path.join(ROOT, "shots", "room-form.png"), fullPage: true });
  await page.getByRole("button", { name: /Записать|Сохранить/ }).first().click();
  await page.waitForSelector("text=Записано", { timeout: 60_000 });
  await page.waitForTimeout(300);
  out.roomNext = (await page.locator("a", { hasText: "Дальше:" }).first().innerText()).replace(/\s+/g, " ");
  out.roomCounter = (await page.locator("text=/снято \\d+ из \\d+/").first().innerText()).trim();
  await page.screenshot({ path: path.join(ROOT, "shots", "room-saved.png"), fullPage: true });

  // --- переход по «Дальше»: имя запомнено, первое помещение отмечено снятым
  await page.locator("a", { hasText: "Дальше:" }).first().click();
  await page.waitForSelector("#room-fill-temperature", { timeout: 120_000 });
  await page.waitForTimeout(300);
  out.room2Url = page.url().replace(/token=[^&]+/, "token=…");
  out.room2Trigger = (await page.locator("button[role=combobox]").first().innerText()).replace(/\s+/g, " | ");
  out.room2Strip = (await page.locator("[aria-current=true]").first().locator("xpath=..").innerText()).replace(/\s+/g, " ");
  await page.screenshot({ path: path.join(ROOT, "shots", "room-next.png"), fullPage: true });

  // --- оборудование: ±, полоса, запись
  await page.goto(`${BASE}${seed.equipment[1].href}`, { waitUntil: "load", timeout: 240_000 });
  await page.waitForSelector("input[inputmode=decimal]", { timeout: 120_000 });
  if (await page.locator("button[role=combobox]").count()) await pickEmployee(page);
  const et = page.locator("input[inputmode=decimal]").first();
  await et.fill("18");
  await page.getByRole("button", { name: "Сменить знак" }).first().click();
  out.eqSignAfterMinus = await et.inputValue();
  out.eqStrip = (await page.locator("[aria-current=true]").first().locator("xpath=..").innerText()).replace(/\s+/g, " ");
  await page.screenshot({ path: path.join(ROOT, "shots", "equipment-form.png"), fullPage: true });
  await page.getByRole("button", { name: /Записать|Сохранить/ }).first().click();
  await page.waitForSelector("text=Записано", { timeout: 60_000 });
  await page.waitForTimeout(300);
  out.eqNext = (await page.locator("a", { hasText: "Дальше:" }).first().innerText()).replace(/\s+/g, " ");
  await page.screenshot({ path: path.join(ROOT, "shots", "equipment-saved.png"), fullPage: true });

  fs.writeFileSync(path.join(ROOT, "results-objects.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();
