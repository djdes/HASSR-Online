/* eslint-disable no-console */
// AC5/AC7/AC8a: бракераж на 1280px — автотемпература по блюду, «Изменить по очереди»,
// «Применить ко всем», «Повторить строку»; mini — та же полоса на 390px.
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page, type Locator } from "playwright";
import { whatsNewVersion } from "@/lib/whats-new-notes";

const BASE = process.env.BASE ?? "http://localhost:3020";
const ROOT = path.resolve(process.cwd(), ".agent/tasks/journal-qr-fill-2026-09/e2e");
const STATE = path.resolve(process.cwd(), ".agent/tasks/names-memory-2026-09/e2e/state.json");
const DOC = "/journals/finished_product/documents/cmt6j45tj0i0c82tstt9fjbvg";
const results: Record<string, unknown> = {};
const errors: string[] = [];
const shot = (p: Page, n: string) => p.screenshot({ path: path.join(ROOT, "shots", `edit-${n}.png`) });
const DIALOG = '[role="dialog"]';
const stamp = Date.now().toString().slice(-5);
const DISH_A = `E2E Ред A ${stamp}`;
const DISH_B = `E2E Ред B ${stamp}`;

async function settle(page: Page, ms = 1500) {
  await page.waitForTimeout(ms);
  await page.evaluate(() => document.querySelectorAll("nextjs-portal").forEach((el) => el.remove())).catch(() => null);
  const later = page.getByRole("button", { name: /Напомнить позже/ });
  if (await later.count()) await later.first().click().catch(() => {});
  await dismissWhatsNew(page);
}
async function dismissWhatsNew(page: Page) {
  for (let i = 0; i < 10; i += 1) {
    const modal = page.locator('[aria-labelledby="whats-new-title"]');
    if ((await modal.count()) === 0) return;
    await modal.locator('button[aria-label="Закрыть"]').first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(400);
    if ((await modal.count()) === 0) return;
    await page.evaluate(() => document.querySelectorAll('[aria-labelledby="whats-new-title"]').forEach((el) => el.remove()));
    await page.waitForTimeout(200);
  }
}
async function openAdd(page: Page) {
  await dismissWhatsNew(page);
  await page.getByRole("button", { name: /^Добавить$/ }).first().click();
  const item = page.getByRole("menuitem", { name: /Добавить изделие/ });
  if (await item.count()) await item.first().click();
  else await page.getByRole("button", { name: /^Добавить изделие$/ }).first().click();
  const dialog = page.locator(DIALOG).filter({ hasText: /Добавление новой строки/ });
  await dialog.waitFor({ state: "visible", timeout: 30_000 });
  return dialog;
}
const tempInput = (dialog: Locator) => dialog.locator('div:has(> label:has-text("T°C внутри продукта")) input').first();
async function rowCheckbox(page: Page, name: string) {
  return page.locator("tbody tr", { hasText: name }).first().locator('[role="checkbox"]').first();
}
async function rowsWith(page: Page, text: string) {
  return page.locator("tbody tr", { hasText: text }).count();
}

async function main() {
  const browser = await chromium.launch({ channel: "chrome" });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, storageState: STATE });
  await ctx.addInitScript("window.__name = (fn) => fn;");
  // «Что нового» уже просмотрено — иначе модалка перекрывает кнопки.
  await ctx.addInitScript(`try { localStorage.setItem("wesetup.last-seen-build-sha", ${JSON.stringify(whatsNewVersion())}); } catch {}`);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  try {
    await page.goto(`${BASE}${DOC}`, { waitUntil: "load", timeout: 240_000 });
    await settle(page, 3000);

    // AC5: строка A с температурой 71 → при повторном выборе A температура подставляется.
    let dialog = await openAdd(page);
    await dialog.getByLabel("Наименование изделия").fill(DISH_A);
    await tempInput(dialog).fill("71");
    await dialog.getByRole("button", { name: /^(Сохранить|Добавить запись)$/ }).click();
    await settle(page, 2500);
    dialog = await openAdd(page);
    await dialog.getByLabel("Наименование изделия").fill(DISH_A);
    await page.waitForTimeout(500);
    results.tempAutoValue = await tempInput(dialog).inputValue();
    results.tempAutoHint = await dialog.locator('[data-testid="product-temp-auto-hint"]').count();
    // Ручной ввод не перезаписывается сменой блюда.
    await tempInput(dialog).fill("65");
    await dialog.getByLabel("Наименование изделия").fill(DISH_B);
    await page.waitForTimeout(400);
    results.tempManualKept = await tempInput(dialog).inputValue();
    await shot(page, "temp-auto");
    await dialog.getByRole("button", { name: /^(Сохранить|Добавить запись)$/ }).click();
    await settle(page, 2500);
    results.rowsAB = (await rowsWith(page, DISH_A)) + (await rowsWith(page, DISH_B));

    // AC7: выделить A и B → «Изменить по очереди · 2» → (1 из 2) → сохранить → (2 из 2) → отмена → тост.
    await (await rowCheckbox(page, DISH_A)).click();
    await (await rowCheckbox(page, DISH_B)).click();
    await settle(page, 600);
    const editBtn = page.locator('[data-testid="selection-edit"]');
    results.editLabel = (await editBtn.textContent())?.trim();
    await editBtn.click();
    let ed = page.locator(DIALOG).filter({ hasText: /Изменение записи/ });
    await ed.waitFor({ state: "visible", timeout: 30_000 });
    results.seqTitle1 = (await ed.locator("h2").first().textContent())?.trim();
    results.seqName1 = await ed.getByLabel("Наименование изделия").inputValue();
    await tempInput(ed).fill("72");
    await shot(page, "seq-1");
    await ed.getByRole("button", { name: /^Сохранить$/ }).click();
    await settle(page, 2000);
    ed = page.locator(DIALOG).filter({ hasText: /Изменение записи/ });
    results.seqTitle2 = (await ed.locator("h2").first().textContent())?.trim();
    results.seqName2 = await ed.getByLabel("Наименование изделия").inputValue();
    await ed.getByRole("button", { name: /^Отмена$/ }).click();
    await settle(page, 800);
    results.seqToast = (await page.evaluate(() => document.body.innerText)).match(/Изменено \d из \d/)?.[0] ?? null;
    results.seqDialogClosed = (await page.locator(DIALOG).filter({ hasText: /Изменение записи/ }).count()) === 0;
    // Значение 72 проверяется по БД (rows-probe.ts): колонка температуры в таблице может быть скрыта.

    // AC8a: «Применить ко всем» — время снятия 12:34 у обеих.
    await settle(page, 500);
    if ((await page.locator('[data-testid="selection-apply"]').count()) === 0) {
      await (await rowCheckbox(page, DISH_A)).click();
      await (await rowCheckbox(page, DISH_B)).click();
    }
    await page.locator('[data-testid="selection-apply"]').click();
    const ap = page.locator('[data-testid="apply-to-selected"]');
    await ap.waitFor({ state: "visible", timeout: 30_000 });
    await ap.getByRole("textbox", { name: /Время снятия/ }).fill("12:34");
    await shot(page, "apply");
    await ap.getByRole("button", { name: /^Применить к/ }).click();
    await settle(page, 2500);
    results.applyToast = (await page.evaluate(() => document.body.innerText)).match(/Изменено строк: \d/)?.[0] ?? null;
    await shot(page, "apply-after");
    results.applyRowA = (await page.locator("tbody tr", { hasText: DISH_A }).first().innerText()).replace(/\s+/g, " ");
    results.applyA = (results.applyRowA as string).includes("12:34");
    results.applyB = (await page.locator("tbody tr", { hasText: DISH_B }).first().innerText()).includes("12:34");
    results.dishA = DISH_A;

    // «Повторить строку» — копия A.
    await page.getByRole("button", { name: "Снять выделение" }).click().catch(() => null);
    await settle(page, 500);
    await (await rowCheckbox(page, DISH_A)).click();
    await page.locator('[data-testid="selection-repeat"]').click();
    await settle(page, 2500);
    results.repeatRowsA = await rowsWith(page, DISH_A);
    await shot(page, "repeat");

    // Уборка: удалить все E2E-строки этого прогона (KEEP=1 — оставить для проверки по БД).
    if (process.env.KEEP === "1") throw new Error("KEEP");
    await page.getByRole("button", { name: "Снять выделение" }).click().catch(() => null);
    await settle(page, 500);
    for (const tr of await page.locator("tbody tr", { hasText: `E2E` }).all()) {
      await tr.locator('[role="checkbox"]').first().click();
    }
    await page.getByRole("button", { name: /^Удалить/ }).first().click();
    await settle(page, 800);
    const confirm = page.locator(DIALOG).getByRole("button", { name: /^Удалить$/ });
    if (await confirm.count()) await confirm.click();
    await settle(page, 2500);
    results.cleanupLeft = await rowsWith(page, "E2E");

    // Mini: та же полоса выделения на 390px.
    try {
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: STATE });
    await mctx.addInitScript("window.__name = (fn) => fn;");
    await mctx.addInitScript(`try { localStorage.setItem("wesetup.last-seen-build-sha", ${JSON.stringify(whatsNewVersion())}); } catch {}`);
    const mp = await mctx.newPage();
    await mp.goto(`${BASE}/mini/documents/cmt6j45tj0i0c82tstt9fjbvg`, { waitUntil: "load", timeout: 240_000 });
    await settle(mp, 3000);
    // Онбординг-тур Mini App перекрывает экран — снимаем его оверлеи.
    await mp.evaluate(() => document.querySelectorAll('[role="dialog"]').forEach((el) => { if (el.className.includes("z-[120]")) el.remove(); }));
    await mp.waitForTimeout(300);
    const tableBtn = mp.locator('[aria-label="Режим отображения"] button', { hasText: /Таблица/ }).first();
    results.miniToggle = await tableBtn.count();
    if (await tableBtn.count()) await tableBtn.click();
    await settle(mp, 1200);
    await shot(mp, "mini-table");
    const cb = mp.locator('tbody tr [role="checkbox"]').first();
    results.miniHasCheckbox = await cb.count();
    if (await cb.count()) {
      await cb.click();
      await settle(mp, 600);
      results.miniEditButton = await mp.locator('[data-testid="selection-edit"]').count();
      await shot(mp, "mini-bar");
    }
    await mctx.close();
    } catch (error) {
      results.miniError = error instanceof Error ? error.message.slice(0, 200) : String(error);
    }
  } finally {
    results.errors = errors;
    fs.writeFileSync(path.join(ROOT, "results-edit.json"), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 1));
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
