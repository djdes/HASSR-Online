// Круг 17 (390px, dev 3020): страницы объектов в каркасе HTML-формы (шапка в 2 строки, объект с «Сменить»,
// сотрудник шторкой с поиском), показания по центру; гигиена — «Здоров» по умолчанию и кнопки статуса.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
const BASE = process.env.BASE ?? "http://localhost:3020";
const ROOT = path.resolve(process.cwd(), ".agent/tasks/journal-qr-fill-2026-09/e2e");
const ORG = "cmoe6rpt4000097ts71yb922y";
const probe = JSON.parse(fs.readFileSync(path.join(ROOT, "probe.json"), "utf8")) as { tokens: Record<string, string>; users: Array<{ id: string; email: string }> };
const seed = JSON.parse(fs.readFileSync(path.join(ROOT, "seed-objects.json"), "utf8")) as { rooms: Array<{ href: string }>; equipment: Array<{ href: string }> };
const E2E = probe.users.find((u) => u.email === "e2e-fill-guide@wesetup.local")!;
const out: Record<string, unknown> = {};

(async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));

  // ---- помещение: шапка, объект, сотрудник шторкой
  await page.goto(`${BASE}${seed.rooms[0].href}`, { waitUntil: "load", timeout: 240_000 });
  await page.waitForSelector("#room-fill-temperature", { timeout: 120_000 });
  out.roomHeader = (await page.locator("header").innerText()).replace(/\s+/g, " ").trim();
  out.roomObjectRow = (await page.getByRole("button", { name: /Помещение/ }).first().innerText()).replace(/\s+/g, " ");
  await page.getByRole("button", { name: /Кто снимает показания/ }).first().click();
  await page.waitForSelector('input[aria-label="Поиск сотрудника"]', { timeout: 10_000 });
  out.roomSheetItems = await page.locator("[role=dialog] li").count();
  await page.locator('input[aria-label="Поиск сотрудника"]').fill("иванова");
  await page.waitForTimeout(150);
  out.roomSheetFiltered = await page.locator("[role=dialog] li:visible").count();
  await page.screenshot({ path: path.join(ROOT, "shots", "r17-room-sheet.png"), fullPage: false });
  await page.locator("[role=dialog] li button").first().click();
  await page.waitForTimeout(200);
  out.roomPicked = (await page.getByRole("button", { name: /Кто снимает показания/ }).first().innerText()).replace(/\s+/g, " ");
  await page.getByRole("group", { name: "Быстрый ввод: температура" }).getByRole("button", { name: "20", exact: true }).click();
  out.roomInputAlign = await page.locator("#room-fill-temperature").evaluate((el) => `${getComputedStyle(el).textAlign} ${getComputedStyle(el).fontSize}`);
  await page.getByRole("button", { name: /Помещение/ }).first().click();
  await page.waitForTimeout(200);
  out.roomSwitchList = await page.locator("a[href*='/room-fill/']").count();
  await page.screenshot({ path: path.join(ROOT, "shots", "r17-room.png"), fullPage: true });

  // ---- оборудование
  await page.goto(`${BASE}${seed.equipment[1].href}`, { waitUntil: "load", timeout: 240_000 });
  await page.waitForSelector("input[inputmode=decimal]", { timeout: 120_000 });
  out.eqHeader = (await page.locator("header").innerText()).replace(/\s+/g, " ").trim();
  await page.screenshot({ path: path.join(ROOT, "shots", "r17-eq.png"), fullPage: true });

  // ---- гигиена (HTML): статус кнопками, «Здоров» по умолчанию, строка сотрудника — шторка с поиском
  await page.goto(`${BASE}/journal-fill/${ORG}/hygiene?token=${encodeURIComponent(probe.tokens.hygiene)}&employee=${E2E.id}`, { waitUntil: "load", timeout: 240_000 });
  await page.waitForSelector("#qr-form", { timeout: 120_000 });
  out.hygSeg = await page.locator(".segb").allInnerTexts();
  out.hygChecked = await page.locator('input[type=radio][name=status]:checked').getAttribute("value");
  out.hygSelect = await page.locator("select[name=status]").count();
  await page.locator("[data-emp-open]").click();
  await page.waitForSelector("#emp-sheet:not([hidden])", { timeout: 5_000 });
  out.hygSheetItems = await page.locator("#emp-sheet [data-emp]").count();
  await page.locator("#emp-sheet-search").fill("иван");
  await page.waitForTimeout(150);
  out.hygSheetVisible = await page.locator("#emp-sheet [data-emp]:visible").count();
  await page.screenshot({ path: path.join(ROOT, "shots", "r17-hyg-sheet.png"), fullPage: false });
  await page.locator("#emp-sheet .sh-x").click();
  await page.locator(".segb").nth(1).click();
  out.hygAfterTap = await page.locator('input[type=radio][name=status]:checked').getAttribute("value");
  await page.screenshot({ path: path.join(ROOT, "shots", "r17-hyg.png"), fullPage: true });

  fs.writeFileSync(path.join(ROOT, "results-round17.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();
