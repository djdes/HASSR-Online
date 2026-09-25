// E2E скоропорта по форме приложения № 5 на ЛИЧНОЙ базе копии (dev на 3041):
//   1) старые документы (без набора, старый «Стандарт», свой набор) — шапка
//      таблицы = форма, старые записи в своих графах, подписи комиссии блоком;
//   2) новый документ — форма; ввод на сайте (с «Примечанием»);
//   3) «Добавить списком» и «С фото» (вид raw, ответ — WESETUP_VISION_MOCK_FILE);
//   4) мастер-кабинет (сырьё): раздача списков → выбор в окне строки;
//   5) QR-форма: поле «Примечание» есть, запись с ним ложится в журнал;
//   6) шаблон «Стандартная форма (Приложение №5 СанПиН)» из настроек документа;
//   7) печать (PDF) и проверяющий (PDF и лист PNG) — графы формы;
//   8) телефон: карточка с отдельными «Изготовитель / Поставщик / Количество».
// Запуск: npx tsx .agent/tasks/perishable-official-form-2026-09/e2e/e2e.ts
import "./env";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { chromium, type Browser, type Page } from "playwright-core";

import { COOK_EMAIL, HERE, MANAGER_EMAIL, ORG_ID, PASSWORD, TASK_DIR, db, readState, writeState } from "./db";

const BASE = process.env.BASE ?? "http://localhost:3041";
const CHROME = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium-1232", "chrome-win64", "chrome.exe");
const SHOTS = path.join(TASK_DIR, "shots");
/**
 * Во время прогона в папку репозитория ничего не пишем: dev-сервер следит за
 * файлами проекта, и запись снимка / state.json посреди загрузки страницы
 * ломала её гидратацию (SyntaxError из eval-модуля webpack, кнопки «мёртвые»).
 * Снимки — во временную папку, в shots/ — после закрытия браузера.
 */
const SHOT_TMP = path.join(os.tmpdir(), `perishable-e2e-shots-${process.pid}`);
fs.mkdirSync(SHOT_TMP, { recursive: true });
const shot = (name: string) => path.join(SHOT_TMP, name);
const RAW = path.join(TASK_DIR, "raw");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "perishable-e2e-"));

const APPENDIX5 = [
  "Дата и час, поступления пищевой продукции",
  "Наименование",
  "Фасовка",
  "Дата выработки",
  "Изготовитель",
  "Поставщик",
  "Количество поступившего продукта (в кг, литрах, шт)",
  "Номер документа, подтверждающего безопасность принятого пищевого продукта (декларация о соответствии, свидетельство о государственной регистрации, документы по результатам ветеринарно-санитарной экспертизы)",
  "Результаты органолептической оценки, поступившего продовольственного сырья и пищевых продуктов",
  "Условия хранения, конечный срок реализации",
  "Дата и час фактической реализации",
  "Подпись ответственного лица",
  "Примечание",
];
const OWN_TEMPLATE = [
  "Продукт",
  APPENDIX5[0],
  "Изготовитель",
  "Поставщик",
  "Фасовка",
  APPENDIX5[6],
  "Т °C при приёмке",
  "Дата выработки",
  APPENDIX5[8],
  APPENDIX5[9],
  APPENDIX5[10],
  APPENDIX5[11],
  "Примечание",
];

type Check = { name: string; ok: boolean; detail?: unknown };
const checks: Check[] = [];
function check(name: string, ok: boolean, detail?: unknown) {
  checks.push({ name, ok, ...(ok ? {} : { detail }) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail !== undefined ? ` :: ${JSON.stringify(detail).slice(0, 600)}` : ""}`);
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

type PerishableRow = Record<string, unknown> & { id: string; productName: string };
async function rowsOf(id: string): Promise<PerishableRow[]> {
  const doc = await db.journalDocument.findUnique({ where: { id }, select: { config: true } });
  return ((doc?.config as { rows?: PerishableRow[] } | null)?.rows ?? []) as PerishableRow[];
}
async function waitRow(id: string, predicate: (row: PerishableRow) => boolean, timeoutMs = 45_000): Promise<PerishableRow | null> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const found = (await rowsOf(id)).find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  return null;
}

async function login(page: Page, email: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 300_000 });
    // Прошлая попытка могла войти, но не дождаться медленной сборки кабинета:
    // тогда /login сам уводит в кабинет — вход уже есть.
    if (!new URL(page.url()).pathname.startsWith("/login")) return;
    await page.fill("#email", email);
    await page.fill("#password", PASSWORD);
    await page.click('button[type="submit"]');
    const left = await page
      .waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 90_000 })
      .then(() => true)
      .catch(() => false);
    if (left) return;
  }
  throw new Error(`login failed: ${email}`);
}

/** «Мы обновили условия» (новая редакция оферты) — принять, иначе окно перекрывает страницу. */
async function acceptLegalIfShown(page: Page) {
  const modal = page.locator('[data-testid="legal-update-modal"]');
  if (!(await modal.isVisible().catch(() => false))) return;
  await modal.locator('[data-testid="legal-consent"]').check();
  await modal.locator('[data-testid="legal-update-accept"]').click();
  await modal.waitFor({ state: "detached", timeout: 30_000 }).catch(() => null);
}

async function openDoc(page: Page, id: string) {
  await page.goto(`${BASE}/journals/perishable_rejection/documents/${id}`, { waitUntil: "load", timeout: 300_000 });
  await page.waitForSelector("table:has(thead) thead th", { timeout: 180_000 });
  await page.waitForTimeout(800);
  await acceptLegalIfShown(page);
}

/**
 * Клик по кнопке, пока не откроется окно: dev-сборка догидрирует страницу
 * позже, чем сервер отдал таблицу, и ранний клик уходит «в пустоту».
 */
async function clickUntilDialog(page: Page, button: ReturnType<Page["locator"]>, attempts = 8) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt === 3 || attempt === 6) {
      // Страница так и не ожила (dev-сборка) — перезагружаем и пробуем снова.
      console.log(`RELOAD перед попыткой ${attempt + 1}`);
      await page.reload({ waitUntil: "load", timeout: 300_000 });
      await page.waitForSelector("table:has(thead) thead th", { timeout: 180_000 });
      await page.waitForTimeout(2000);
    }
    await button.click({ timeout: 60_000 });
    const opened = await page
      .getByRole("dialog")
      .first()
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (opened) return;
  }
  await page.screenshot({ path: path.join(os.tmpdir(), "perishable-e2e-no-dialog.png") }).catch(() => null);
  throw new Error(`окно не открылось (снимок: ${path.join(os.tmpdir(), "perishable-e2e-no-dialog.png")})`);
}

/**
 * Шапка и строки таблицы документа: значение поля ввода или текст ячейки.
 * Скрипт — строкой: tsx (esbuild keepNames) вставляет в функции `__name`,
 * которого нет в странице.
 */
const READ_TABLE_SCRIPT = `(() => {
  const table = document.querySelector("table:has(thead)");
  if (!table) return { heads: [], rows: [] };
  const clean = function (text) { return String(text).replace(/\\s+/g, " ").trim(); };
  const heads = Array.from(table.querySelectorAll("thead th")).map(function (th) { return clean(th.innerText).replace(/\\s*\\*$/, ""); });
  const rows = Array.from(table.querySelectorAll("tbody tr"))
    .map(function (tr) {
      return Array.from(tr.querySelectorAll("td")).map(function (td) {
        const field = td.querySelector("input:not([type=checkbox]),textarea");
        return clean(field ? field.value : td.innerText);
      });
    })
    .filter(function (cells) { return cells.length === heads.length; });
  return { heads: heads.slice(1), rows: rows.map(function (cells) { return cells.slice(1); }) };
})()`;

async function readTable(page: Page): Promise<{ heads: string[]; rows: string[][] }> {
  return (await page.evaluate(READ_TABLE_SCRIPT)) as { heads: string[]; rows: string[][] };
}

function cellsByHead(table: { heads: string[]; rows: string[][] }, product: string, productHead = "Наименование") {
  const at = table.heads.indexOf(productHead);
  const row = table.rows.find((cells) => cells[at] === product);
  return row ? Object.fromEntries(table.heads.map((head, index) => [head, row[index]])) : null;
}

function pdfTable(pdfPath: string) {
  const parsed = JSON.parse(
    execFileSync("python", [path.join(HERE, "pdf-tables.py"), pdfPath], {
      encoding: "utf8",
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      maxBuffer: 32 * 1024 * 1024,
    })
  ) as Record<string, { pages: number; tables: Array<{ cols: number; rows: string[][] }> }>;
  const info = parsed[pdfPath];
  const table = [...(info?.tables ?? [])].sort((a, b) => b.cols - a.cols)[0];
  return { pages: info?.pages ?? 0, header: table?.rows[0] ?? [], body: table?.rows.slice(1) ?? [] };
}

function testPng(): string {
  const canvas = createCanvas(320, 200);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 320, 200);
  ctx.fillStyle = "#000000";
  ctx.font = "20px sans-serif";
  ctx.fillText("Накладная: сметана 15 %", 10, 100);
  const file = path.join(TMP, "invoice.png");
  fs.writeFileSync(file, canvas.toBuffer("image/png"));
  return file;
}

async function main() {
  const state = readState();
  for (const key of ["docNoColumns", "docOldStandard", "docOwnTemplate", "docTemplateApply"]) {
    if (!state[key]) throw new Error(`нет ${key} — сначала seed-legacy.ts`);
  }
  // Снимки — в светлой теме (стенд прошлой задачи оставил руководителю тёмную).
  await db.user.update({ where: { email: MANAGER_EMAIL }, data: { themePreference: "light" } });
  // Новый документ — каждый прогон заново (создание через API тоже проверяется).
  if (state.docE2E) {
    await db.journalDocument.deleteMany({ where: { id: state.docE2E, organizationId: ORG_ID } });
    delete state.docE2E;
    writeState(state);
  }
  const manager = await db.user.findUniqueOrThrow({ where: { email: MANAGER_EMAIL }, select: { id: true } });
  const cook = await db.user.findUniqueOrThrow({ where: { email: COOK_EMAIL }, select: { id: true, qrPinHash: true } });
  const org = await db.organization.findUniqueOrThrow({ where: { id: ORG_ID }, select: { qrFillMode: true } });

  let browser: Browser | null = null;
  const errors: string[] = [];
  try {
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--use-gl=swiftshader"] });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ru-RU" });
    // «Что нового» не показывается при первом визите (ключа в localStorage
    // нет) — ключ не трогаем. Значок dev-сборки Next прячем на снимках.
    await ctx.addInitScript(
      `document.addEventListener('DOMContentLoaded',function(){var s=document.createElement('style');s.textContent='nextjs-portal{display:none!important}';document.head.appendChild(s)})`
    );
    const page = await ctx.newPage();
    page.on("pageerror", (err) => {
      errors.push(`pageerror: ${String(err).slice(0, 300)}`);
      console.log(`PAGEERROR ${String((err as Error).stack ?? err).slice(0, 600)} @ ${page.url()}`);
    });
    page.on("response", (response) => {
      const url = response.url();
      if (/\.(js|mjs)(\?|$)/.test(url) && response.status() >= 400) console.log(`JS ${response.status()} ${url}`);
    });
    page.on("requestfailed", (request) => {
      if (request.resourceType() === "script") console.log(`JSFAIL ${request.failure()?.errorText} ${request.url()}`);
    });
    page.on("console", (message) => {
      if (message.type() === "error") console.log(`CONSOLE ${message.text().slice(0, 300)}`);
    });
    await login(page, MANAGER_EMAIL);

    // ── 1. Старые документы ─────────────────────────────────────────────
    await openDoc(page, state.docNoColumns);
    let table = await readTable(page);
    check("старый документ без набора колонок: шапка таблицы = 13 граф формы приложения № 5", same(table.heads, APPENDIX5), table.heads);
    const glued = cellsByHead(table, "Творог 9 %");
    check(
      "старая «склейка» изготовитель / поставщик и фасовка / количество — по своим графам без повтора",
      glued?.["Изготовитель"] === "ООО «Молочный комбинат «Ополье»" &&
        glued?.["Поставщик"] === "ИП Смирнов А. В." &&
        glued?.["Фасовка"] === "Пакет 1 кг" &&
        glued?.[APPENDIX5[6]] === "6 шт.",
      glued
    );
    const qrRow = cellsByHead(table, "Молоко 3,2 %");
    check(
      "строка по QR (только поставщик и количество): поставщик — в «Поставщик», количество — в «Количество…», изготовитель пуст",
      qrRow?.["Изготовитель"] === "—" && qrRow?.["Поставщик"] === "ООО «Молочник»" && qrRow?.[APPENDIX5[6]] === "20 л" && qrRow?.["Примечание"] === "упаковка целая",
      qrRow
    );
    const oldRow = cellsByHead(table, "Куриное филе охл.");
    check(
      "совсем старая строка без ключей supplier / quantity: «Лоток, 12 кг» — в «Фасовка», ничего не потеряно",
      oldRow?.["Фасовка"] === "Лоток, 12 кг" && oldRow?.["Изготовитель"] === "ЗАО «Петелинская птицефабрика»" && oldRow?.["Подпись ответственного лица"] === "Мария Смирнова, Управляющий",
      oldRow
    );
    const signaturesBlock = await page.getByText("Подписи бракеражной комиссии к записям", { exact: false }).first().locator("..").innerText().catch(() => "");
    check(
      "подписи прежней комиссии — блоком под таблицей",
      signaturesBlock.includes("Салат листовой, поступление 21.09.2026 11:05 — Мария Смирнова (Председатель комиссии), 21.09.2026 11:40"),
      signaturesBlock
    );
    await page.locator("table:has(thead)").screenshot({ path: shot("site-docNoColumns-after.png") });

    await openDoc(page, state.docOldStandard);
    table = await readTable(page);
    check("старый набор «Стандартная форма» (11 граф прежнего порядка) → 13 граф формы", same(table.heads, APPENDIX5), table.heads);

    await openDoc(page, state.docOwnTemplate);
    table = await readTable(page);
    check(
      "свой набор организации сохранён: переименование, скрытая графа, своя колонка на месте; новые графы — рядом с прежними",
      same(table.heads, OWN_TEMPLATE),
      table.heads
    );
    const ownRow = cellsByHead(table, "Творог 9 %", "Продукт");
    check("свой набор: старые записи тоже по графам", ownRow?.["Поставщик"] === "ИП Смирнов А. В." && ownRow?.["Фасовка"] === "Пакет 1 кг", ownRow);

    // ── 2. Новый документ: форма, ввод на сайте ───────────────────────────
    if (!state.docE2E) {
      const res = await page.request.post(`${BASE}/api/journal-documents`, {
        data: {
          templateCode: "perishable_rejection",
          title: "Скоропорт E2E — новый",
          dateFrom: "2026-09-01",
          dateTo: "2026-09-30",
          force: true,
          responsibleUserId: manager.id,
          config: { showNote: true },
        },
        timeout: 180_000,
      });
      const json = (await res.json().catch(() => null)) as { document?: { id: string } } | null;
      if (!json?.document?.id) throw new Error(`создание документа: ${res.status()} ${JSON.stringify(json).slice(0, 300)}`);
      state.docE2E = json.document.id; // state.json пишем после прогона (см. SHOT_TMP)
    }
    const docE2E = state.docE2E;
    await openDoc(page, docE2E);
    table = await readTable(page);
    check("новый документ открывается формой приложения № 5", same(table.heads, APPENDIX5), table.heads);

    await clickUntilDialog(page, page.getByRole("button", { name: "Добавить запись" }).first());
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("Наименование изделия").fill("Кефир 2,5 %");
    await dialog.getByPlaceholder("Или введите нового изготовителя").fill("АО «Молочный завод»");
    await dialog.getByPlaceholder("Или введите нового поставщика").fill("ИП Иванов И. И.");
    await dialog.getByPlaceholder("Например: пакет 1 кг").fill("Бутылка 1 л");
    await dialog.getByPlaceholder("Например: 20 кг").fill("12 шт.");
    await dialog.locator("div.space-y-2", { has: page.locator("label", { hasText: /^Номер документа/ }) }).locator("input").fill("ЕАЭС N RU Д-RU.РА01.В.77777/26");
    await dialog.getByPlaceholder("Например: возврат поставщику, списание").fill("Проверено: без замечаний");
    await dialog.getByRole("button", { name: "Добавить запись" }).click();
    const siteRow = await waitRow(docE2E, (row) => row.productName === "Кефир 2,5 %");
    check(
      "ввод на сайте: изготовитель, поставщик, фасовка, количество, документ и «Примечание» сохранены раздельно",
      siteRow?.manufacturer === "АО «Молочный завод»" &&
        siteRow?.supplier === "ИП Иванов И. И." &&
        siteRow?.packaging === "Бутылка 1 л" &&
        siteRow?.quantity === "12 шт." &&
        siteRow?.documentNumber === "ЕАЭС N RU Д-RU.РА01.В.77777/26" &&
        siteRow?.note === "Проверено: без замечаний",
      siteRow
    );
    table = await readTable(page);
    const siteCells = cellsByHead(table, "Кефир 2,5 %");
    check(
      "ввод на сайте: в таблице — каждая величина в своей графе",
      siteCells?.["Изготовитель"] === "АО «Молочный завод»" &&
        siteCells?.["Поставщик"] === "ИП Иванов И. И." &&
        siteCells?.["Фасовка"] === "Бутылка 1 л" &&
        siteCells?.[APPENDIX5[6]] === "12 шт." &&
        siteCells?.["Примечание"] === "Проверено: без замечаний" &&
        (siteCells?.["Подпись ответственного лица"] ?? "").startsWith("Мария Смирнова"),
      siteCells
    );

    // «Примечание» прямо в таблице (ячейка — поле ввода, textarea).
    {
      const noteIndex = table.heads.indexOf("Примечание");
      const productIndex = table.heads.indexOf("Наименование");
      // Строки данных — те, где есть последняя графа (у «Добавить запись» ячейки объединены).
      const rowLocator = page
        .locator("table:has(thead) tbody tr")
        .filter({ has: page.locator(`td:nth-child(${table.heads.length + 1})`) });
      const target = rowLocator.nth(table.rows.findIndex((cells) => cells[productIndex] === "Кефир 2,5 %"));
      const noteField = target.locator(`td:nth-child(${noteIndex + 2})`).locator("input,textarea").first();
      await noteField.fill("Проверено: без замечаний; правка в таблице");
      await noteField.press("Tab");
      const edited = await waitRow(docE2E, (row) => row.note === "Проверено: без замечаний; правка в таблице");
      check("«Примечание» правится прямо в ячейке таблицы", Boolean(edited), edited?.note);
    }

    // ── 3. «Добавить списком» и «С фото» ──────────────────────────────────
    const openBulk = async () => {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await page.locator("button", { hasText: /^\s*Добавить\s*$/ }).first().click({ timeout: 60_000 });
        const item = page.getByRole("menuitem", { name: "Добавить списком" });
        if (await item.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false)) {
          await item.click();
          break;
        }
      }
      await page.getByRole("dialog").waitFor({ timeout: 30_000 });
    };
    await openBulk();
    dialog = page.getByRole("dialog");
    await dialog.locator("textarea").fill("Ряженка 4 %\nСливки 10 %");
    await dialog.getByRole("button", { name: "Добавить", exact: true }).click();
    const bulkA = await waitRow(docE2E, (row) => row.productName === "Ряженка 4 %");
    const bulkB = await waitRow(docE2E, (row) => row.productName === "Сливки 10 %");
    check("«Добавить списком»: строки добавлены", Boolean(bulkA && bulkB), [bulkA?.productName, bulkB?.productName]);

    await openBulk();
    await page.locator('[data-testid="perishable-photo-gallery"]').setInputFiles(testPng());
    await page.locator('[data-testid="photo-recognize-submit"]').click({ timeout: 60_000 });
    await page.locator('[data-testid="photo-recognize-add"]').click({ timeout: 120_000 });
    const photoRow = await waitRow(docE2E, (row) => row.productName === "Сметана 15 %");
    check(
      "«С фото» (вид raw): изготовитель, поставщик, количество, дата выработки и срок — в свои поля",
      photoRow?.manufacturer === "ООО «Вкусный завод»" &&
        photoRow?.supplier === "ООО «Поставка-Юг»" &&
        photoRow?.quantity === "6 шт." &&
        photoRow?.productionDate === "2026-09-24" &&
        photoRow?.expiryDate === "2026-10-01",
      photoRow
    );
    await page.waitForTimeout(1500);
    table = await readTable(page);
    const photoCells = cellsByHead(table, "Сметана 15 %");
    check(
      "«С фото»: в таблице поставщик и количество — в своих графах",
      photoCells?.["Изготовитель"] === "ООО «Вкусный завод»" && photoCells?.["Поставщик"] === "ООО «Поставка-Юг»" && photoCells?.[APPENDIX5[6]] === "6 шт.",
      photoCells
    );

    // ── 4. Мастер-кабинет (сырьё) ─────────────────────────────────────────
    const { replaceSharedItems } = await import("@/lib/master-directory");
    const { pushSharedListsToOrg } = await import("@/lib/master-directory-push");
    const masterId = "perishable-e2e-master";
    await db.organization.upsert({
      where: { id: masterId },
      update: { kind: "directory" },
      create: {
        id: masterId,
        name: "Мастер-кабинет E2E",
        type: "restaurant",
        kind: "directory",
        subscriptionPlan: "pro",
        subscriptionEnd: new Date(Date.now() + 30 * 86400_000),
      },
    });
    await replaceSharedItems(masterId, "product", [
      { name: "Масло сливочное 82,5 %", supplier: "ООО «Опт-Поставка»", manufacturer: "ООО «Масло-Мастер»" },
    ]);
    const pushed = await pushSharedListsToOrg(ORG_ID, masterId);
    const afterPush = (await db.journalDocument.findUniqueOrThrow({ where: { id: docE2E }, select: { config: true } })).config as {
      productLists: Array<{ items: string[] }>;
      manufacturers: string[];
      suppliers: string[];
    };
    check(
      "мастер-кабинет: сырьё, изготовитель и поставщик разданы в списки журнала",
      pushed.documents > 0 &&
        afterPush.productLists[0]?.items.includes("Масло сливочное 82,5 %") &&
        afterPush.manufacturers.includes("ООО «Масло-Мастер»") &&
        afterPush.suppliers.includes("ООО «Опт-Поставка»"),
      { pushed, lists: { products: afterPush.productLists[0]?.items, m: afterPush.manufacturers, s: afterPush.suppliers } }
    );
    await openDoc(page, docE2E);
    await clickUntilDialog(page, page.getByRole("button", { name: "Добавить запись" }).first());
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Наименование изделия").fill("Масло сливочное 82,5 %");
    const pick = async (label: RegExp, option: string) => {
      await dialog.locator("div.space-y-2", { has: page.locator("label", { hasText: label }) }).locator('button[role="combobox"]').click();
      await page.getByRole("option", { name: option, exact: true }).click();
    };
    await pick(/^Изготовитель$/, "ООО «Масло-Мастер»");
    await pick(/^Поставщик$/, "ООО «Опт-Поставка»");
    await dialog.getByRole("button", { name: "Добавить запись" }).click();
    const masterRow = await waitRow(docE2E, (row) => row.productName === "Масло сливочное 82,5 %");
    check(
      "мастер-кабинет: позиция из списков выбрана в окне строки — изготовитель и поставщик раздельно",
      masterRow?.manufacturer === "ООО «Масло-Мастер»" && masterRow?.supplier === "ООО «Опт-Поставка»",
      masterRow
    );
    table = await readTable(page);
    const masterCells = cellsByHead(table, "Масло сливочное 82,5 %");
    check(
      "мастер-кабинет: в таблице — «Изготовитель» и «Поставщик» в своих графах",
      masterCells?.["Изготовитель"] === "ООО «Масло-Мастер»" && masterCells?.["Поставщик"] === "ООО «Опт-Поставка»",
      masterCells
    );

    // ── 5. QR-форма ─────────────────────────────────────────────────────
    const { mintQrFillToken } = await import("@/lib/qr-fill-token");
    await db.organization.update({ where: { id: ORG_ID }, data: { qrFillMode: "public" } });
    await db.user.update({ where: { id: cook.id }, data: { qrPinHash: null } });
    try {
      const token = mintQrFillToken("journal", `${ORG_ID}:perishable_rejection:${docE2E}`);
      const url = `${BASE}/journal-fill/${ORG_ID}/perishable_rejection?${new URLSearchParams({ token, employee: cook.id, view: "add" })}`;
      const get = await fetch(url);
      const html = await get.text();
      const noteField = /<textarea[^>]*name="note"/.test(html);
      check("QR-форма скоропорта: есть поле «Примечание»", get.status === 200 && noteField && html.includes("Примечание"), { status: get.status, noteField });
      const form = new URLSearchParams({
        action: "submit",
        productName: "Йогурт 2 %",
        supplier: "ООО «Молочник»",
        quantity: "10 шт.",
        arrivalTime: "09:45",
        organolepticResult: "compliant",
        note: "QR: упаковка целая, возврата нет",
        __openedAt: String(Date.now() - 5000),
      });
      const post = await fetch(url, { method: "POST", body: form, redirect: "manual" });
      const qrRowSaved = await waitRow(docE2E, (row) => row.productName === "Йогурт 2 %", 20_000);
      check(
        "QR-заполнение: запись с «Примечанием», поставщиком и количеством легла в журнал",
        post.status === 303 &&
          qrRowSaved?.note === "QR: упаковка целая, возврата нет" &&
          qrRowSaved?.supplier === "ООО «Молочник»" &&
          qrRowSaved?.quantity === "10 шт." &&
          typeof qrRowSaved?.sourceRowKey === "string",
        { status: post.status, location: post.headers.get("location"), row: qrRowSaved }
      );
    } finally {
      await db.organization.update({ where: { id: ORG_ID }, data: { qrFillMode: org.qrFillMode } });
      await db.user.update({ where: { id: cook.id }, data: { qrPinHash: cook.qrPinHash } });
    }
    await openDoc(page, docE2E);
    table = await readTable(page);
    const qrCells = cellsByHead(table, "Йогурт 2 %");
    check(
      "QR: на сайте запись по графам формы, «Примечание» видно",
      qrCells?.["Поставщик"] === "ООО «Молочник»" && qrCells?.[APPENDIX5[6]] === "10 шт." && qrCells?.["Примечание"] === "QR: упаковка целая, возврата нет",
      qrCells
    );
    await page.locator("table:has(thead)").screenshot({ path: shot("site-docE2E-after.png") });

    // ── 6. Шаблон «Стандартная форма (Приложение №5 СанПиН)» из настроек ──
    await openDoc(page, state.docTemplateApply);
    table = await readTable(page);
    check("до применения шаблона — свой набор организации", same(table.heads, OWN_TEMPLATE), table.heads);
    await clickUntilDialog(page, page.getByRole("button", { name: "Настройки документа" }));
    const settings = page.getByRole("dialog");
    await settings.getByLabel("Выбрать шаблон колонок").selectOption({ label: "Стандартная форма (Приложение №5 СанПиН)" }, { timeout: 30_000 });
    await settings.getByRole("button", { name: "Заменить колонки" }).click();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(2500);
    await openDoc(page, state.docTemplateApply);
    table = await readTable(page);
    check("шаблон «Стандартная форма (Приложение №5 СанПиН)» из настроек документа → ровно 13 граф формы", same(table.heads, APPENDIX5), table.heads);

    // ── 7. Печать и проверяющий ──────────────────────────────────────────
    const pdfRes = await page.request.get(`${BASE}/api/journal-documents/${docE2E}/pdf`, { timeout: 180_000 });
    const pdfPath = path.join(TMP, "docE2E.pdf");
    fs.writeFileSync(pdfPath, await pdfRes.body());
    const printed = pdfTable(pdfPath);
    const printedRow = (product: string) => {
      const at = printed.header.indexOf("Наименование");
      const row = printed.body.find((cells) => cells[at] === product);
      return row ? Object.fromEntries(printed.header.map((head, index) => [head, row[index]])) : null;
    };
    check("печать (PDF с сайта): 13 граф формы по порядку", pdfRes.status() === 200 && same(printed.header, APPENDIX5), { status: pdfRes.status(), header: printed.header });
    const printedSite = printedRow("Кефир 2,5 %");
    const printedQr = printedRow("Йогурт 2 %");
    check(
      "печать: «Примечание» с сайта и по QR напечатано, поставщик и количество — в своих графах",
      printedSite?.["Примечание"] === "Проверено: без замечаний; правка в таблице" &&
        printedSite?.["Поставщик"] === "ИП Иванов И. И." &&
        printedQr?.["Примечание"] === "QR: упаковка целая, возврата нет" &&
        printedQr?.[APPENDIX5[6]] === "10 шт.",
      { printedSite, printedQr }
    );

    const tokenRes = await page.request.post(`${BASE}/api/settings/inspector-tokens`, {
      data: { label: "E2E скоропорт", periodFrom: "2026-09-01", periodTo: "2026-09-30", ttlHours: 24 },
    });
    const tokenJson = (await tokenRes.json().catch(() => null)) as { rawToken?: string } | null;
    const raw = tokenJson?.rawToken ?? "";
    const inspPdf = await fetch(`${BASE}/api/inspector/${raw}/documents/${docE2E}/pdf`);
    const inspPath = path.join(TMP, "inspector.pdf");
    fs.writeFileSync(inspPath, Buffer.from(await inspPdf.arrayBuffer()));
    const inspected = inspPdf.status === 200 ? pdfTable(inspPath) : { header: [] as string[] };
    check("проверяющий: PDF документа — те же 13 граф формы", inspPdf.status === 200 && same(inspected.header, APPENDIX5), { status: inspPdf.status, header: inspected.header });
    const inspPng = await fetch(`${BASE}/api/inspector/${raw}/documents/${docE2E}/pages/1.png`);
    const pngBytes = Buffer.from(await inspPng.arrayBuffer());
    if (inspPng.status === 200) fs.writeFileSync(shot("inspector-docE2E-page1.png"), pngBytes);
    check("проверяющий: лист 1 документа (PNG) отдаётся", inspPng.status === 200 && pngBytes.length > 10_000, { status: inspPng.status, bytes: pngBytes.length });

    // ── 8. Телефон: карточки ─────────────────────────────────────────────
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "ru-RU" });
    await mobile.addInitScript(
      `document.addEventListener('DOMContentLoaded',function(){var s=document.createElement('style');s.textContent='nextjs-portal{display:none!important}';document.head.appendChild(s)})`
    );
    const phone = await mobile.newPage();
    phone.on("pageerror", (err) => errors.push(`pageerror(mobile): ${String(err).slice(0, 300)}`));
    await login(phone, MANAGER_EMAIL);
    await phone.goto(`${BASE}/journals/perishable_rejection/documents/${docE2E}`, { waitUntil: "load", timeout: 300_000 });
    await phone.waitForTimeout(1500);
    await acceptLegalIfShown(phone);
    // На телефоне документ открывается карточками; переключатель «Карточки /
    // Таблица» — сегменты, не кнопки. Нажимаем «Карточки» на всякий случай.
    await phone.getByText("Карточки", { exact: true }).first().click({ timeout: 120_000 });
    // Карточка раскрывается тапом; подписи полей — CSS uppercase, поэтому textContent.
    const card = phone
      .locator("div.rounded-2xl.border.bg-white", { has: phone.locator("button[aria-expanded]", { hasText: "Кефир 2,5 %" }) })
      .first();
    await card.locator("button[aria-expanded]").click({ timeout: 60_000 });
    await phone.waitForTimeout(500);
    const cardText = ((await card.textContent({ timeout: 60_000 }).catch(() => "")) ?? "").replace(/\s+/g, " ");
    check(
      "телефон: в карточке «Изготовитель», «Поставщик», «Количество» — отдельными полями",
      cardText.includes("Изготовитель") && cardText.includes("АО «Молочный завод»") && cardText.includes("Поставщик") && cardText.includes("ИП Иванов И. И.") && cardText.includes("Количество") && cardText.includes("12 шт."),
      cardText.slice(0, 400)
    );
    await card.screenshot({ path: shot("site-mobile-card-after.png") }).catch(() => null);
    await mobile.close();

    check("без ошибок страницы (pageerror)", errors.length === 0, errors);
  } finally {
    await browser?.close().catch(() => null);
    writeState(state);
    fs.mkdirSync(SHOTS, { recursive: true });
    for (const name of fs.readdirSync(SHOT_TMP)) fs.copyFileSync(path.join(SHOT_TMP, name), path.join(SHOTS, name));
    fs.rmSync(SHOT_TMP, { recursive: true, force: true });
    await db.sharedDirectoryItem.deleteMany({ where: { organizationId: "perishable-e2e-master" } }).catch(() => null);
    await db.organization.deleteMany({ where: { id: "perishable-e2e-master" } }).catch(() => null);
    fs.rmSync(TMP, { recursive: true, force: true });
  }

  fs.mkdirSync(RAW, { recursive: true });
  fs.writeFileSync(path.join(RAW, "e2e.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), checks }, null, 2));
  const failed = checks.filter((item) => !item.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
  process.exitCode = failed.length ? 1 : 0;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 2;
  })
  .finally(() => db.$disconnect());
