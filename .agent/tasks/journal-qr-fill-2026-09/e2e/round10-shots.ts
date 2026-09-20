// Круг 10 (390px, dev 3020): «−»/«+» по бокам полей (HTML-форма, помещение,
// оборудование, форма задачи /task-fill), дата и время в подписях и в инструкции.
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

  // ---- HTML: холодильники (одна метрика — плавающая подпись между кнопками)
  await page.goto(`${BASE}/journal-fill/${ORG}/cold_equipment_control?token=${encodeURIComponent(probe.tokens.cold)}&employee=${E2E.id}`, { waitUntil: "load", timeout: 240_000 });
  await page.waitForSelector("#qr-form", { timeout: 120_000 });
  out.coldToday = (await page.locator(".today").innerText()).trim();
  out.coldLabel0 = (await page.locator(".obj").nth(0).locator("label").first().innerText()).replace(/\s+/g, " ");
  const c0 = page.locator(".obj").nth(0);
  const values: string[] = [];
  const read = async () => (await c0.locator("input.in").inputValue());
  await c0.locator("input.in").fill("");
  await c0.locator(".stp.minus").click(); values.push(await read()); // пусто → середина нормы
  await c0.locator(".stp.minus").click(); values.push(await read());
  await c0.locator(".stp.plus").click(); values.push(await read());
  await c0.locator(".stp.plus").click(); values.push(await read());
  out.coldStepSeq = values;
  out.coldGood = await c0.locator(".fl.good").count();
  await page.screenshot({ path: path.join(ROOT, "shots", "r10-cold.png"), fullPage: true });

  // ---- HTML: бракераж — время ±5 минут, температура блюда −/+
  await page.goto(`${BASE}/journal-fill/${ORG}/finished_product?token=${encodeURIComponent(probe.tokens.finished_product)}&employee=${E2E.id}`, { waitUntil: "load", timeout: 240_000 });
  await page.waitForSelector("#qr-form", { timeout: 120_000 });
  const timeInput = page.locator('input[type="time"]').first();
  const timeKey = await timeInput.getAttribute("name");
  const t0 = await timeInput.inputValue();
  await page.locator(`.stp.plus[data-step="${timeKey}"]`).click();
  const t1 = await timeInput.inputValue();
  await page.locator(`.stp.minus[data-step="${timeKey}"]`).click();
  await page.locator(`.stp.minus[data-step="${timeKey}"]`).click();
  const t2 = await timeInput.inputValue();
  out.fpTime = { t0, t1, t2 };
  const temp = page.locator("#f-productTemp");
  await temp.fill("75");
  await page.locator('.stp.plus[data-step="productTemp"]').click();
  out.fpTempPlus = await temp.inputValue();
  out.fpTempLabel = (await page.locator('label[for="f-productTemp"]').innerText()).replace(/\s+/g, " ");
  await page.screenshot({ path: path.join(ROOT, "shots", "r10-fp.png"), fullPage: true });

  // ---- помещение
  await page.goto(`${BASE}${seed.rooms[0].href}`, { waitUntil: "load", timeout: 240_000 });
  await page.waitForSelector("#room-fill-temperature", { timeout: 120_000 });
  await pickEmployee(page);
  await page.locator("#room-fill-temperature").fill("");
  await page.getByRole("button", { name: "Минус: температура на градус ниже" }).click();
  const r1 = await page.locator("#room-fill-temperature").inputValue();
  await page.getByRole("button", { name: "Плюс: температура на градус выше" }).click();
  await page.getByRole("button", { name: "Плюс: температура на градус выше" }).click();
  const r2 = await page.locator("#room-fill-temperature").inputValue();
  await page.getByRole("button", { name: "Плюс: влажность на процент выше" }).click();
  const h1 = await page.locator("#room-fill-humidity").inputValue();
  out.room = { r1, r2, h1, label: (await page.locator('label[for="room-fill-temperature"]').innerText()).replace(/\s+/g, " ") };
  await page.screenshot({ path: path.join(ROOT, "shots", "r10-room.png"), fullPage: true });

  // ---- оборудование
  await page.goto(`${BASE}${seed.equipment[1].href}`, { waitUntil: "load", timeout: 240_000 });
  await page.waitForSelector("input[inputmode=decimal]", { timeout: 120_000 });
  await pickEmployee(page);
  const eq = page.locator("input[inputmode=decimal]").first();
  await eq.fill("");
  await page.getByRole("button", { name: "Минус: температура на градус ниже" }).click();
  const e1 = await eq.inputValue();
  await page.getByRole("button", { name: "Минус: температура на градус ниже" }).click();
  const e2 = await eq.inputValue();
  out.equipment = { e1, e2, label: (await page.locator("label", { hasText: "Температура" }).first().innerText()).replace(/\s+/g, " ") };
  await page.screenshot({ path: path.join(ROOT, "shots", "r10-eq.png"), fullPage: true });

  // ---- ПК: форма задачи (TaskFillField) — если есть тестовая задача
  if (process.env.TASK_URL) {
    const pc = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const pp = await pc.newPage();
    await pp.goto(process.env.TASK_URL, { waitUntil: "load", timeout: 240_000 });
    await pp.waitForTimeout(1500);
    out.pcMinus = await pp.getByRole("button", { name: "Минус" }).count();
    await pp.screenshot({ path: path.join(ROOT, "shots", "r10-pc-task.png"), fullPage: true });
    await pc.close();
  }

  fs.writeFileSync(path.join(ROOT, "results-round10.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();
