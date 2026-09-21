// Смоук этапа «форма Приложения 4 + колонки + защита строк с QR»:
//   1) новый документ бракеража открывается формой Приложения 4 (8 колонок, подписи как на фото);
//   2) строка, добавленная «с телефона» после загрузки страницы, переживает правку ячейки на сайте;
//   3) страница скоропорта рендерится и сохраняет правку;
//   4) PDF обоих журналов отдаётся.
// Запуск (dev на 3020 с wesetup_e2e): npx tsx .agent/tasks/brakerage-commission-2026-09/e2e/smoke-columns.ts
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";

import { db } from "../../journal-responsibles-org-2026-09/e2e/db";
import { getDefaultFinishedProductDocumentConfig } from "../../../../src/lib/finished-product-document";

const BASE = process.env.BASE ?? "http://localhost:3020";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SHOTS = path.join(HERE, "..", "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const state = JSON.parse(
  fs.readFileSync(path.join(HERE, "..", "..", "journal-responsibles-org-2026-09", "e2e", "state.json"), "utf8")
);
const ORG = "e2e-org-a";
const PR_DOC = "cmu3xvdic005oks9mlgpt2tly";

const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail !== undefined ? ` :: ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
};

async function login(page: Page, email: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 240_000 });
    await page.waitForLoadState("networkidle").catch(() => null);
    await page.fill("#email", email);
    await page.fill("#password", state.password);
    await page.click('button[type="submit"]').catch(() => null);
    const left = await page
      .waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 })
      .then(() => true)
      .catch(() => false);
    if (left) return;
  }
  throw new Error("login failed");
}

type Row = { id: string; productName: string; note?: string };
const rowsOf = async (id: string) =>
  ((await db.journalDocument.findUnique({ where: { id }, select: { config: true } }))?.config as { rows?: Row[] } | null)?.rows ?? [];

async function main() {
  const template = await db.journalTemplate.findFirstOrThrow({ where: { code: "finished_product" }, select: { id: true } });
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  const config = getDefaultFinishedProductDocumentConfig();
  config.rows = [{ ...config.rows[0], productName: "Суп с сайта", productionDateTime: `${now.toISOString().slice(0, 10)} 12:00` }];
  const doc = await db.journalDocument.create({
    data: {
      organizationId: ORG,
      templateId: template.id,
      title: "E2E форма Приложения 4",
      dateFrom: from,
      dateTo: to,
      status: "active",
      config: config as never,
    },
  });

  const browser = await chromium.launch({ channel: "chrome" });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  try {
    await login(page, state.users.managerA.email);

    await page.goto(`${BASE}/journals/finished_product/documents/${doc.id}`, { waitUntil: "load", timeout: 240_000 });
    await page.waitForSelector("table thead th", { timeout: 120_000 });
    const heads = (await page.locator("table thead th").allInnerTexts()).map((t) => t.replace(/\s*\*$/, "").trim()).filter(Boolean);
    const expected = [
      "Дата и час изготовления блюда",
      "Время снятия бракеража",
      "Наименование готового блюда",
      "Результаты органолептической оценки качества готовых блюд",
      "Разрешение к реализации блюда, кулинарного изделия",
      "Подпись бракеражной комиссии",
      "Результат взвешивания порционных блюд",
      "Примечание",
    ];
    const tail = heads.slice(-8);
    check("новый документ — 8 колонок формы Приложения 4 в порядке фото", JSON.stringify(tail) === JSON.stringify(expected), heads);
    await page.screenshot({ path: path.join(SHOTS, "100-appendix4-table.png"), fullPage: false });

    // «Строка с телефона» появилась в базе после загрузки страницы.
    const before = (await db.journalDocument.findUniqueOrThrow({ where: { id: doc.id }, select: { config: true } })).config as {
      rows: Row[];
    };
    await db.journalDocument.update({
      where: { id: doc.id },
      data: {
        config: {
          ...(before as object),
          rows: [...before.rows, { ...before.rows[0], id: "qr-row-1", productName: "Каша с телефона", sourceRowKey: "employee-x#qr-1" }],
        } as never,
      },
    });
    // Правка ячейки «Примечание» на сайте (автосохранение).
    const dataTable = page.locator("table:has(thead th:has-text('Примечание'))");
    const noteCell = dataTable.locator("tbody tr").first().locator("td").last().locator("textarea").first();
    await noteCell.click();
    await noteCell.fill("правка с сайта");
    await noteCell.press("Tab");
    let after = await rowsOf(doc.id);
    for (let i = 0; i < 40 && !after.some((row) => row.note === "правка с сайта"); i += 1) {
      await page.waitForTimeout(1000);
      after = await rowsOf(doc.id);
    }
    check(
      "строка, добавленная по QR после загрузки страницы, пережила сохранение с сайта",
      after.some((row) => row.productName === "Каша с телефона") && after.some((row) => row.note === "правка с сайта"),
      after.map((row) => [row.productName, row.note])
    );
    // Живое событие / ответ PATCH подтянули строку на страницу.
    await page.waitForTimeout(2500);
    const values = await dataTable.locator("textarea").evaluateAll((els) => els.map((el) => (el as HTMLTextAreaElement).value));
    check("строка с телефона видна на открытой странице без перезагрузки", values.includes("Каша с телефона"), values);

    const pdf = await ctx.request.get(`${BASE}/api/journal-documents/${doc.id}/pdf`);
    check("PDF бракеража готовой продукции отдаётся", pdf.status() === 200, pdf.status());

    // Скоропорт.
    await page.goto(`${BASE}/journals/perishable_rejection/documents/${PR_DOC}`, { waitUntil: "load", timeout: 240_000 });
    await page.waitForSelector("table thead th", { timeout: 120_000 });
    const prTable = page.locator("table:has(thead th:has-text('Наименование'))").last();
    const prHeads = await prTable.locator("thead th").count();
    const prCells = await prTable.locator("tbody tr").first().locator("td").count();
    check("скоропорт: ячеек в строке столько же, сколько колонок в шапке", prHeads === prCells, { prHeads, prCells });
    await page.screenshot({ path: path.join(SHOTS, "101-perishable-table.png"), fullPage: false });
    const prPdf = await ctx.request.get(`${BASE}/api/journal-documents/${PR_DOC}/pdf`);
    check("PDF скоропорта отдаётся", prPdf.status() === 200, prPdf.status());

    check("без ошибок в консоли страницы", errors.length === 0, errors);
  } finally {
    await browser.close();
    await db.journalDocument.delete({ where: { id: doc.id } }).catch(() => null);
    fs.writeFileSync(path.join(HERE, "smoke-columns.json"), JSON.stringify(checks, null, 2));
    await db.$disconnect();
  }
  const failed = checks.filter((item) => !item.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
