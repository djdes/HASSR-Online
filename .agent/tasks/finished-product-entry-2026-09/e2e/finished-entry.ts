// e2e finished-product-entry-2026-09: бракераж готовой продукции — «Добавить списком» с полями,
// правка ФИО в ячейке через подсказки, органолептика выпадающим списком.
// Запуск (dev на 3020 с wesetup_e2e): npx tsx .agent/tasks/finished-product-entry-2026-09/e2e/finished-entry.ts
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";

import { db, E2E_DATABASE_URL } from "../../journal-responsibles-org-2026-09/e2e/db";

const BASE = process.env.BASE ?? "http://localhost:3020";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SHOTS = path.join(HERE, "..", "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const state = JSON.parse(fs.readFileSync(path.join(HERE, "..", "..", "journal-responsibles-org-2026-09", "e2e", "state.json"), "utf8"));

const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail !== undefined ? ` :: ${JSON.stringify(detail).slice(0, 500)}` : ""}`);
};
type Row = { id: string; productName: string; organoleptic: string; responsiblePerson: string; inspectorName: string; productTemp: string; portionWeight?: string };
const rowsOf = async (id: string) =>
  (((await db.journalDocument.findUnique({ where: { id }, select: { config: true } }))?.config as { rows?: Row[] } | null)?.rows ?? []);

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 180_000 });
  await page.fill("#email", email);
  await page.fill("#password", state.password);
  await page.waitForLoadState("networkidle").catch(() => null);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.click('button[type="submit"]').catch(() => null);
    const left = await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45_000 }).then(() => true).catch(() => false);
    if (left) return;
    await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 180_000 });
    await page.fill("#email", email);
    await page.fill("#password", state.password);
    await page.waitForTimeout(1500);
  }
  throw new Error("login: форма не отправилась");
}

async function openDoc(page: Page, url: string) {
  await page.goto(url, { waitUntil: "load", timeout: 300_000 });
  await page.waitForTimeout(2500);
  const guide = page.locator('[role="dialog"][aria-labelledby="fill-guide-title"]');
  if (await guide.isVisible().catch(() => false)) {
    await guide.getByRole("button", { name: "Понятно" }).first().click().catch(() => page.keyboard.press("Escape"));
    await guide.waitFor({ state: "hidden", timeout: 15_000 }).catch(() => null);
  }
}

async function main() {
  process.env.DATABASE_URL = E2E_DATABASE_URL;
  process.env.DATABASE_URL_DIRECT = E2E_DATABASE_URL;
  const browser = await chromium.launch({ channel: "chrome",  headless: true });
  let id: string | null = null;
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await login(page, state.users.managerA.email);
    const now = new Date();
    const y = now.getUTCFullYear(), m = now.getUTCMonth();
    const pad = (n: number) => String(n).padStart(2, "0");
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const created = await ctx.request.post(`${BASE}/api/journal-documents`, {
      data: { templateCode: "finished_product", title: "E2E бракераж ввод", dateFrom: `${y}-${pad(m + 1)}-01`, dateTo: `${y}-${pad(m + 1)}-${pad(last)}`, force: true },
      timeout: 180_000,
    });
    id = (await created.json().catch(() => null))?.document?.id ?? null;
    check("документ бракеража создан", created.ok() && Boolean(id), created.status());
    const url = `${BASE}/journals/finished_product/documents/${id}`;
    await openDoc(page, url);
    // «Что нового» после смены заметок перекрывает страницу — закрываем.
    await page.locator('[aria-labelledby="whats-new-title"] button[aria-label="Закрыть"]').click({ timeout: 8_000 }).catch(() => {});
    // «Мы обновили условия» — принять.
    const terms = page.getByRole("button", { name: "Принять и продолжить" });
    if (await terms.isVisible().catch(() => false)) {
      await page.locator("div.fixed.inset-0 input[type=checkbox]").first().check();
      await terms.click();
      await terms.waitFor({ state: "hidden", timeout: 15_000 }).catch(() => null);
    }
    await page.locator('[aria-labelledby="whats-new-title"] button[aria-label="Закрыть"]').click({ timeout: 5_000 }).catch(() => {});

    // 1. «Добавить списком» — то же окно с полями.
    await page.getByRole("button", { name: "Добавить" }).first().click();
    await page.getByRole("menuitem", { name: "Добавить списком" }).click();
    const bulk = page.getByRole("dialog").filter({ hasText: "Добавить изделия списком" }).first();
    await bulk.waitFor({ timeout: 30_000 });
    const bulkText = await bulk.innerText();
    check(
      "списком: в окне есть общие поля (оценка, разрешение, ответственный, проводивший бракераж)",
      ["органолептическая оценка", "общие для всех изделий"].every((label) => bulkText.toLowerCase().includes(label)),
      bulkText.slice(0, 400)
    );
    // Таблица «Наименование | Выход»: у каждой строки свой выход.
    const bulkItems = [
      ["Борщ", "250"],
      ["Котлета", "150/50"],
      ["Компот", "200"],
    ] as const;
    const hasYieldColumn = (await bulk.getByLabel("Выход, строка 1", { exact: true }).count()) > 0;
    for (const [i, [name, grams]] of bulkItems.entries()) {
      await bulk.getByLabel(`Наименование, строка ${i + 1}`, { exact: true }).fill(name);
      if (hasYieldColumn) await bulk.getByLabel(`Выход, строка ${i + 1}`, { exact: true }).fill(grams);
    }
    const bulkTableText = await bulk.innerText();
    check(
      "списком: счётчик «Будет добавлено: 3», общего поля «Вес выход» нет",
      bulkTableText.includes("Будет добавлено: 3") && (await bulk.getByLabel("Вес выход, г", { exact: true }).count()) === 0,
      bulkTableText.slice(0, 300)
    );
    await bulk.getByRole("combobox", { name: "Органолептическая оценка" }).click();
    await page.getByRole("option", { name: "Хорошо" }).click();
    // Поля ФИО есть не во всех наборах колонок (форма Приложения №4 — без них).
    const responsibleField = bulk.getByRole("combobox", { name: "Ответственный исполнитель" });
    const hasPeople = (await responsibleField.count()) > 0;
    if (hasPeople) {
      await responsibleField.fill("Иван Повар");
      await responsibleField.blur();
    }
    await page.screenshot({ path: path.join(SHOTS, "bulk-dialog.png") });
    await bulk.getByRole("button", { name: "Добавить", exact: true }).click();
    await page.locator("[data-sonner-toast]", { hasText: "Добавлено строк: 3" }).first().waitFor({ timeout: 30_000 }).catch(() => null);
    let rows = await rowsOf(id!);
    for (let i = 0; i < 30 && rows.filter((row) => ["Борщ", "Котлета", "Компот"].includes(row.productName)).length < 3; i++) {
      await page.waitForTimeout(1000);
      rows = await rowsOf(id!);
    }
    console.log("TOASTS", await page.locator("[data-sonner-toast]").allInnerTexts());
    const bulkRows = rows.filter((row) => ["Борщ", "Котлета", "Компот"].includes(row.productName));
    check(
      "списком: три строки с общими полями (оценка «Хорошо», ФИО)",
      bulkRows.length === 3 &&
        bulkRows.every((row) => row.organoleptic === "Хорошо" && (!hasPeople || row.responsiblePerson === "Иван Повар")) &&
        (!hasYieldColumn || bulkItems.every(([name, grams]) => bulkRows.some((row) => row.productName === name && row.portionWeight === grams))),
      bulkRows
    );
    check("списком: у строк разные id", new Set(bulkRows.map((row) => row.id)).size === 3, bulkRows.map((row) => row.id));
    if (process.env.BULK_ONLY === "1") return;

    // 2. ФИО в ячейке таблицы: подсказки под ячейкой без подмены элемента, ввод сохраняется.
    await openDoc(page, url);
    const firstRow = page.locator("tbody tr", { hasText: "Борщ" }).first();
    const columnsHead = (await page.locator("thead th").allInnerTexts()).map((s) => s.replace(/\s+/g, " ").trim());
    const responsibleIdx = columnsHead.findIndex((text) => text.includes("Ответственный исполнитель"));
    const cell = firstRow.locator("td").nth(responsibleIdx).locator("textarea");
    await cell.click();
    const suggestions = page.getByRole("listbox", { name: "Подсказки" });
    check("ячейка ФИО: при фокусе виден список подсказок сотрудников", await suggestions.isVisible().catch(() => false));
    check("ячейка ФИО: поле не подменяется (тот же textarea в фокусе)", await cell.evaluate((el) => document.activeElement === el));
    await page.screenshot({ path: path.join(SHOTS, "cell-suggestions.png") });
    await suggestions.getByRole("option").filter({ hasNotText: "Иван Повар" }).first().click();
    await page.waitForTimeout(300);
    const pickedValue = await cell.inputValue();
    check("ячейка ФИО: выбор подсказки подставляет значение", pickedValue.length > 0 && pickedValue !== "Иван Повар", pickedValue);
    await cell.fill("Пётр Новый");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2500);
    const afterEdit = (await rowsOf(id!)).find((row) => row.productName === "Борщ");
    check("ячейка ФИО: ввод вручную сохраняется в документ", afterEdit?.responsiblePerson === "Пётр Новый", afterEdit);

    // Телефон: тот же ввод в ячейке через тач.
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, storageState: await ctx.storageState() });
    const phonePage = await phone.newPage();
    await openDoc(phonePage, url);
    const tableTab = phonePage.getByRole("tab", { name: /Таблица/ }).first();
    if (await tableTab.isVisible().catch(() => false)) await tableTab.click();
    await phonePage.waitForTimeout(800);
    const phoneRow = phonePage.locator("tbody tr", { hasText: "Котлета" }).first();
    const phoneCell = phoneRow.locator("td").nth(responsibleIdx).locator("textarea");
    await phoneCell.scrollIntoViewIfNeeded();
    await phoneCell.tap();
    check("телефон: после тапа ячейка ФИО в фокусе и подсказки видны", (await phoneCell.evaluate((el) => document.activeElement === el)) && (await phonePage.getByRole("listbox", { name: "Подсказки" }).isVisible().catch(() => false)));
    await phoneCell.fill("Ольга Тач");
    await phonePage.keyboard.press("Enter");
    await phonePage.waitForTimeout(2500);
    const afterPhone = (await rowsOf(id!)).find((row) => row.productName === "Котлета");
    check("телефон: ввод в ячейке ФИО сохраняется", afterPhone?.responsiblePerson === "Ольга Тач", afterPhone);
    await phone.close();

    // 3. Органолептика: список в окне записи и подсказки в ячейке.
    await openDoc(page, url);
    await page.getByRole("button", { name: "Добавить изделие" }).first().click();
    const dialog = page.getByRole("dialog").filter({ hasText: "Добавление новой строки" }).first();
    await dialog.waitFor({ timeout: 30_000 });
    await dialog.getByRole("combobox", { name: "Наименование изделия" }).fill("Суп");
    await dialog.getByRole("combobox", { name: "Органолептическая оценка" }).click();
    const optionNames = await page.getByRole("option").allInnerTexts();
    check("окно записи: список оценок", ["Отлично", "Хорошо", "Удовлетворительно", "Неудовлетворительно", "Своя формулировка…"].every((o) => optionNames.includes(o)), optionNames);
    await page.getByRole("option", { name: "Своя формулировка…" }).click();
    await dialog.getByRole("textbox", { name: "Своя формулировка оценки" }).fill("Соответствует требованиям");
    await page.screenshot({ path: path.join(SHOTS, "organoleptic-select.png") });
    await dialog.getByRole("button", { name: "Добавить запись" }).click();
    await page.waitForTimeout(2500);
    const soup = (await rowsOf(id!)).find((row) => row.productName === "Суп");
    check("окно записи: своя формулировка сохраняется", soup?.organoleptic === "Соответствует требованиям", soup);
    const organoIdx = columnsHead.findIndex((text) => text.includes("Органолептическая оценка"));
    const organoCell = page.locator("tbody tr", { hasText: "Компот" }).first().locator("td").nth(organoIdx).locator("textarea");
    await organoCell.click();
    const organoOptions = await page.getByRole("listbox", { name: "Подсказки" }).getByRole("option").allInnerTexts().catch(() => []);
    check("ячейка оценки: подсказки со стандартными оценками", organoOptions.includes("Отлично") && organoOptions.includes("Удовлетворительно"), organoOptions);
    await page.getByRole("listbox", { name: "Подсказки" }).getByRole("option", { name: "Удовлетворительно", exact: true }).click();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2500);
    const compote = (await rowsOf(id!)).find((row) => row.productName === "Компот");
    check("ячейка оценки: выбор подсказки сохраняется", compote?.organoleptic === "Удовлетворительно", compote);
    await ctx.close();
  } catch (error) {
    console.error("E2E ERROR", error);
    checks.push({ name: "e2e без исключений", ok: false, detail: String(error).slice(0, 800) });
  } finally {
    await browser.close();
    if (id) await db.journalDocument.delete({ where: { id } }).catch(() => null);
    const passed = checks.filter((c) => c.ok).length;
    fs.writeFileSync(path.join(HERE, "finished-entry.json"), JSON.stringify(checks, null, 2));
    console.log(`\n${passed}/${checks.length} PASS`);
    await db.$disconnect();
    process.exit(passed === checks.length ? 0 : 1);
  }
}

main();
