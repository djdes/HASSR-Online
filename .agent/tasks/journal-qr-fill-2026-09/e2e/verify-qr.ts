/* eslint-disable no-console */
// AC1–AC3a: QR-ввод без cookies (390px): хаб → документ → сотрудник → форма → результат;
// невалидный токен; режимы pin/auth (переключаются set-mode.ts снаружи).
//   MODE=public|pin|auth npx tsx verify-qr.ts
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3020";
const MODE = process.env.MODE ?? "public";
const ROOT = path.resolve(process.cwd(), ".agent/tasks/journal-qr-fill-2026-09/e2e");
const probe = JSON.parse(fs.readFileSync(path.join(ROOT, "probe.json"), "utf8")) as {
  tokens: Record<string, string>;
  users: Array<{ id: string; name: string; email: string; role: string }>;
  docs: Record<string, { id: string; title: string } | null>;
};
const ORG = "cmoe6rpt4000097ts71yb922y";
const results: Record<string, unknown> = {};
const errors: string[] = [];
const shot = (p: Page, n: string) => p.screenshot({ path: path.join(ROOT, "shots", `qr-${MODE}-${n}.png`), fullPage: true });
fs.mkdirSync(path.join(ROOT, "shots"), { recursive: true });

const E2E = probe.users.find((u) => u.email === "e2e-fill-guide@wesetup.local")!;
const url = (code: string, token: string) => `${BASE}/journal-fill/${ORG}/${code}?token=${encodeURIComponent(token)}`;

async function settle(page: Page, ms = 1200) {
  await page.waitForTimeout(ms);
  await page.evaluate(() => document.querySelectorAll("nextjs-portal").forEach((el) => el.remove())).catch(() => null);
}

async function pickEmployee(page: Page, pin?: string) {
  const btn = page.getByRole("button", { name: new RegExp(E2E.name.split(" ")[0]) }).first();
  await btn.waitFor({ state: "visible", timeout: 60_000 });
  await btn.click();
  if (pin !== undefined) await page.getByPlaceholder("••••").fill(pin);
  await page.getByRole("button", { name: "Продолжить" }).click();
}

async function formLabels(page: Page) {
  return page.evaluate(() => Array.from(document.querySelectorAll("label")).map((l) => (l.textContent || "").trim()).filter(Boolean));
}

async function main() {
  const browser = await chromium.launch({ channel: "chrome" });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.addInitScript("window.__name = (fn) => fn;");
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  try {
    // --- невалидный токен
    await page.goto(url("hygiene", "bad.token"), { waitUntil: "load", timeout: 240_000 });
    await settle(page);
    results.badTokenPage = (await page.locator("h1").first().textContent())?.trim();
    const bad = await page.request.post(`${BASE}/api/journal-fill/${ORG}/hygiene`, { data: { token: "bad.token.value", documentId: "x", employeeId: E2E.id, rowKey: "employee-x", values: {} } });
    results.badTokenPost = bad.status();

    if (MODE === "auth") {
      // Без сессии — на вход с возвратом.
      await page.goto(url("hygiene", probe.tokens.hygiene), { waitUntil: "load", timeout: 240_000 });
      await settle(page, 2000);
      results.authRedirect = page.url();
      await shot(page, "auth-redirect");
      const post = await page.request.post(`${BASE}/api/journal-fill/${ORG}/hygiene`, { data: { token: probe.tokens.hygiene, documentId: probe.docs.hygiene!.id, employeeId: E2E.id, rowKey: `employee-${E2E.id}`, values: {} } });
      results.authPostNoSession = post.status();
      // С сессией: сотрудник фиксирован, списка нет.
      const authCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: path.resolve(process.cwd(), ".agent/tasks/names-memory-2026-09/e2e/state.json") });
      await authCtx.addInitScript("window.__name = (fn) => fn;");
      const ap = await authCtx.newPage();
      await ap.goto(url("hygiene", probe.tokens.hygiene), { waitUntil: "load", timeout: 240_000 });
      await settle(ap, 2500);
      results.authPageUrl = ap.url();
      results.authEmployeeButtons = await ap.getByRole("button", { name: /Продолжить/ }).count();
      results.authBody = (await ap.evaluate(() => document.body.innerText.slice(0, 400))).replace(/\s+/g, " ");
      await shot(ap, "auth-form");
      const save = ap.getByRole("button", { name: /Сохранить|Отметить|Записать/ }).first();
      if (await save.count()) {
        await save.click();
        await settle(ap, 2500);
        results.authResult = (await ap.locator("h2").first().textContent())?.trim();
        await shot(ap, "auth-result");
      }
      await authCtx.close();
      return;
    }

    // --- хаб
    await page.goto(url("all", probe.tokens.hub), { waitUntil: "load", timeout: 240_000 });
    await settle(page, 2500);
    results.hubBody = (await page.evaluate(() => document.body.innerText.slice(0, 300))).replace(/\s+/g, " ");
    results.hubLinks = await page.locator("a[href*='/journal-fill/']").count();
    await shot(page, "hub");

    // --- гигиена (per-employee, upsert)
    await page.goto(url("hygiene", probe.tokens.hygiene), { waitUntil: "load", timeout: 240_000 });
    await settle(page, 2500);
    if (MODE === "pin") {
      // Неверный PIN → отказ на POST.
      await pickEmployee(page, "9999");
      await settle(page, 2500);
      await page.getByRole("button", { name: /Сохранить|Отметить|Записать/ }).first().click();
      await settle(page, 2500);
      results.pinWrong = (await page.evaluate(() => document.body.innerText)).match(/Неверный PIN[^\n]*/)?.[0] ?? null;
      await shot(page, "pin-wrong");
      await page.getByRole("button", { name: "Сменить" }).click();
      await settle(page);
      await pickEmployee(page, "2580");
    } else {
      await pickEmployee(page);
    }
    await settle(page, 2500);
    results.hygieneLabels = await formLabels(page);
    await shot(page, "hygiene-form");
    await page.getByRole("button", { name: /Сохранить|Отметить|Записать/ }).first().click();
    await settle(page, 3000);
    results.hygieneResult = (await page.locator("h2").first().textContent())?.trim();
    results.hygieneDaily = (await page.evaluate(() => document.body.innerText)).includes("Дальше");
    results.hygieneBody = (await page.evaluate(() => document.body.innerText.slice(0, 500))).replace(/\s+/g, " ");
    await shot(page, "hygiene-result");

    // Повтор в тот же день — обновление, не дубль.
    await page.goto(url("hygiene", probe.tokens.hygiene), { waitUntil: "load", timeout: 240_000 });
    await settle(page, 2500);
    const proceed = page.getByRole("button", { name: "Продолжить" });
    if (await proceed.count()) {
      if (MODE === "pin") await page.getByPlaceholder("••••").fill("2580");
      await proceed.click();
    }
    await settle(page, 2500);
    results.hygieneRememberedEmployee = (await page.evaluate(() => document.body.innerText)).includes(E2E.name.split(" ")[0]);
    await page.getByRole("button", { name: /Сохранить|Отметить|Записать/ }).first().click();
    await settle(page, 3000);
    results.hygieneRepeatResult = (await page.locator("h2").first().textContent())?.trim();

    // --- бракераж (append, «Добавить ещё», подсказки, температура)
    const dish = `E2E QR ${Date.now().toString().slice(-5)}`;
    await page.goto(url("finished_product", probe.tokens.finished_product), { waitUntil: "load", timeout: 240_000 });
    await settle(page, 2500);
    const proceed2 = page.getByRole("button", { name: "Продолжить" });
    if (await proceed2.count()) {
      if (MODE === "pin") await page.getByPlaceholder("••••").fill("2580");
      await proceed2.click();
    }
    await settle(page, 2500);
    results.fpLabels = await formLabels(page);
    const nameInput = page.getByLabel(/Наименование/).first();
    await nameInput.fill(dish);
    const tempInput = page.getByLabel(/T°C|Температура/i).first();
    if (await tempInput.count()) await tempInput.fill("73");
    results.fpTimeChips = await page.getByRole("button", { name: /−30 мин/ }).count();
    results.fpChoiceChips = await page.getByRole("button", { name: /^(Отлично|Хорошо|Удовлетворительно|Неудовлетворительно)$/ }).count();
    if (await page.getByRole("button", { name: /^Хорошо$/ }).count()) {
      await page.getByRole("button", { name: /^Хорошо$/ }).click();
      results.fpChoiceApplied = await page.locator("#field-organoleptic").inputValue().catch(() => null);
    }
    results.fpHeaderAlign = await page.evaluate(() => {
      const label = document.querySelector('label[for="field-productionTime"]');
      const icon = label?.closest(".rounded-2xl")?.querySelector("span.size-10");
      if (!label || !icon) return null;
      const l = label.getBoundingClientRect(); const i = icon.getBoundingClientRect();
      return { labelCenter: Math.round(l.top + l.height / 2), iconCenter: Math.round(i.top + i.height / 2) };
    });
    results.fpTimeInputHeight = await page.locator("#field-productionTime").evaluate((el) => Math.round(el.getBoundingClientRect().height)).catch(() => null);
    await shot(page, "fp-form");
    await page.getByRole("button", { name: /Сохранить|Записать/ }).first().click();
    await settle(page, 3000);
    results.fpResult = (await page.locator("h2").first().textContent())?.trim();
    results.fpAddMore = await page.getByRole("button", { name: "Добавить ещё" }).count();
    await shot(page, "fp-result");
    // «Добавить ещё» → форма снова, недавнее блюдо в чипах, температура подставлена.
    await page.getByRole("button", { name: "Добавить ещё" }).click();
    await settle(page, 2500);
    const chip = page.getByRole("button", { name: dish }).first();
    results.fpRecentChip = await chip.count();
    if (await chip.count()) {
      await chip.click();
      await settle(page, 600);
      results.fpTempAuto = await page.getByLabel(/T°C|Температура/i).first().inputValue().catch(() => null);
    }
    await shot(page, "fp-again");

    // --- холодильники (per-employee, список ХО в форме)
    await page.goto(url("cold_equipment_control", probe.tokens.cold), { waitUntil: "load", timeout: 240_000 });
    await settle(page, 2500);
    const proceed3 = page.getByRole("button", { name: "Продолжить" });
    if (await proceed3.count()) {
      if (MODE === "pin") await page.getByPlaceholder("••••").fill("2580");
      await proceed3.click();
    }
    await settle(page, 2500);
    results.coldLabels = await formLabels(page);
    results.coldBody = (await page.evaluate(() => document.body.innerText.slice(0, 500))).replace(/\s+/g, " ");
    results.coldNumberInputs = await page.locator('input[type="number"], input[inputmode="decimal"]').count();
    await shot(page, "cold-form");

    // --- уборка (сущностные строки: выбор помещения)
    await page.goto(url("cleaning", probe.tokens.cleaning), { waitUntil: "load", timeout: 240_000 });
    await settle(page, 2500);
    const proceed4 = page.getByRole("button", { name: "Продолжить" });
    if (await proceed4.count()) {
      if (MODE === "pin") await page.getByPlaceholder("••••").fill("2580");
      await proceed4.click();
    }
    await settle(page, 2500);
    results.cleaningBody = (await page.evaluate(() => document.body.innerText.slice(0, 400))).replace(/\s+/g, " ");
    await shot(page, "cleaning-rows");

    // --- QR на документ: сразу документ, без выбора
    await page.goto(url("finished_product", probe.tokens.fpDoc), { waitUntil: "load", timeout: 240_000 });
    await settle(page, 2500);
    results.docTokenBody = (await page.evaluate(() => document.body.innerText.slice(0, 200))).replace(/\s+/g, " ");

    // --- лимитер: 31 POST подряд с пустыми values → где-то 429
    if (process.env.RATE === "1") {
      let got429 = 0;
      for (let i = 0; i < 35; i += 1) {
        const r = await page.request.post(`${BASE}/api/journal-fill/${ORG}/hygiene`, { data: { token: probe.tokens.hygiene, documentId: probe.docs.hygiene!.id, employeeId: "nope", rowKey: "employee-nope", values: {} } });
        if (r.status() === 429) got429 += 1;
      }
      results.rateLimited429 = got429;
    }
  } finally {
    results.errors = errors;
    fs.writeFileSync(path.join(ROOT, `results-qr-${MODE}.json`), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 1));
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
