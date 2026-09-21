// Смоук шаблонов колонок (этап B):
//   1) API отдаёт встроенный шаблон «Рекомендуемая форма…» и сохраняет свой;
//   2) импорт «типовой формы» из .xlsx (шапка фото + строка нумерации) узнаёт 8 колонок;
//   3) образец .xlsx скачивается;
//   4) в «Настройках документа» выбор шаблона показывает предупреждение и заменяет колонки.
// Запуск (dev на 3020 с wesetup_e2e): npx tsx .agent/tasks/brakerage-commission-2026-09/e2e/smoke-templates.ts
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { chromium, type Page } from "playwright";

import { db } from "../../journal-responsibles-org-2026-09/e2e/db";

const BASE = process.env.BASE ?? "http://localhost:3020";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SHOTS = path.join(HERE, "..", "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const state = JSON.parse(
  fs.readFileSync(path.join(HERE, "..", "..", "journal-responsibles-org-2026-09", "e2e", "state.json"), "utf8")
);
const FP_DOC = "cmu3xu9lc005lks9mmmr8ltma";

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

async function photoWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Лист1");
  sheet.addRow(["МАУ «Комбинат питания «Доброе кафе»"]);
  sheet.addRow(["Журнал бракеража готовой пищевой продукции"]);
  sheet.addRow([
    "Дата и час изготовления блюда",
    "Время снятия бракеража",
    "Наименование готового блюда",
    "Результаты органолептической оценки качества готовых блюд",
    "Разрешение к реализации блюда, кулинарного изделия",
    "Подпись бракеражной комиссии",
    "Результат взвешивания порционных блюд",
    "Примечание",
  ]);
  sheet.addRow([1, 2, 3, 4, 5, 6, 7, 8]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function main() {
  const original = await db.journalDocument.findUniqueOrThrow({ where: { id: FP_DOC }, select: { config: true } });
  const browser = await chromium.launch({ channel: "chrome" });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  try {
    await login(page, state.users.managerA.email);

    const list = await ctx.request.get(`${BASE}/api/settings/journal-column-templates?code=finished_product`);
    const listBody = (await list.json()) as { templates: Array<{ id: string; name: string }> };
    check(
      "встроенный шаблон «Рекомендуемая форма в соответствии с Приложением №4…» в списке",
      listBody.templates.some((t) => t.name.startsWith("Рекомендуемая форма в соответствии с Приложением №4")),
      listBody
    );

    const imported = await ctx.request.post(`${BASE}/api/settings/journal-column-templates/import`, {
      multipart: {
        code: "finished_product",
        file: { name: "форма.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: await photoWorkbook() },
      },
    });
    const importBody = (await imported.json()) as { matched?: Array<{ key: string }>; custom?: string[]; error?: string };
    check(
      "импорт типовой формы из Excel узнал 8 колонок, своих не добавил",
      imported.status() === 200 && importBody.matched?.length === 8 && importBody.custom?.length === 0,
      importBody
    );

    const sample = await ctx.request.get(`${BASE}/api/settings/journal-column-templates/import?code=finished_product`);
    check("образец .xlsx скачивается", sample.status() === 200 && (await sample.body()).length > 1000, sample.status());

    const saved = await ctx.request.post(`${BASE}/api/settings/journal-column-templates`, {
      data: { code: "finished_product", name: "E2E мой шаблон", columns: { hidden: ["temp"], labels: { name: "Блюдо" } } },
    });
    const savedBody = (await saved.json()) as { template?: { id: string } };
    check("свой шаблон сохраняется", saved.status() === 200 && Boolean(savedBody.template?.id), savedBody);

    // UI: «Настройки документа» → шаблон → предупреждение → замена.
    await page.goto(`${BASE}/journals/finished_product/documents/${FP_DOC}`, { waitUntil: "load", timeout: 240_000 });
    await page.getByRole("button", { name: /Настройки документа/ }).first().click();
    const select = page.getByLabel("Выбрать шаблон колонок");
    await select.waitFor({ timeout: 60_000 });
    const options = await select.locator("option").allInnerTexts();
    check("в настройках есть выбор шаблона и свой шаблон в списке", options.some((o) => o.includes("E2E мой шаблон")), options);
    const appendixValue = await select.locator("option", { hasText: "Рекомендуемая форма" }).getAttribute("value");
    await select.selectOption(appendixValue ?? "");
    const warn = page.getByRole("alert").filter({ hasText: "Колонки документа заменятся" });
    await warn.waitFor({ timeout: 30_000 });
    await page.screenshot({ path: path.join(SHOTS, "110-template-warning.png") });
    check("выбор шаблона показывает предупреждение со списком изменений", (await warn.innerText()).includes("не удаляются"));
    await page.getByRole("button", { name: "Заменить колонки" }).click();
    await page.getByRole("button", { name: "Сохранить", exact: true }).last().click();
    let columns: { hidden?: string[]; order?: string[] } | undefined;
    for (let i = 0; i < 30; i += 1) {
      await page.waitForTimeout(1000);
      const cfg = (await db.journalDocument.findUniqueOrThrow({ where: { id: FP_DOC }, select: { config: true } })).config as {
        columns?: { hidden?: string[]; order?: string[] };
      };
      columns = cfg.columns;
      if (columns?.order?.[5] === "signatures") break;
    }
    check(
      "после «Заменить колонки» и «Сохранить» документ — форма Приложения 4",
      Boolean(columns?.hidden?.includes("responsible") && columns?.order?.[5] === "signatures"),
      columns
    );
    check("без ошибок в консоли страницы", errors.length === 0, errors);
  } finally {
    await browser.close();
    await db.journalDocument.update({ where: { id: FP_DOC }, data: { config: original.config as never } });
    await db.journalColumnTemplate.deleteMany({ where: { organizationId: "e2e-org-a", name: "E2E мой шаблон" } });
    fs.writeFileSync(path.join(HERE, "smoke-templates.json"), JSON.stringify(checks, null, 2));
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
