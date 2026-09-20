// Круг 11 (390px, dev 3020): пустое обязательное поле → понятная ошибка с подсветкой;
// чип «Выключено» → прочерк с пометкой в журнале, руководитель уведомлён; без JS — тоже.
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
const seed = JSON.parse(fs.readFileSync(path.join(ROOT, "seed-objects.json"), "utf8")) as { coldItemIds: string[] };
const E2E = probe.users.find((u) => u.email === "e2e-fill-guide@wesetup.local")!;
const out: Record<string, unknown> = {};

(async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  const coldUrl = `${BASE}/journal-fill/${ORG}/cold_equipment_control?token=${encodeURIComponent(probe.tokens.cold)}&employee=${E2E.id}`;

  // ---- с JS: пустые поля → ошибка; «Выключено» → запись
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto(coldUrl, { waitUntil: "load", timeout: 240_000 });
  await page.waitForSelector("#qr-form", { timeout: 120_000 });
  for (const input of await page.locator(".obj input.in").all()) await input.fill("");
  for (const box of await page.locator('input[name^="off:"]').all()) if (await box.isChecked()) await box.uncheck();
  await page.locator("#qr-form button[type=submit]").click();
  await page.waitForSelector(".err", { timeout: 60_000 });
  out.emptyError = (await page.locator(".err").innerText()).trim();
  out.emptyBad = await page.locator(".fl.bad").count();
  out.offChips = await page.locator(".chip.offc").allInnerTexts();
  await page.screenshot({ path: path.join(ROOT, "shots", "r11-empty-error.png"), fullPage: true });
  // Первый холодильник выключен, остальные — середина нормы
  await page.locator('input[name^="off:"]').first().check();
  out.offStatus = (await page.locator(".obj").nth(0).locator(".st").innerText()).trim();
  out.offRequiredLeft = await page.locator("#qr-form .in[aria-required]").count();
  const cards = await page.locator(".obj").count();
  for (let i = 1; i < cards; i += 1) await page.locator(".obj").nth(i).locator(".qv .chip").nth(1).click();
  out.progress = (await page.locator("#prog").innerText()).trim();
  await page.screenshot({ path: path.join(ROOT, "shots", "r11-off.png"), fullPage: true });
  await page.locator("#qr-form button[type=submit]").click();
  await page.waitForURL((u) => u.search.includes("done="), { timeout: 60_000 });
  out.doneUrlOff = new URL(page.url()).searchParams.get("off");
  out.resultText = (await page.locator(".card.center").innerText()).replace(/\s+/g, " ").trim();
  await page.screenshot({ path: path.join(ROOT, "shots", "r11-result.png"), fullPage: true });
  // повторное открытие: «Выключено» отмечено, поле погашено
  await page.goto(coldUrl, { waitUntil: "load", timeout: 120_000 });
  await page.waitForSelector("#qr-form", { timeout: 60_000 });
  out.reopenOffChecked = await page.locator('input[name^="off:"]').first().isChecked();
  out.reopenOffClass = await page.locator(".obj").nth(0).locator(".fl").getAttribute("class");
  await ctx.close();

  // ---- запись в БД: прочерк + пометка «Выключено»
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  const entry = await db.journalDocumentEntry.findFirst({ where: { documentId: COLD_DOC, employeeId: E2E.id, date: today }, select: { data: true } });
  const data = normalizeColdEquipmentEntryData(entry?.data ?? null);
  out.dbTemperatures = seed.coldItemIds.map((id) => data.temperatures[id] ?? null);
  out.dbCorrections = seed.coldItemIds.map((id) => data.corrections?.[id] ?? null);
  const notif = await db.notification.findFirst({ where: { organizationId: ORG, kind: "qr-fill-off" }, orderBy: { updatedAt: "desc" }, select: { title: true } }).catch(() => null);
  out.notification = notif?.title ?? null;

  // ---- без JS: чекбокс работает как обычный чекбокс формы
  const nojs = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, javaScriptEnabled: false });
  const np = await nojs.newPage();
  await np.goto(coldUrl, { waitUntil: "load", timeout: 120_000 });
  for (const input of await np.locator(".obj input.in").all()) await input.fill("");
  for (const box of await np.locator('input[name^="off:"]').all()) if (await box.isChecked()) await box.uncheck();
  await np.locator("#qr-form button[type=submit]").click();
  await np.waitForSelector(".err", { timeout: 60_000 });
  out.nojsEmptyError = (await np.locator(".err").innerText()).trim().slice(0, 80);
  for (const box of await np.locator('input[name^="off:"]').all()) await box.check();
  await np.locator("#qr-form button[type=submit]").click();
  await np.waitForURL((u) => u.search.includes("done="), { timeout: 60_000 });
  out.nojsDoneOff = new URL(np.url()).searchParams.get("off");
  await nojs.close();
  const entry2 = await db.journalDocumentEntry.findFirst({ where: { documentId: COLD_DOC, employeeId: E2E.id, date: today }, select: { data: true } });
  const data2 = normalizeColdEquipmentEntryData(entry2?.data ?? null);
  out.nojsDbCorrections = seed.coldItemIds.map((id) => data2.corrections?.[id] ?? null);

  await db.$disconnect();
  fs.writeFileSync(path.join(ROOT, "results-round11.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();
