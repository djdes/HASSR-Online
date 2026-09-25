/**
 * E2E «мастер-кабинет v2»: бракераж на дату во все пищеблоки, удобное время,
 * переименование. Своя база (DATABASE_URL из .env) и dev-сервер (E2E_BASE,
 * по умолчанию http://localhost:3042).
 *
 * Пул кода X: пищеблоки X (есть документ БЖГП месяца, в нём уже «Борщ» в
 * 08:30 на дату D), Y (документов нет — создастся), W (документ месяца
 * сдан — ошибка) + мастер-кабинет X.
 *   1. Переименование из шапки /master (аудит).
 *   2. Окно «Добавить в журналы на дату»: «Взять меню», время цифрами без
 *      двоеточия, пикер, «проставить всем ниже», «время для всех строк»,
 *      вставка из Excel → предпросмотр по пищеблокам → запись → итог.
 *   3. БД: строки в X (пропуск дубля, цепочка времени по константам X),
 *      новый документ у Y без пустой строки, W — ошибка; повтор — 0 новых.
 *   4. Меню мастера таблицей: время без двоеточия, пикер, всем ниже, для всех.
 *   5. Пищеблок X: «Добавить изделия списком» работает как раньше (общее окно).
 *   6. /settings/master-cabinet: переименование владельцем (аудит у обоих).
 *   7. 390: окно, предпросмотр, без горизонтального скролла.
 * Скриншоты 1440 и 390 → ../shots. Временные организации удаляются.
 *
 * Run: E2E_BASE=http://localhost:3042 npx tsx .agent/tasks/master-cabinet-v2-2026-09/e2e/master-v2-e2e.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { chromium, type BrowserContext, type Page } from "playwright-core";

import { db } from "@/lib/db";
import { ensureServiceCode, linkDishPool } from "@/lib/dish-pool";
import { LEGAL_VERSION } from "@/lib/legal-consent";
import { createOrInviteMasterCabinet } from "@/lib/master-cabinet";

const BASE = process.env.E2E_BASE ?? "http://localhost:3042";
const TASK_DIR = path.resolve(__dirname, "..");
const SHOTS = path.join(TASK_DIR, "shots");
const CHROME =
  process.env.E2E_CHROME ??
  path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium-1232", "chrome-win64", "chrome.exe");
const stamp = Date.now().toString(36);
const password = "Test12345!";

fs.mkdirSync(SHOTS, { recursive: true });

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

async function shot(page: Page, name: string, fullPage = false) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage, type: "png" });
}

async function widths(page: Page) {
  return page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
}

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

/** Открыть пикер времени у поля (повтор, если клик пришёлся на анимацию окна). */
async function openPicker(page: Page, testId: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.getByTestId(`${testId}-picker`).click();
    if (await page.getByTestId("time-picker").waitFor({ timeout: 5_000 }).then(() => true).catch(() => false)) return;
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(400);
  }
  throw new Error(`time picker for ${testId} did not open`);
}

async function apiLogin(context: BrowserContext, email: string) {
  const res = await context.request.post(`${BASE}/api/auth/login`, { data: { email, password } });
  assert.equal(res.status(), 200, `login ${email}: ${res.status()}`);
}

async function bulkRows(page: Page, count: number) {
  const out: Array<[string, string, string]> = [];
  for (let i = 0; i < count; i += 1) {
    out.push([
      await page.getByTestId(`bulk-name-${i}`).inputValue(),
      await page.getByTestId(`bulk-yield-${i}`).inputValue(),
      await page.getByTestId(`bulk-time-${i}`).inputValue(),
    ]);
  }
  return out;
}

type Row = {
  productName: string;
  productionDateTime: string;
  rejectionTime: string;
  releasePermissionTime: string;
  portionWeight: string;
  organoleptic: string;
  responsiblePerson: string;
};

async function docRows(documentId: string): Promise<Row[]> {
  const doc = await db.journalDocument.findUniqueOrThrow({ where: { id: documentId } });
  return ((doc.config as { rows?: Row[] }).rows ?? []) as Row[];
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

async function main() {
  const fpTemplate = await db.journalTemplate.findFirstOrThrow({ where: { code: "finished_product" } });
  const passwordHash = await bcrypt.hash(password, 10);
  const now = new Date();
  const D = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
  const monthFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));

  async function makeOrg(label: string) {
    const org = await db.organization.create({ data: { name: `Пищеблок ${label} ${stamp}`, type: "school" } });
    created.push(org.id);
    const owner = await db.user.create({
      data: {
        name: `Повар ${label} Иванова`,
        email: `e2e-mk2-${label.toLowerCase()}-${stamp}@example.test`,
        passwordHash,
        role: "manager",
        organizationId: org.id,
        isActive: true,
        legalVersion: LEGAL_VERSION,
        showWhatsNew: false,
      },
    });
    return { org, owner };
  }

  const X = await makeOrg("X");
  const Y = await makeOrg("Y");
  const W = await makeOrg("W");
  // X: документ месяца, свои константы времени (бракераж +10, разрешение +15), ответственный — владелец,
  // и уже есть «Борщ» в 08:30 на дату D (его не задвоим).
  const xDoc = await db.journalDocument.create({
    data: {
      templateId: fpTemplate.id,
      organizationId: X.org.id,
      title: "БЖГП X",
      dateFrom: monthFrom,
      dateTo: monthTo,
      responsibleUserId: X.owner.id,
      config: {
        rows: [{ id: "pre-1", productName: "Борщ", productionDateTime: `${D} 08:30`, portionWeight: "250" }],
        itemsCatalog: [],
        productLists: [],
        timeDefaults: { productionMinutesAgo: 30, rejectionAfterProductionMinutes: 10, releaseAfterRejectionMinutes: 15 },
      },
    },
  });
  // W: месяц уже сдан.
  await db.journalDocument.create({
    data: {
      templateId: fpTemplate.id,
      organizationId: W.org.id,
      title: "БЖГП W (сдан)",
      dateFrom: monthFrom,
      dateTo: monthTo,
      status: "closed",
      config: { rows: [] },
    },
  });
  const codeX = await ensureServiceCode(X.org.id);
  for (const other of [Y, W]) {
    const linked = await linkDishPool(other.org.id, codeX);
    assert.ok(!("error" in linked), `${other.org.name} linked`);
  }
  const cabinet = await createOrInviteMasterCabinet({
    organizationId: X.org.id,
    actorUserId: X.owner.id,
    name: "Бэк Офисова Мария",
    email: `e2e-mk2-master-${stamp}@example.test`,
  });
  created.push(cabinet.masterOrganizationId);
  const masterOrgId = cabinet.masterOrganizationId;
  await db.sharedDirectoryItem.createMany({
    data: [
      { organizationId: masterOrgId, kind: "dish", name: "Борщ", portion: "250", time: "08:30", sortOrder: 0 },
      { organizationId: masterOrgId, kind: "dish", name: "Каша манная", portion: "200", time: "07:30", sortOrder: 1 },
      { organizationId: masterOrgId, kind: "dish", name: "Компот", portion: "200", time: null, sortOrder: 2 },
    ],
  });

  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--use-gl=swiftshader", "--no-sandbox"] });
  const newContext = async (options: Parameters<typeof browser.newContext>[0]) => {
    const ctx = await browser.newContext({ locale: "ru-RU", ...options });
    ctx.setDefaultTimeout(120_000);
    ctx.setDefaultNavigationTimeout(180_000);
    ctx.on("page", (page) => {
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(`${page.url()} :: ${message.text().slice(0, 400)}`);
      });
      page.on("response", (response) => {
        if (response.status() >= 400) consoleErrors.push(`${page.url()} :: HTTP ${response.status()} ${response.url()}`);
      });
      page.on("pageerror", (err) => consoleErrors.push(`${page.url()} :: pageerror ${String(err).slice(0, 400)}`));
    });
    return ctx;
  };
  const mobileOpts = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
  const mobileWidths: Record<string, { scrollWidth: number; innerWidth: number }> = {};

  try {
    /* ───────────── мастер: вход ───────────── */
    const raw = cabinet.inviteUrl.split("/invite/")[1];
    const masterCtx = await newContext({ viewport: { width: 1440, height: 900 } });
    const accept = await masterCtx.request.post(`${BASE}/api/invite/${raw}/accept`, { data: { password } });
    assert.equal(accept.status(), 200, `invite accept ${accept.status()}`);
    await apiLogin(masterCtx, cabinet.user.email);
    const master = await masterCtx.newPage();
    await master.goto(`${BASE}/master`, { waitUntil: "load" });
    await master.getByTestId("master-brakerage-open").waitFor();
    await shot(master, "desktop-1440-01-master-menu-tab");

    /* ───────────── 1. переименование из шапки ───────────── */
    await master.getByTestId("master-rename").click();
    const promptInput = master.locator("#prompt-async-input");
    await promptInput.waitFor();
    await promptInput.fill("Мастер-кабинет Школы");
    await master.getByRole("button", { name: "Сохранить", exact: true }).click();
    await master.getByTestId("master-org-name").filter({ hasText: "Мастер-кабинет Школы" }).waitFor();
    const renamed = await db.organization.findUniqueOrThrow({ where: { id: masterOrgId }, select: { name: true } });
    const renameAudit = await db.auditLog.findFirst({
      where: { organizationId: masterOrgId, action: "master_cabinet.renamed" },
      orderBy: { createdAt: "desc" },
    });
    await master.reload({ waitUntil: "load" });
    const headerAfterReload = await master.getByTestId("master-org-name").innerText();
    await check(
      "AC4: rename from the /master header — DB, header after reload, AuditLog",
      () => {
        assert.equal(renamed.name, "Мастер-кабинет Школы");
        assert.equal(headerAfterReload, "Мастер-кабинет Школы");
        assert.ok(renameAudit, "audit row");
        assert.deepEqual(
          { from: (renameAudit!.details as { from: string }).from, to: (renameAudit!.details as { to: string }).to },
          { from: cabinet.masterName, to: "Мастер-кабинет Школы" }
        );
      },
      { renamed, headerAfterReload, audit: renameAudit?.details }
    );

    /* ───────────── 2. окно «Добавить в журналы на дату» ───────────── */
    await master.getByTestId("master-brakerage-open").click();
    const dialog = master.getByTestId("master-brakerage-dialog");
    await dialog.waitFor();
    const sameWindow = {
      title: await dialog.getByRole("heading").first().innerText(),
      hasBulkTable: await dialog.getByTestId("bulk-dish-table").isVisible(),
      commonLabel: await dialog.getByText("Общие для всех изделий").isVisible(),
    };
    await master.getByTestId("master-brakerage-take-menu").click();
    const fromMenu = await bulkRows(master, 3);
    // Время цифрами без двоеточия: «730» → «07:30» при уходе с поля.
    await master.getByTestId("bulk-time-2").fill("730");
    await master.getByTestId("bulk-time-2").press("Tab");
    const typed = await master.getByTestId("bulk-time-2").inputValue();
    // Пикер: у «Каши» 07 : 45.
    await openPicker(master, "bulk-time-1");
    await shot(master, "desktop-1440-02-time-picker");
    await master.getByTestId("time-picker-hour-07").click();
    await master.getByTestId("time-picker-minute-45").click();
    const picked = await master.getByTestId("bulk-time-1").inputValue();
    // «Проставить всем ниже» у «Каши» → «Компот» тоже 07:45.
    await master.getByTestId("bulk-time-1-fill-below").click();
    const afterFill = await bulkRows(master, 3);
    // Вставка из Excel: наименование, выход, время.
    await pasteInto(master, "bulk-name-3", "Сырники\t2 шт.\t9:10\nЧай с лимоном\t200\t\n");
    // Общее время — цифрами: строкам без своего времени.
    await master.getByTestId("master-brakerage-time-all").fill("1000");
    await master.getByTestId("master-brakerage-time-all").press("Tab");
    const commonTime = await master.getByTestId("master-brakerage-time-all").inputValue();
    await master.getByTestId("master-brakerage-date").fill(D);
    const finalRows = await bulkRows(master, 5);
    await shot(master, "desktop-1440-03-brakerage-dialog-filled");
    await check(
      "AC2/AC3: same bulk window; «Взять меню»; digits without colon; picker; fill below; paste; time for all rows",
      () => {
        assert.equal(sameWindow.title, "Добавить в журналы на дату");
        assert.ok(sameWindow.hasBulkTable && sameWindow.commonLabel, "shared table + «Общие для всех изделий»");
        assert.deepEqual(fromMenu, [
          ["Борщ", "250", "08:30"],
          ["Каша манная", "200", "07:30"],
          ["Компот", "200", ""],
        ]);
        assert.equal(typed, "07:30");
        assert.equal(picked, "07:45");
        assert.deepEqual(afterFill.map((row) => row[2]), ["08:30", "07:45", "07:45"]);
        assert.equal(commonTime, "10:00");
        assert.deepEqual(finalRows, [
          ["Борщ", "250", "08:30"],
          ["Каша манная", "200", "07:45"],
          ["Компот", "200", "07:45"],
          ["Сырники", "2 шт.", "09:10"],
          ["Чай с лимоном", "200", ""],
        ]);
      },
      { sameWindow, fromMenu, typed, picked, afterFill, commonTime, finalRows }
    );

    const submit = master.getByTestId("master-brakerage-dialog-submit");
    const submitLabel = await submit.innerText();
    await submit.click();
    const preview = master.getByTestId("master-brakerage-preview");
    await preview.waitFor({ timeout: 60_000 });
    const previewText = await preview.innerText();
    await shot(master, "desktop-1440-04-brakerage-preview");
    await check(
      "AC1: preview per kitchen before sending (X: 4 + 1 duplicate skipped, Y: 5 with a new document, W: closed period)",
      () => {
        assert.match(submitLabel, /Добавить в 3 пищеблока/);
        assert.match(previewText, new RegExp(`Пищеблок X ${stamp}[\\s\\S]*Будет добавлено: 4[\\s\\S]*пропустим: 1`));
        assert.match(previewText, new RegExp(`Пищеблок Y ${stamp}[\\s\\S]*Будет добавлено: 5[\\s\\S]*создадим новый`));
        assert.match(previewText, new RegExp(`Пищеблок W ${stamp}[\\s\\S]*уже сдан`));
      },
      previewText
    );
    await master.getByRole("button", { name: /^Добавить 9 строк в 2 пищеблока$/ }).click();
    const result = master.getByTestId("master-brakerage-result");
    await result.waitFor({ timeout: 120_000 });
    const resultText = await result.innerText();
    const resultTitle = await master.getByText(/^Добавлено 9 строк в 2 пищеблока$/).first().isVisible();
    await shot(master, "desktop-1440-05-brakerage-result");

    const xRows = await docRows(xDoc.id);
    const yDocs = await db.journalDocument.findMany({
      where: { organizationId: Y.org.id, templateId: fpTemplate.id },
      select: { id: true, dateFrom: true, dateTo: true, status: true },
    });
    const yRows = yDocs[0] ? await docRows(yDocs[0].id) : [];
    const wActive = await db.journalDocument.count({ where: { organizationId: W.org.id, status: "active" } });
    const audits = await db.auditLog.findMany({
      where: { action: { in: ["master_brakerage.added", "master_brakerage.received"] }, organizationId: { in: [masterOrgId, X.org.id, Y.org.id] } },
      select: { organizationId: true, action: true },
    });
    const pick = (rows: Row[], name: string) => rows.find((row) => row.productName === name);
    await check(
      "AC1: rows land in every kitchen for date D (existing X document, new Y document), chain times per kitchen, per-kitchen result, audit",
      () => {
        assert.match(resultText, /Добавлено: 4[\s\S]*пропущено: 1/);
        assert.match(resultText, /Создан документ/);
        assert.match(resultText, /уже сдан/);
        assert.ok(resultTitle, "summary title «Добавлено 9 строк в 2 пищеблока»");
        // X: была 1 строка + 4 новых; «Борщ 08:30» не задвоен.
        assert.equal(xRows.length, 5);
        assert.equal(xRows.filter((row) => row.productName === "Борщ").length, 1);
        const kasha = pick(xRows, "Каша манная")!;
        assert.equal(kasha.productionDateTime, `${D} 07:45`);
        assert.equal(kasha.rejectionTime, `${D} 07:55`); // +10 по константам X
        assert.equal(kasha.releasePermissionTime, `${D} 08:10`); // +15
        assert.equal(kasha.portionWeight, "200");
        assert.equal(kasha.organoleptic, "Отлично");
        assert.equal(kasha.responsiblePerson, X.owner.name);
        assert.equal(pick(xRows, "Чай с лимоном")!.productionDateTime, `${D} 10:00`);
        assert.equal(pick(xRows, "Сырники")!.productionDateTime, `${D} 09:10`);
        // Y: новый документ на период с датой D, без пустой строки-заготовки, цепочка +5/+5.
        assert.equal(yDocs.length, 1);
        assert.equal(yDocs[0].status, "active");
        assert.ok(yDocs[0].dateFrom.toISOString().slice(0, 10) <= D && yDocs[0].dateTo.toISOString().slice(0, 10) >= D);
        assert.deepEqual(yRows.map((row) => row.productName), ["Борщ", "Каша манная", "Компот", "Сырники", "Чай с лимоном"]);
        const yBorsch = pick(yRows, "Борщ")!;
        assert.equal(yBorsch.productionDateTime, `${D} 08:30`);
        assert.equal(yBorsch.rejectionTime, `${D} 08:35`);
        assert.equal(yBorsch.releasePermissionTime, `${D} 08:40`);
        assert.equal(wActive, 0);
        assert.ok(audits.some((a) => a.organizationId === masterOrgId && a.action === "master_brakerage.added"));
        assert.ok(audits.some((a) => a.organizationId === X.org.id && a.action === "master_brakerage.received"));
        assert.ok(audits.some((a) => a.organizationId === Y.org.id && a.action === "master_brakerage.received"));
      },
      { resultText, xRows: xRows.map((r) => [r.productName, r.productionDateTime, r.rejectionTime, r.releasePermissionTime]), yRows: yRows.map((r) => [r.productName, r.productionDateTime, r.rejectionTime, r.releasePermissionTime]) }
    );
    await master.getByRole("button", { name: "Готово" }).click();

    /* ───────────── 3. повтор не дублирует ───────────── */
    const repeatPayload = {
      date: D,
      dryRun: false,
      rows: finalRows.map(([name, portion, time]) => ({ name, yield: portion, time })),
      common: { time: "1000", organoleptic: "", releaseAllowed: "yes", productTemp: "", note: "" },
    };
    const repeat = await masterCtx.request.post(`${BASE}/api/master/brakerage`, { data: repeatPayload });
    const repeatBody = (await repeat.json()) as { totals: { added: number; skipped: number } };
    const xRows2 = await docRows(xDoc.id);
    const yRows2 = yDocs[0] ? await docRows(yDocs[0].id) : [];
    await check(
      "AC1: repeating the same add creates no duplicates",
      () => {
        assert.equal(repeat.status(), 200);
        assert.equal(repeatBody.totals.added, 0);
        assert.equal(repeatBody.totals.skipped, 10);
        assert.equal(xRows2.length, 5);
        assert.equal(yRows2.length, 5);
      },
      repeatBody
    );
    const denied = await (await newContext({})).request.post(`${BASE}/api/master/brakerage`, { data: repeatPayload });
    const xCtxApi = await newContext({});
    await apiLogin(xCtxApi, X.owner.email);
    const deniedKitchen = await xCtxApi.request.post(`${BASE}/api/master/brakerage`, { data: repeatPayload });
    await check("access: /api/master/brakerage only for the master cabinet session", () => {
      assert.ok([401, 403, 307, 302].includes(denied.status()) || denied.url().includes("/login"), `anon ${denied.status()}`);
      assert.equal(deniedKitchen.status(), 403);
    }, { anon: denied.status(), kitchen: deniedKitchen.status() });

    /* ───────────── 4. меню мастера таблицей: удобное время ───────────── */
    await master.getByTestId("master-paste-dish").first().click();
    await master.getByTestId("master-menu-table-dialog").waitFor();
    await master.waitForTimeout(500);
    await master.getByTestId("menu-time-2").fill("1215");
    await master.getByTestId("menu-time-2").press("Tab");
    const menuTyped = await master.getByTestId("menu-time-2").inputValue();
    await openPicker(master, "menu-time-0");
    await master.getByTestId("time-picker-hour-09").click();
    await master.getByTestId("time-picker-minute-00").click();
    await master.getByTestId("menu-time-0-fill-below").click();
    const menuFilled = [0, 1, 2].map(async (i) => master.getByTestId(`menu-time-${i}`).inputValue());
    const menuFilledValues = await Promise.all(menuFilled);
    await master.getByTestId("menu-time-all").fill("1130");
    await master.getByTestId("menu-time-all-apply").click();
    const menuAll = await Promise.all([0, 1, 2, 3].map((i) => master.getByTestId(`menu-time-${i}`).inputValue()));
    const badHintVisible = await master.getByText("время — в виде ЧЧ:ММ").count();
    await shot(master, "desktop-1440-06-menu-table-time");
    await master.getByTestId("master-menu-table-submit").click();
    await master.getByTestId("master-preview").waitFor({ timeout: 30_000 });
    await Promise.all([
      master.waitForResponse((r) => r.url().endsWith("/api/master/directory") && r.request().method() === "PUT"),
      master.getByRole("button", { name: "Сохранить и разослать" }).click(),
    ]);
    const savedMenu = await db.sharedDirectoryItem.findMany({
      where: { organizationId: masterOrgId, kind: "dish" },
      orderBy: { sortOrder: "asc" },
      select: { name: true, time: true },
    });
    await check(
      "AC3: master menu table — digits without colon, picker, fill below, time for all rows; saved",
      () => {
        assert.equal(menuTyped, "12:15");
        assert.deepEqual(menuFilledValues, ["09:00", "09:00", "09:00"]);
        // Пустая строка в конце таблицы не получает время (не становится «ошибкой»).
        assert.deepEqual(menuAll, ["11:30", "11:30", "11:30", ""]);
        assert.equal(badHintVisible, 0);
        assert.deepEqual(savedMenu.map((item) => item.time), ["11:30", "11:30", "11:30"]);
      },
      { menuTyped, menuFilledValues, menuAll, savedMenu }
    );

    /* ───────────── 5. пищеблок X: «Добавить изделия списком» как раньше ───────────── */
    const xCtx = await newContext({ viewport: { width: 1440, height: 900 } });
    await apiLogin(xCtx, X.owner.email);
    const kitchen = await xCtx.newPage();
    await kitchen.goto(`${BASE}/journals/finished_product/documents/${xDoc.id}`, { waitUntil: "load" });
    await kitchen.getByRole("button", { name: "Добавить изделие" }).last().waitFor();
    const guide = kitchen.locator('[aria-labelledby="fill-guide-title"]');
    if (await guide.waitFor({ timeout: 8_000 }).then(() => true).catch(() => false)) {
      await kitchen.keyboard.press("Escape");
      await guide.waitFor({ state: "hidden" });
    }
    await kitchen.getByRole("button", { name: /^Добавить$/ }).first().click();
    await kitchen.getByText("Добавить списком").click();
    const kBulk = kitchen.getByTestId("bulk-dish-table");
    await kBulk.waitFor();
    const kTitle = await kitchen.getByRole("heading", { name: "Добавить изделия списком" }).isVisible();
    const kHasTimeColumn = await kitchen.getByTestId("bulk-time-0").count();
    await pasteInto(kitchen, "bulk-name-0", "Запеканка\t180\nКисель\t200\n");
    const kPasted = [
      [await kitchen.getByTestId("bulk-name-0").inputValue(), await kitchen.getByTestId("bulk-yield-0").inputValue()],
      [await kitchen.getByTestId("bulk-name-1").inputValue(), await kitchen.getByTestId("bulk-yield-1").inputValue()],
    ];
    const kChain = await kitchen.getByTestId("brakerage-chain-caption").innerText();
    await shot(kitchen, "desktop-1440-07-kitchen-bulk-dialog");
    await kitchen.getByRole("button", { name: "Добавить", exact: true }).click();
    await kitchen.getByText("Добавлено строк: 2").waitFor({ timeout: 30_000 });
    // Автосохранение окна — PATCH документа; ждём, пока строки дойдут до базы.
    let xRows3 = await docRows(xDoc.id);
    for (let i = 0; i < 240 && xRows3.length < 7; i += 1) {
      await kitchen.waitForTimeout(1000);
      xRows3 = await docRows(xDoc.id);
    }
    await check(
      "AC2: kitchen БЖГП «Добавить изделия списком» works as before (shared component, no time column, chain caption)",
      () => {
        assert.ok(kTitle);
        assert.equal(kHasTimeColumn, 0);
        assert.deepEqual(kPasted, [["Запеканка", "180"], ["Кисель", "200"]]);
        assert.match(kChain, /Бракераж — \d\d:\d\d, разрешение к реализации — \d\d:\d\d \(через 10 и 15 мин/);
        assert.equal(xRows3.length, 7);
        assert.deepEqual(xRows3.slice(-2).map((row) => [row.productName, row.portionWeight]), [["Запеканка", "180"], ["Кисель", "200"]]);
      },
      { kPasted, kChain, rows: xRows3.length }
    );

    /* ───────────── 6. переименование из настроек пищеблока ───────────── */
    const settings = await xCtx.newPage();
    await settings.goto(`${BASE}/settings/master-cabinet`, { waitUntil: "load" });
    await settings.getByTestId("master-cabinet-rename").click();
    await settings.locator("#prompt-async-input").fill("Мастер-кабинет Гимназии");
    await settings.getByRole("button", { name: "Сохранить", exact: true }).click();
    await settings.getByTestId("master-cabinet-name").filter({ hasText: "Мастер-кабинет Гимназии" }).waitFor();
    await shot(settings, "desktop-1440-08-settings-renamed");
    const renamed2 = await db.organization.findUniqueOrThrow({ where: { id: masterOrgId }, select: { name: true } });
    const settingsAudits = await db.auditLog.findMany({
      where: { action: "master_cabinet.renamed", organizationId: { in: [X.org.id, masterOrgId] } },
      select: { organizationId: true, details: true },
    });
    const staffDenied = await (async () => {
      const staff = await db.user.create({
        data: {
          name: "Повар без прав",
          email: `e2e-mk2-staff-${stamp}@example.test`,
          passwordHash,
          role: "cook",
          organizationId: X.org.id,
          isActive: true,
          legalVersion: LEGAL_VERSION,
          showWhatsNew: false,
        },
      });
      const ctx = await newContext({});
      await apiLogin(ctx, staff.email);
      const res = await ctx.request.patch(`${BASE}/api/settings/master-cabinet`, { data: { name: "Взлом" } });
      return res.status();
    })();
    await check(
      "AC4: owner renames the cabinet in /settings/master-cabinet — DB + AuditLog in kitchen and cabinet; staff 403",
      () => {
        assert.equal(renamed2.name, "Мастер-кабинет Гимназии");
        assert.ok(settingsAudits.some((a) => a.organizationId === X.org.id && (a.details as { via?: string }).via === "settings"));
        assert.ok(settingsAudits.some((a) => a.organizationId === masterOrgId && (a.details as { via?: string }).via === "settings"));
        assert.equal(staffDenied, 403);
      },
      { renamed2, staffDenied }
    );

    /* ───────────── 7. 390 ───────────── */
    const masterMobileCtx = await newContext({ ...mobileOpts, storageState: await masterCtx.storageState() });
    const m = await masterMobileCtx.newPage();
    await m.goto(`${BASE}/master`, { waitUntil: "load" });
    await m.getByTestId("master-brakerage-open").waitFor();
    mobileWidths["mobile-390-master"] = await widths(m);
    await shot(m, "mobile-390-01-master");
    await m.getByTestId("master-brakerage-open").click();
    await m.getByTestId("master-brakerage-dialog").waitFor();
    await m.getByTestId("master-brakerage-take-menu").click();
    mobileWidths["mobile-390-dialog"] = await widths(m);
    await shot(m, "mobile-390-02-brakerage-dialog");
    await openPicker(m, "bulk-time-0");
    mobileWidths["mobile-390-picker"] = await widths(m);
    await shot(m, "mobile-390-03-time-picker");
    await m.getByTestId("time-picker-minute-15").click();
    await m.getByTestId("master-brakerage-time-all").fill("830");
    await m.getByTestId("master-brakerage-dialog-submit").click();
    await m.getByTestId("master-brakerage-preview").waitFor({ timeout: 60_000 });
    mobileWidths["mobile-390-preview"] = await widths(m);
    await shot(m, "mobile-390-04-brakerage-preview");
    await check("390px: no horizontal page scroll (master, window, picker, preview)", () => {
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
    results.push({ check: "browser console errors (info)", ok: true, detail: consoleErrors });
    const failed = results.filter((r) => !r.ok);
    const summary = { passed: results.length - failed.length, failed: failed.length, results };
    fs.writeFileSync(path.join(__dirname, "master-v2-results.json"), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({ passed: summary.passed, failed: summary.failed }, null, 2));
    await db.$disconnect();
    process.exit(failed.length ? 1 : 0);
  });
