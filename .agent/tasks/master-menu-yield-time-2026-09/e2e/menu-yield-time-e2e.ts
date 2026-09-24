/**
 * E2E «меню мастер-кабинета списком: Наименование | Выход | Время» против
 * своей базы (wesetup_wt_mc2) и dev-сервера (E2E_BASE, по умолчанию
 * http://localhost:3036).
 *
 * Пул: пищеблоки X и Y (Y подключён к коду X) + мастер-кабинет X; Z — без
 * пула (контроль «без мастера как раньше»).
 *   1. Мастер: таблица меню, вставка из Excel (3 столбца с шапкой и
 *      нумерацией, 2 столбца без шапки, столбец времени) → предпросмотр →
 *      сохранение; правка (выход, удаление, новое блюдо) → «Изменится»;
 *      файл xlsx с «Вес порции» / «Время выдачи».
 *   2. Кухня Y на сайте: окно строки (выход + время из меню, ручное не
 *      перезаписывается, своё значение кухни приоритетнее) и «Добавить списком».
 *   3. Кухня Y по QR: выход и время из меню, ручное не перезаписывается.
 * Скриншоты 1440 и 390 → ../shots. Временные организации удаляются.
 *
 * Run: E2E_BASE=http://localhost:3036 npx tsx .agent/tasks/master-menu-yield-time-2026-09/e2e/menu-yield-time-e2e.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import * as XLSX from "xlsx";
import { chromium, type BrowserContext, type Page } from "playwright-core";

import { db } from "@/lib/db";
import { ensureServiceCode, linkDishPool } from "@/lib/dish-pool";
import { LEGAL_VERSION } from "@/lib/legal-consent";
import { createOrInviteMasterCabinet } from "@/lib/master-cabinet";
import { listNameSuggestions } from "@/lib/name-suggestions-db";
import { mintQrFillToken } from "@/lib/qr-fill-token";

const BASE = process.env.E2E_BASE ?? "http://localhost:3036";
const TASK_DIR = path.resolve(__dirname, "..");
const SHOTS = path.join(TASK_DIR, "shots");
const TMP = path.join(__dirname, "tmp");
const CHROME =
  process.env.E2E_CHROME ??
  path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium-1232", "chrome-win64", "chrome.exe");
const stamp = Date.now().toString(36);
const password = "Test12345!";

fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

const results: Array<{ check: string; ok: boolean; detail?: unknown }> = [];
async function check(name: string, fn: () => void | Promise<void>, detail?: unknown) {
  try {
    await fn();
    results.push({ check: name, ok: true, detail });
    console.log("PASS", name);
  } catch (err) {
    results.push({ check: name, ok: false, detail: { error: String(err), ...(detail ? { detail } : {}) } });
    console.log("FAIL", name, String(err));
  }
}

const created: string[] = [];
const consoleErrors: string[] = [];

async function shot(page: Page, name: string, fullPage = true) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage });
}

async function widths(page: Page) {
  return page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
}

/** Вставка «из Excel» в ячейку: настоящее событие paste с text/plain. */
async function pasteInto(page: Page, testId: string, text: string) {
  const input = page.getByTestId(testId);
  await input.focus();
  await input.evaluate((el, value) => {
    const data = new DataTransfer();
    data.setData("text/plain", value);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
  await page.waitForTimeout(150);
}

async function tableRows(page: Page, count: number) {
  const out: Array<[string, string, string]> = [];
  for (let i = 0; i < count; i += 1) {
    out.push([
      await page.getByTestId(`menu-name-${i}`).inputValue(),
      await page.getByTestId(`menu-yield-${i}`).inputValue(),
      await page.getByTestId(`menu-time-${i}`).inputValue(),
    ]);
  }
  return out;
}

function waitForPut(page: Page) {
  return page.waitForResponse(
    (response) => response.url().endsWith("/api/master/directory") && response.request().method() === "PUT",
    { timeout: 120_000 }
  );
}

async function apiLogin(context: BrowserContext, email: string) {
  const res = await context.request.post(`${BASE}/api/auth/login`, { data: { email, password } });
  assert.equal(res.status(), 200, `login ${email}: ${res.status()}`);
}

async function masterMenu(masterOrgId: string) {
  const rows = await db.sharedDirectoryItem.findMany({
    where: { organizationId: masterOrgId, kind: "dish" },
    orderBy: { sortOrder: "asc" },
    select: { name: true, portion: true, time: true },
  });
  return rows.map((row) => [row.name, row.portion ?? "", row.time ?? ""]);
}

async function main() {
  const fpTemplate = await db.journalTemplate.findFirstOrThrow({ where: { code: "finished_product" } });
  const passwordHash = await bcrypt.hash(password, 10);

  async function makeOrg(label: string) {
    const org = await db.organization.create({
      data: { name: `Столовая ${label} ${stamp}`, type: "cafe", qrFillMode: "public" },
    });
    created.push(org.id);
    const owner = await db.user.create({
      data: {
        name: `Руководитель ${label}`,
        email: `e2e-myt-${label.toLowerCase()}-${stamp}@example.test`,
        passwordHash,
        role: "manager",
        organizationId: org.id,
        isActive: true,
        legalVersion: LEGAL_VERSION,
        showWhatsNew: false,
      },
    });
    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
    const fp = await db.journalDocument.create({
      data: {
        templateId: fpTemplate.id,
        organizationId: org.id,
        title: "БЖГП",
        dateFrom: from,
        dateTo: to,
        config: { rows: [], itemsCatalog: [`Своё блюдо ${label}`], productLists: [] },
      },
    });
    return { org, owner, fp };
  }

  const X = await makeOrg("X");
  const Y = await makeOrg("Y");
  const Z = await makeOrg("Z");
  const codeX = await ensureServiceCode(X.org.id);
  const linked = await linkDishPool(Y.org.id, codeX);
  assert.ok(!("error" in linked), "Y linked to X");
  // Своё значение кухни Y по «Компоту» — приоритетнее мастерского.
  await db.nameSuggestion.create({
    data: { organizationId: Y.org.id, scope: "dish", value: "Компот", meta: { portionWeight: "180" } },
  });
  // Z без пула и мастера: своя температура по «Борщу».
  await db.nameSuggestion.create({
    data: { organizationId: Z.org.id, scope: "dish", value: "Борщ", meta: { productTemp: "70" } },
  });
  const zBefore = await listNameSuggestions(Z.org.id, "dish");

  const cabinet = await createOrInviteMasterCabinet({
    organizationId: X.org.id,
    actorUserId: X.owner.id,
    name: "Бэк Офисова Мария",
    email: `e2e-myt-master-${stamp}@example.test`,
  });
  created.push(cabinet.masterOrganizationId);
  const masterOrgId = cabinet.masterOrganizationId;

  // Меню файлом (шаг 3): «Блюдо / Вес порции / Время выдачи».
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Блюдо", "Вес порции", "Время выдачи"],
      ["Борщ", "300", "8:30"],
      ["Плов", "250", "11:00"],
      ["Компот", "200", "07.30"],
      ["Сырники", "2 шт.", "9:15"],
      ["Омлет", "150", "7-00"],
      ["Каша", "250", "08:00"],
    ]),
    "Меню"
  );
  const menuPath = path.join(TMP, "menu-yield-time.xlsx");
  XLSX.writeFile(wb, menuPath);

  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--use-gl=swiftshader", "--no-sandbox"] });
  const newContext = async (options: Parameters<typeof browser.newContext>[0]) => {
    const ctx = await browser.newContext({ locale: "ru-RU", ...options });
    ctx.setDefaultTimeout(120_000);
    ctx.setDefaultNavigationTimeout(180_000);
    ctx.on("page", (page) => {
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(`${page.url()} :: ${message.text().slice(0, 600)}`);
      });
      page.on("response", (response) => {
        if (response.status() >= 400) consoleErrors.push(`${page.url()} :: HTTP ${response.status()} ${response.url()}`);
      });
      page.on("pageerror", (err) => consoleErrors.push(`${page.url()} :: pageerror ${String(err).slice(0, 400)}`));
    });
    return ctx;
  };
  const mobileOpts = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  const mobileWidths: Record<string, { scrollWidth: number; innerWidth: number }> = {};

  try {
    /* ───────────── мастер: принять приглашение ───────────── */
    const raw = cabinet.inviteUrl.split("/invite/")[1];
    const masterCtx = await newContext({ viewport: { width: 1440, height: 900 } });
    const accept = await masterCtx.request.post(`${BASE}/api/invite/${raw}/accept`, { data: { password } });
    assert.equal(accept.status(), 200, `invite accept ${accept.status()}`);
    await apiLogin(masterCtx, cabinet.user.email);
    const master = await masterCtx.newPage();
    await master.goto(`${BASE}/master`, { waitUntil: "load" });
    await master.getByTestId("master-tab-menu").waitFor();
    await shot(master, "desktop-1440-01-master-menu-empty");

    /* ───────────── 1. таблица: вставки из Excel ───────────── */
    await master.getByTestId("master-paste-dish").first().click();
    await master.getByTestId("master-menu-table-dialog").waitFor();
    await pasteInto(
      master,
      "menu-name-0",
      "№\tНаименование\tВыход, г\tВремя изготовления\r\n1\tБорщ\t250\t8:30\r\n2\tПлов\t200/10\t11.00\r\n3\tКомпот\t200\t7-30\r\n"
    );
    await pasteInto(master, "menu-name-3", "Сырники\t2 шт.\nСолянка\t300\n");
    await pasteInto(master, "menu-time-3", "9:15\n12:40");
    const afterPaste = await tableRows(master, 5);
    await shot(master, "desktop-1440-02-master-table-pasted", false);
    await check(
      "AC1: paste into the menu table — 3 columns with header and numbering, 2 columns without header, a time column",
      () => {
        assert.deepEqual(afterPaste, [
          ["Борщ", "250", "08:30"],
          ["Плов", "200/10", "11:00"],
          ["Компот", "200", "07:30"],
          ["Сырники", "2 шт.", "09:15"],
          ["Солянка", "300", "12:40"],
        ]);
      },
      afterPaste
    );
    await master.getByTestId("master-menu-table-submit").click();
    await master.getByTestId("master-preview").waitFor({ timeout: 30_000 });
    const preview1 = await master.getByTestId("master-preview-summary").innerText();
    await shot(master, "desktop-1440-03-master-preview-first", false);
    await Promise.all([waitForPut(master), master.getByRole("button", { name: "Сохранить и разослать" }).click()]);
    await master.getByTestId("master-list-dish").waitFor();
    const list1 = await master.getByTestId("master-list-dish").innerText();
    const db1 = await masterMenu(masterOrgId);
    await shot(master, "desktop-1440-04-master-menu-list");
    await check(
      "AC1/AC2: preview +5, saved with yield/time, list shows «Выход» and «Время» columns",
      () => {
        assert.match(preview1, /Добавится 5 · Уберётся 0 · Изменится 0 · Без изменений 0/);
        assert.deepEqual(db1, [
          ["Борщ", "250", "08:30"],
          ["Плов", "200/10", "11:00"],
          ["Компот", "200", "07:30"],
          ["Сырники", "2 шт.", "09:15"],
          ["Солянка", "300", "12:40"],
        ]);
        assert.match(list1, /Борщ\s+250\s+08:30/);
        assert.match(list1, /Плов\s+200\/10\s+11:00/);
      },
      { preview1, db1 }
    );

    /* ───────────── 2. правка таблицей: выход, удаление, новое блюдо ───────────── */
    await master.getByTestId("master-paste-dish").first().click();
    await master.getByTestId("master-menu-table-dialog").waitFor();
    const reopened = await tableRows(master, 5);
    await master.getByTestId("menu-yield-0").fill("300");
    await master.getByRole("button", { name: "Удалить строку 5" }).click();
    await master.getByTestId("menu-name-4").fill("Омлет");
    await master.getByTestId("menu-yield-4").fill("150");
    await master.getByTestId("menu-time-4").fill("25:99");
    const badTimeVisible = await master.getByText("время — в виде ЧЧ:ММ").first().isVisible();
    await shot(master, "desktop-1440-05-master-table-edit", false);
    await master.getByTestId("menu-time-4").fill("");
    await master.getByTestId("master-menu-table-submit").click();
    await master.getByTestId("master-preview").waitFor({ timeout: 30_000 });
    const preview2 = await master.getByTestId("master-preview-summary").innerText();
    const previewBody2 = await master.getByTestId("master-preview").innerText();
    await shot(master, "desktop-1440-06-master-preview-changed", false);
    await Promise.all([waitForPut(master), master.getByRole("button", { name: "Сохранить и разослать" }).click()]);
    await master.waitForTimeout(500);
    const db2 = await masterMenu(masterOrgId);
    await check(
      "AC2: table opens with the current menu; preview shows added, removed and changed (yield) dishes",
      () => {
        assert.deepEqual(reopened, db1.map((row) => row as [string, string, string]));
        assert.ok(badTimeVisible, "invalid time is highlighted");
        assert.match(preview2, /Добавится 1 · Уберётся 1 · Изменится 1 · Без изменений 3/);
        assert.match(previewBody2, /Изменятся выход или время/i);
        assert.match(previewBody2, /Борщ — выход 300, время 08:30/);
        assert.deepEqual(db2, [
          ["Борщ", "300", "08:30"],
          ["Плов", "200/10", "11:00"],
          ["Компот", "200", "07:30"],
          ["Сырники", "2 шт.", "09:15"],
          ["Омлет", "150", ""],
        ]);
      },
      { preview2, db2 }
    );

    /* ───────────── 3. файл: «Вес порции» / «Время выдачи» ───────────── */
    const chooser = master.waitForEvent("filechooser");
    await master.getByTestId("master-upload-dish").first().click();
    await (await chooser).setFiles(menuPath);
    await master.getByTestId("master-preview").waitFor({ timeout: 30_000 });
    const preview3 = await master.getByTestId("master-preview-summary").innerText();
    await shot(master, "desktop-1440-07-master-preview-file", false);
    const [put3] = await Promise.all([
      waitForPut(master),
      master.getByRole("button", { name: "Сохранить и разослать" }).click(),
    ]);
    const put3Body = (await put3.json()) as Record<string, unknown>;
    await master.getByTestId("master-list-dish").waitFor();
    await master.waitForTimeout(400);
    await shot(master, "desktop-1440-08-master-menu-list-file");
    const db3 = await masterMenu(masterOrgId);
    const yDoc = await db.journalDocument.findUniqueOrThrow({ where: { id: Y.fp.id } });
    await check(
      "AC1/AC2: xlsx with «Вес порции» and «Время выдачи» → +1, changed 2; names still reach itemsCatalog",
      () => {
        assert.match(preview3, /Добавится 1 · Уберётся 0 · Изменится 2 · Без изменений 3/);
        assert.equal(put3Body.changed, 2);
        assert.deepEqual(db3, [
          ["Борщ", "300", "08:30"],
          ["Плов", "250", "11:00"],
          ["Компот", "200", "07:30"],
          ["Сырники", "2 шт.", "09:15"],
          ["Омлет", "150", "07:00"],
          ["Каша", "250", "08:00"],
        ]);
        assert.deepEqual((yDoc.config as { itemsCatalog: string[] }).itemsCatalog, [
          "Своё блюдо Y",
          "Борщ",
          "Плов",
          "Компот",
          "Сырники",
          "Омлет",
          "Каша",
        ]);
      },
      { preview3, put3Body, db3 }
    );

    /* ───────────── мастер 390 ───────────── */
    const masterMobileCtx = await newContext({ ...mobileOpts, storageState: await masterCtx.storageState() });
    const masterMobile = await masterMobileCtx.newPage();
    await masterMobile.goto(`${BASE}/master`, { waitUntil: "load" });
    await masterMobile.getByTestId("master-list-dish").waitFor();
    mobileWidths["mobile-390-master-menu"] = await widths(masterMobile);
    await shot(masterMobile, "mobile-390-01-master-menu");
    await masterMobile.getByTestId("master-paste-dish").first().click();
    await masterMobile.getByTestId("master-menu-table-dialog").waitFor();
    mobileWidths["mobile-390-master-table"] = await widths(masterMobile);
    await shot(masterMobile, "mobile-390-02-master-table", false);
    await masterMobile.getByTestId("menu-yield-1").fill("260");
    await masterMobile.getByTestId("master-menu-table-submit").click();
    await masterMobile.getByTestId("master-preview").waitFor({ timeout: 30_000 });
    mobileWidths["mobile-390-master-preview"] = await widths(masterMobile);
    await shot(masterMobile, "mobile-390-03-master-preview", false);
    await masterMobile.keyboard.press("Escape");

    /* ───────────── подсказки пула (meta) ───────────── */
    const ySug = await listNameSuggestions(Y.org.id, "dish");
    const zAfter = await listNameSuggestions(Z.org.id, "dish");
    await check(
      "AC3/AC4: pool suggestions carry menu yield/time; kitchen's own value wins; org without master unchanged",
      () => {
        assert.deepEqual(ySug.meta["борщ"], { portionWeight: "300", productionTime: "08:30" });
        assert.deepEqual(ySug.meta["компот"], { portionWeight: "180", productionTime: "07:30" });
        assert.deepEqual(zAfter, zBefore);
        assert.deepEqual(zAfter.meta, { "борщ": { productTemp: "70" } });
      },
      { y: { борщ: ySug.meta["борщ"], компот: ySug.meta["компот"] }, z: zAfter }
    );

    /* ───────────── 2. кухня Y на сайте ───────────── */
    const yCtx = await newContext({ viewport: { width: 1440, height: 900 } });
    await apiLogin(yCtx, Y.owner.email);
    const kitchen = await yCtx.newPage();
    await kitchen.goto(`${BASE}/journals/finished_product/documents/${Y.fp.id}`, { waitUntil: "load" });
    const addButton = kitchen.getByRole("button", { name: "Добавить изделие" }).last();
    await addButton.waitFor();
    // Подсказки (meta) грузятся после монтирования.
    await kitchen.waitForResponse((r) => r.url().includes("/api/name-suggestions?scope=dish"), { timeout: 60_000 }).catch(() => null);
    await kitchen.waitForTimeout(800);
    // Первый визит: инструкция к журналу открывается сама — закрываем.
    const guide = kitchen.locator('[aria-labelledby="fill-guide-title"]');
    if (await guide.waitFor({ timeout: 8_000 }).then(() => true).catch(() => false)) {
      await kitchen.keyboard.press("Escape");
      await guide.waitFor({ state: "hidden" });
    }
    await addButton.click();
    const dialog = kitchen.getByRole("dialog");
    await dialog.waitFor();
    const nameInput = dialog.getByRole("combobox", { name: "Наименование изделия" });
    const portionInput = dialog.getByLabel("Вес выход, г");
    const timeInput = dialog.getByLabel("Время изготовления", { exact: true });
    const dateInput = dialog.getByLabel("Дата изготовления", { exact: true });
    const defaultTime = await timeInput.inputValue();
    const defaultDate = await dateInput.inputValue();
    await nameInput.fill("Борщ");
    const borsch = { portion: await portionInput.inputValue(), time: await timeInput.inputValue(), date: await dateInput.inputValue() };
    await shot(kitchen, "desktop-1440-09-kitchen-dialog-prefilled", false);
    await nameInput.fill("Своё блюдо Y");
    const own = { portion: await portionInput.inputValue(), time: await timeInput.inputValue() };
    await nameInput.fill("Компот");
    const kompot = { portion: await portionInput.inputValue(), time: await timeInput.inputValue() };
    await nameInput.fill("Борщ");
    await dialog.getByRole("button", { name: "Добавить запись" }).click();
    await dialog.waitFor({ state: "hidden", timeout: 30_000 });
    await kitchen.waitForTimeout(1500);
    const yRows1 = ((await db.journalDocument.findUniqueOrThrow({ where: { id: Y.fp.id } })).config as {
      rows: Array<{ productName: string; portionWeight: string; productionDateTime: string }>;
    }).rows;
    await check(
      "AC3 site: choosing a menu dish fills empty yield and untouched time (date kept); other dish resets; kitchen value wins",
      () => {
        assert.deepEqual(borsch, { portion: "300", time: "08:30", date: defaultDate });
        assert.deepEqual(own, { portion: "", time: defaultTime });
        assert.deepEqual(kompot, { portion: "180", time: "07:30" });
        const saved = yRows1.find((row) => row.productName === "Борщ");
        assert.ok(saved, "row saved");
        assert.equal(saved.portionWeight, "300");
        assert.equal(saved.productionDateTime, `${defaultDate} 08:30`);
      },
      { defaultTime, defaultDate, borsch, own, kompot, saved: yRows1 }
    );

    // Ручное не перезаписывается.
    await addButton.click();
    await dialog.waitFor();
    await portionInput.fill("999");
    await timeInput.fill("15:45");
    await nameInput.fill("Плов");
    const manual = { portion: await portionInput.inputValue(), time: await timeInput.inputValue() };
    await shot(kitchen, "desktop-1440-10-kitchen-dialog-manual", false);
    await kitchen.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await check("AC3 site: manually entered yield and time are not overwritten by the menu", () => {
      assert.deepEqual(manual, { portion: "999", time: "15:45" });
    }, manual);

    // «Добавить списком»: пустой выход — по наименованию.
    await kitchen.getByRole("button", { name: /^Добавить$/ }).first().click();
    await kitchen.getByText("Добавить списком").click();
    const bulk = kitchen.getByTestId("bulk-dish-table");
    await bulk.waitFor();
    await bulk.getByLabel("Наименование, строка 1").fill("Плов");
    await bulk.getByLabel("Наименование, строка 2").focus();
    await bulk.getByLabel("Наименование, строка 2").evaluate((el) => {
      const data = new DataTransfer();
      data.setData("text/plain", "Борщ\nКомпот\nНовое блюдо\n");
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await kitchen.waitForTimeout(200);
    await bulk.getByLabel("Выход, строка 5").fill("111");
    await bulk.getByLabel("Наименование, строка 5").fill("Каша");
    const bulkYields: string[] = [];
    for (let i = 1; i <= 5; i += 1) bulkYields.push(await bulk.getByLabel(`Выход, строка ${i}`).inputValue());
    await shot(kitchen, "desktop-1440-11-kitchen-bulk-prefilled", false);
    await kitchen.getByRole("dialog").getByRole("button", { name: "Добавить", exact: true }).click();
    await kitchen.waitForTimeout(1500);
    const yRows2 = ((await db.journalDocument.findUniqueOrThrow({ where: { id: Y.fp.id } })).config as {
      rows: Array<{ productName: string; portionWeight: string }>;
    }).rows.slice(-5);
    await check(
      "AC3 site bulk: empty yield filled by name from the menu, manual yield kept, unknown dish stays empty",
      () => {
        assert.deepEqual(bulkYields, ["250", "300", "180", "", "111"]);
        assert.deepEqual(
          yRows2.map((row) => [row.productName, row.portionWeight]),
          [
            ["Плов", "250"],
            ["Борщ", "300"],
            ["Компот", "180"],
            ["Новое блюдо", ""],
            ["Каша", "111"],
          ]
        );
      },
      { bulkYields, rows: yRows2.map((row) => [row.productName, row.portionWeight]) }
    );

    /* ───────────── 3. кухня Y по QR (390) ───────────── */
    const token = mintQrFillToken("journal", `${Y.org.id}:finished_product:${Y.fp.id}`);
    const qrUrl = `${BASE}/journal-fill/${Y.org.id}/finished_product?${new URLSearchParams({ token, employee: Y.owner.id, view: "add" })}`;
    const qrCtx = await newContext(mobileOpts);
    const qr = await qrCtx.newPage();
    await qr.goto(qrUrl, { waitUntil: "load" });
    if (!(await qr.locator("#qr-form").waitFor({ timeout: 60_000 }).then(() => true).catch(() => false))) {
      throw new Error(`QR form missing: ${(await qr.locator("body").innerText()).slice(0, 600)}`);
    }
    const qrDefaultTime = await qr.locator("#f-productionTime").inputValue();
    await qr.locator("#f-productName").fill("Борщ");
    const qrBorsch = {
      portion: await qr.locator("#f-portionWeight").inputValue(),
      time: await qr.locator("#f-productionTime").inputValue(),
    };
    mobileWidths["mobile-390-qr-prefilled"] = await widths(qr);
    await shot(qr, "mobile-390-04-qr-prefilled");
    await qr.locator("#f-productName").fill("Своё блюдо Y");
    const qrOwn = {
      portion: await qr.locator("#f-portionWeight").inputValue(),
      time: await qr.locator("#f-productionTime").inputValue(),
    };
    await qr.locator("#f-productName").fill("Плов");
    await qr.locator("#qr-form button[type=submit]").click();
    await qr.locator(".ok").waitFor({ timeout: 60_000 });
    const yRows3 = ((await db.journalDocument.findUniqueOrThrow({ where: { id: Y.fp.id } })).config as {
      rows: Array<{ productName: string; portionWeight: string; productionDateTime: string }>;
    }).rows;
    const qrSaved = yRows3[yRows3.length - 1];

    const qrCtx2 = await newContext(mobileOpts);
    const qr2 = await qrCtx2.newPage();
    await qr2.goto(qrUrl, { waitUntil: "load" });
    await qr2.locator("#qr-form").waitFor({ timeout: 60_000 });
    await qr2.locator("#f-portionWeight").fill("77");
    await qr2.locator("#f-productionTime").fill("16:10");
    await qr2.locator("#f-productName").fill("Борщ");
    const qrManual = {
      portion: await qr2.locator("#f-portionWeight").inputValue(),
      time: await qr2.locator("#f-productionTime").inputValue(),
    };
    await shot(qr2, "mobile-390-05-qr-manual-kept");
    await check(
      "AC3 QR: dish from the menu fills empty yield and untouched time; other dish resets; saved row has them; manual kept",
      () => {
        assert.deepEqual(qrBorsch, { portion: "300", time: "08:30" });
        assert.deepEqual(qrOwn, { portion: "", time: qrDefaultTime });
        assert.equal(qrSaved.productName, "Плов");
        assert.equal(qrSaved.portionWeight, "250");
        assert.match(qrSaved.productionDateTime, / 11:00$/);
        assert.deepEqual(qrManual, { portion: "77", time: "16:10" });
      },
      { qrDefaultTime, qrBorsch, qrOwn, qrSaved, qrManual }
    );

    await check("390px: no horizontal page scroll (master menu, table, preview, QR form)", () => {
      for (const [name, value] of Object.entries(mobileWidths)) {
        assert.ok(value.scrollWidth <= value.innerWidth, `${name}: ${value.scrollWidth} > ${value.innerWidth}`);
      }
    }, mobileWidths);
  } finally {
    await browser.close();
  }
}

main()
  .catch((err) => {
    console.error(err);
    results.push({ check: "script", ok: false, detail: String(err) });
  })
  .finally(async () => {
    await db.organization.deleteMany({ where: { id: { in: created } } }).catch((err) => console.error("cleanup", err));
    fs.rmSync(TMP, { recursive: true, force: true });
    results.push({ check: "browser console errors (info)", ok: true, detail: consoleErrors });
    const failed = results.filter((r) => !r.ok);
    const summary = { passed: results.length - failed.length, failed: failed.length, results };
    fs.writeFileSync(path.join(__dirname, "menu-yield-time-results.json"), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({ passed: summary.passed, failed: summary.failed }, null, 2));
    await db.$disconnect();
    process.exit(failed.length ? 1 : 0);
  });
