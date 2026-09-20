// Круг 14 (390px, dev 3020): черновик формы переживает обновление страницы и стирается после записи.
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";
const BASE = process.env.BASE ?? "http://localhost:3020";
const ROOT = path.resolve(process.cwd(), ".agent/tasks/journal-qr-fill-2026-09/e2e");
const ORG = "cmoe6rpt4000097ts71yb922y";
const probe = JSON.parse(fs.readFileSync(path.join(ROOT, "probe.json"), "utf8")) as { tokens: Record<string, string>; users: Array<{ id: string; email: string }> };
const seed = JSON.parse(fs.readFileSync(path.join(ROOT, "seed-objects.json"), "utf8")) as { rooms: Array<{ href: string }> };
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

  // ---- HTML холодильники: ввод → обновление → восстановлено; запись → черновик стёрт
  const coldUrl = `${BASE}/journal-fill/${ORG}/cold_equipment_control?token=${encodeURIComponent(probe.tokens.cold)}&employee=${E2E.id}`;
  await page.goto(coldUrl, { waitUntil: "load", timeout: 240_000 });
  await page.waitForSelector("#qr-form", { timeout: 120_000 });
  for (const input of await page.locator(".obj input.in").all()) await input.fill("");
  for (const box of await page.locator('input[name^="off:"]').all()) if (await box.isChecked()) await box.uncheck();
  await page.locator(".obj").nth(0).locator("input.in").fill("3");
  await page.locator(".obj").nth(1).locator('input[name^="off:"]').check();
  await page.waitForTimeout(400);
  out.draftStored = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("qr-draft:")).length);
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("#qr-form", { timeout: 60_000 });
  await page.waitForTimeout(300);
  out.afterReloadValue = await page.locator(".obj").nth(0).locator("input.in").inputValue();
  out.afterReloadOff = await page.locator(".obj").nth(1).locator('input[name^="off:"]').isChecked();
  out.afterReloadNote = (await page.locator("#draft-note").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
  await page.screenshot({ path: path.join(ROOT, "shots", "r14-restored.png"), fullPage: true });
  await page.locator(".obj").nth(2).locator(".qv .chip").nth(1).click();
  await page.locator("#qr-form button[type=submit]").click();
  await page.waitForURL((u) => u.search.includes("done="), { timeout: 60_000 });
  await page.waitForTimeout(300);
  out.draftAfterDone = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("qr-draft:")).length);
  // «Начать заново» стирает черновик
  await page.goto(coldUrl, { waitUntil: "load", timeout: 120_000 });
  await page.waitForSelector("#qr-form", { timeout: 60_000 });
  await page.locator(".obj").nth(0).locator("input.in").fill("9");
  await page.waitForTimeout(400);
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("#draft-note", { timeout: 60_000 });
  await page.locator("#draft-reset").click();
  await page.waitForSelector("#qr-form", { timeout: 60_000 });
  await page.waitForTimeout(300);
  out.afterResetNote = await page.locator("#draft-note").count();
  out.afterResetValue = await page.locator(".obj").nth(0).locator("input.in").inputValue();

  // ---- помещение: ввод → обновление → восстановлено с плашкой; запись → стёрто
  await page.goto(`${BASE}${seed.rooms[0].href}`, { waitUntil: "load", timeout: 240_000 });
  await page.waitForSelector("#room-fill-temperature", { timeout: 120_000 });
  await pickEmployee(page);
  await page.locator("#room-fill-temperature").fill("21");
  await page.locator("#room-fill-humidity").fill("55");
  await page.waitForTimeout(400);
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("#room-fill-temperature", { timeout: 120_000 });
  await page.waitForTimeout(500);
  out.roomAfterReload = { t: await page.locator("#room-fill-temperature").inputValue(), h: await page.locator("#room-fill-humidity").inputValue(), note: await page.locator("text=Восстановили введённое").count() };
  await page.screenshot({ path: path.join(ROOT, "shots", "r14-room-restored.png"), fullPage: true });
  await page.getByRole("button", { name: /Сохранить/ }).first().click();
  await page.waitForSelector("text=Записано", { timeout: 60_000 });
  await page.waitForTimeout(300);
  out.roomDraftAfterSave = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("wesetup.draft:room-fill")).length);

  fs.writeFileSync(path.join(ROOT, "results-round14.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();
