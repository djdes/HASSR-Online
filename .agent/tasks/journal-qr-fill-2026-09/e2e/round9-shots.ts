// Круг 9 (390px, dev 3020): быстрые значения под полями, подстановка сегодняшних
// показаний при повторном открытии, отступы чипов в блоке отклонения.
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";
const BASE = process.env.BASE ?? "http://localhost:3020";
const ROOT = path.resolve(process.cwd(), ".agent/tasks/journal-qr-fill-2026-09/e2e");
const ORG = "cmoe6rpt4000097ts71yb922y";
const probe = JSON.parse(fs.readFileSync(path.join(ROOT, "probe.json"), "utf8")) as { tokens: Record<string, string>; users: Array<{ id: string; email: string }> };
const seed = JSON.parse(fs.readFileSync(path.join(ROOT, "seed-objects.json"), "utf8")) as { rooms: Array<{ href: string }>; equipment: Array<{ href: string }> };
const E2E = probe.users.find((u) => u.email === "e2e-fill-guide@wesetup.local")!;
const CODE = process.env.COLD_CODE ?? "cold_equipment_control";
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

  // ---- HTML-форма холодильников: чипы, ввод касанием, запись, повторное открытие
  const coldUrl = `${BASE}/journal-fill/${ORG}/${CODE}?token=${encodeURIComponent(probe.tokens.cold)}&employee=${E2E.id}`;
  await page.goto(coldUrl, { waitUntil: "load", timeout: 240_000 });
  await page.waitForSelector("#qr-form", { timeout: 120_000 });
  await page.waitForTimeout(300);
  out.coldNoticeBefore = await page.locator(".note").count();
  const cards = page.locator(".obj");
  out.coldCards = await cards.count();
  out.coldChipRows = await page.locator(".chips.qv").count();
  out.coldChips0 = await page.locator(".obj").nth(0).locator(".qv .chip").allInnerTexts();
  out.coldChips1 = await page.locator(".obj").nth(1).locator(".qv .chip").allInnerTexts();
  await page.screenshot({ path: path.join(ROOT, "shots", "r9-cold-form.png"), fullPage: true });
  // отклонение: 80 → блок с чипами, скрин отступов
  const first = page.locator(".obj").nth(0).locator("input.in");
  await first.fill("80");
  await page.waitForTimeout(200);
  out.coldDevVisible = await page.locator("#deviation").isVisible();
  await page.locator("#deviation").screenshot({ path: path.join(ROOT, "shots", "r9-dev-chips.png") });
  // касанием: середина нормы в каждой карточке
  for (let i = 0; i < out.coldCards as number; i += 1) {
    const chips = page.locator(".obj").nth(i).locator(".qv .chip");
    await chips.nth(1).click();
    await page.waitForTimeout(100);
  }
  out.coldValuesAfterChips = await page.locator(".obj input.in").evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
  out.coldGoodCount = await page.locator(".fl.good").count();
  out.coldChipOn = await page.locator(".qv .chip.on").count();
  out.coldDevHiddenAfter = !(await page.locator("#deviation").isVisible());
  await page.screenshot({ path: path.join(ROOT, "shots", "r9-cold-filled.png"), fullPage: true });
  await page.locator("#qr-form button[type=submit]").click();
  await page.waitForURL((u) => u.search.includes("done="), { timeout: 60_000 });
  out.coldDone = new URL(page.url()).searchParams.get("done");
  // повторное открытие — значения подставлены
  await page.goto(coldUrl, { waitUntil: "load", timeout: 120_000 });
  await page.waitForSelector("#qr-form", { timeout: 60_000 });
  out.coldNotice = (await page.locator(".note").first().innerText().catch(() => "")).trim();
  out.coldPrefilled = await page.locator(".obj input.in").evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
  out.coldPrefilledOn = await page.locator(".qv .chip.on").count();
  await page.screenshot({ path: path.join(ROOT, "shots", "r9-cold-prefilled.png"), fullPage: true });

  // ---- помещение: чипы, запись, повторное открытие
  await page.goto(`${BASE}${seed.rooms[0].href}`, { waitUntil: "load", timeout: 240_000 });
  await page.waitForSelector("#room-fill-temperature", { timeout: 120_000 });
  await pickEmployee(page);
  out.roomTempChips = await page.getByRole("group", { name: "Быстрый ввод температуры" }).locator("button").allInnerTexts();
  out.roomHumChips = await page.getByRole("group", { name: "Быстрый ввод влажности" }).locator("button").allInnerTexts();
  await page.getByRole("group", { name: "Быстрый ввод температуры" }).getByRole("button", { name: "20", exact: true }).click();
  await page.getByRole("group", { name: "Быстрый ввод влажности" }).getByRole("button", { name: "50", exact: true }).click();
  out.roomTemp = await page.locator("#room-fill-temperature").inputValue();
  out.roomHum = await page.locator("#room-fill-humidity").inputValue();
  await page.screenshot({ path: path.join(ROOT, "shots", "r9-room-form.png"), fullPage: true });
  await page.getByRole("button", { name: /Сохранить/ }).first().click();
  await page.waitForSelector("text=Записано", { timeout: 60_000 });
  await page.goto(`${BASE}${seed.rooms[0].href}`, { waitUntil: "load", timeout: 120_000 });
  await page.waitForSelector("#room-fill-temperature", { timeout: 120_000 });
  out.roomReopenTemp = await page.locator("#room-fill-temperature").inputValue();
  out.roomReopenHum = await page.locator("#room-fill-humidity").inputValue();
  out.roomReopenNote = await page.locator("text=Сегодня уже записано").count();
  await page.screenshot({ path: path.join(ROOT, "shots", "r9-room-prefilled.png"), fullPage: true });

  // ---- оборудование (морозильник -20…-16)
  await page.goto(`${BASE}${seed.equipment[1].href}`, { waitUntil: "load", timeout: 240_000 });
  await page.waitForSelector("input[inputmode=decimal]", { timeout: 120_000 });
  await pickEmployee(page);
  out.eqChips = await page.getByRole("group", { name: "Быстрый ввод температуры" }).locator("button").allInnerTexts();
  await page.getByRole("group", { name: "Быстрый ввод температуры" }).getByRole("button", { name: "-18", exact: true }).click();
  out.eqTemp = await page.locator("input[inputmode=decimal]").first().inputValue();
  await page.screenshot({ path: path.join(ROOT, "shots", "r9-eq-form.png"), fullPage: true });
  await page.getByRole("button", { name: /Сохранить/ }).first().click();
  await page.waitForSelector("text=Записано", { timeout: 60_000 });
  await page.goto(`${BASE}${seed.equipment[1].href}`, { waitUntil: "load", timeout: 120_000 });
  await page.waitForSelector("input[inputmode=decimal]", { timeout: 120_000 });
  out.eqReopenTemp = await page.locator("input[inputmode=decimal]").first().inputValue();
  out.eqReopenNote = await page.locator("text=Сегодня уже записано").count();
  await page.screenshot({ path: path.join(ROOT, "shots", "r9-eq-prefilled.png"), fullPage: true });

  fs.writeFileSync(path.join(ROOT, "results-round9.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();
