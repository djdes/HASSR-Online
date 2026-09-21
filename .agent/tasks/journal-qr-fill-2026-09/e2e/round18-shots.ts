// Круг 18 (390px, dev 3020): два замера в день → два крупных поля в одной карточке; запись и подстановка
// по обоим; без плашек «уже записано»/подсказки; показания 44px по центру; карточки в одном стиле.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { db } from "@/lib/db";
import { normalizeColdEquipmentEntryData } from "@/lib/cold-equipment-document";
const BASE = process.env.BASE ?? "http://localhost:3020";
const ROOT = path.resolve(process.cwd(), ".agent/tasks/journal-qr-fill-2026-09/e2e");
const ORG = "cmoe6rpt4000097ts71yb922y";
const COLD_DOC = "cmu3e8tav00gqd7tspsb35swv";
const probe = JSON.parse(fs.readFileSync(path.join(ROOT, "probe.json"), "utf8")) as { tokens: Record<string, string>; users: Array<{ id: string; email: string }> };
const seed = JSON.parse(fs.readFileSync(path.join(ROOT, "seed-objects.json"), "utf8")) as { coldItemIds: string[]; rooms: Array<{ href: string }> };
const E2E = probe.users.find((u) => u.email === "e2e-fill-guide@wesetup.local")!;
const out: Record<string, unknown> = {};

(async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  const coldUrl = `${BASE}/journal-fill/${ORG}/cold_equipment_control?token=${encodeURIComponent(probe.tokens.cold)}&employee=${E2E.id}`;
  await page.goto(coldUrl, { waitUntil: "load", timeout: 240_000 });
  await page.waitForSelector("#qr-form", { timeout: 120_000 });
  out.cards = await page.locator(".obj").count();
  out.cardTitles = await page.locator(".obj-t").allInnerTexts();
  out.card2Labels = await page.locator(".obj").nth(1).locator("label[for]").allInnerTexts();
  out.noteCount = await page.locator(".note").count();
  out.hintCount = await page.locator("p.hint[style]").count();
  out.valueFont = await page.locator(".obj input.in").first().evaluate((el) => `${getComputedStyle(el).fontSize} ${getComputedStyle(el).textAlign}`);
  out.offChips = await page.locator(".chip.offc").count();
  // заполнить: карточка 1 — середина; карточка 2 — оба замера; карточка 3 — середина
  await page.locator(".obj").nth(0).locator(".qv .chip").nth(1).click();
  const c2 = page.locator(".obj").nth(1);
  await c2.locator("input.in").nth(0).fill("-19");
  await c2.locator("input.in").nth(1).fill("-17");
  await page.locator(".obj").nth(2).locator(".qv .chip").nth(1).click();
  await page.screenshot({ path: path.join(ROOT, "shots", "r18-cold.png"), fullPage: true });
  await page.locator("#qr-form button[type=submit]").click();
  await page.waitForURL((u) => u.search.includes("done="), { timeout: 60_000 });
  out.done = new URL(page.url()).searchParams.get("done");
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  const entry = await db.journalDocumentEntry.findFirst({ where: { documentId: COLD_DOC, employeeId: E2E.id, date: today }, select: { data: true } });
  const data = normalizeColdEquipmentEntryData(entry?.data ?? null);
  const id2 = seed.coldItemIds[1];
  out.dbSlots = { first: data.temperatures[id2] ?? null, second: data.temperatures[`${id2}#2`] ?? null, other: data.temperatures[seed.coldItemIds[0]] ?? null };
  await page.goto(coldUrl, { waitUntil: "load", timeout: 120_000 });
  await page.waitForSelector("#qr-form", { timeout: 60_000 });
  out.reopenCard2 = await c2.locator("input.in").evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
  await page.screenshot({ path: path.join(ROOT, "shots", "r18-cold-reopen.png"), fullPage: true });

  // помещение: показание крупно
  await page.goto(`${BASE}${seed.rooms[0].href}`, { waitUntil: "load", timeout: 240_000 });
  await page.waitForSelector("#room-fill-temperature", { timeout: 120_000 });
  out.roomValueFont = await page.locator("#room-fill-temperature").evaluate((el) => `${getComputedStyle(el).fontSize} ${getComputedStyle(el).textAlign}`);
  await page.getByRole("group", { name: "Быстрый ввод: температура" }).getByRole("button", { name: "20", exact: true }).click();
  await page.screenshot({ path: path.join(ROOT, "shots", "r18-room.png"), fullPage: true });

  await db.$disconnect();
  fs.writeFileSync(path.join(ROOT, "results-round18.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();
