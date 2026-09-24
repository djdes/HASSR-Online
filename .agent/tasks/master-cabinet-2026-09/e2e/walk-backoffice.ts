/**
 * Проход глазами сотрудника бэк-офиса (мастер-кабинет справочников):
 * приглашение → пароль → первый вход → пустой кабинет → реальная выгрузка
 * меню из iiko (заголовок отчёта, группы, дубли, «Итого») → сырьё списком →
 * объекты → выход/вход → попытки уйти из кабинета → «Забыли пароль» →
 * телефон 390 → вид со стороны пищеблока.
 *
 * Скриншоты: WALK_DIR (по умолчанию C:/wt/walk). Браузер видимый.
 * Запуск: E2E_BASE=http://localhost:3033 npx tsx .agent/tasks/master-cabinet-2026-09/e2e/walk-backoffice.ts
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import * as XLSX from "xlsx";
import { chromium, type Page } from "playwright-core";

import { db } from "@/lib/db";
import { ensureServiceCode, linkDishPool } from "@/lib/dish-pool";
import { LEGAL_VERSION } from "@/lib/legal-consent";

const BASE = process.env.E2E_BASE ?? "http://localhost:3033";
const OUT = process.env.WALK_DIR ?? "C:/wt/walk";
const CHROME = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium-1232", "chrome-win64", "chrome.exe");
const HEADLESS = process.env.WALK_HEADLESS === "1";
const stamp = Date.now().toString(36);
const password = "Test12345!";
const log: string[] = [];
const created: string[] = [];
const problems: string[] = [];

fs.mkdirSync(OUT, { recursive: true });
function note(s: string) {
  log.push(s);
  console.log(s);
}
async function shot(page: Page, name: string, fullPage = false) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
}

async function main() {
  const [fpT, prT] = await Promise.all([
    db.journalTemplate.findFirstOrThrow({ where: { code: "finished_product" } }),
    db.journalTemplate.findFirstOrThrow({ where: { code: "perishable_rejection" } }),
  ]);
  const passwordHash = await bcrypt.hash(password, 10);
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));

  async function makeOrg(name: string, email: string) {
    const org = await db.organization.create({ data: { name, type: "education" } });
    created.push(org.id);
    const owner = await db.user.create({
      data: { name: "Иванова Анна", email, passwordHash, role: "manager", organizationId: org.id, isActive: true, legalVersion: LEGAL_VERSION, showWhatsNew: false },
    });
    const fp = await db.journalDocument.create({
      data: { templateId: fpT.id, organizationId: org.id, title: "Журнал бракеража готовой пищевой продукции", dateFrom: from, dateTo: to, config: { rows: [], itemsCatalog: ["Сырники со сметаной"], productLists: [] } },
    });
    await db.journalDocument.create({
      data: { templateId: prT.id, organizationId: org.id, title: "Журнал бракеража скоропортящейся пищевой продукции", dateFrom: from, dateTo: to, config: { rows: [], productLists: [{ id: "l1", name: "Изделия", items: ["Сметана 20%"] }], suppliers: [], manufacturers: [] } },
    });
    return { org, owner, fp };
  }

  const X = await makeOrg(`Школа № 5 (пищеблок) ${stamp}`, `walk-x-${stamp}@example.test`);
  const Y = await makeOrg(`Детский сад «Солнышко» ${stamp}`, `walk-y-${stamp}@example.test`);
  const code = await ensureServiceCode(X.org.id);
  await linkDishPool(Y.org.id, code);

  // Реальная выгрузка номенклатуры из iiko: заголовок отчёта, пустая строка,
  // шапка не в первой строке, группы, дубль с другим регистром, «Итого».
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Номенклатура. Выгрузка из iiko от 24.09.2026"],
      [],
      ["Код", "Наименование", "Тип", "Ед. изм.", "Цена"],
      ["", "Супы", "Группа", "", ""],
      ["00001", "Борщ со сметаной", "Блюдо", "порц", 95],
      ["00002", "Суп куриный с лапшой", "Блюдо", "порц", 80],
      ["", "Вторые блюда", "Группа", "", ""],
      ["00003", "Котлета рыбная", "Блюдо", "порц", 110],
      ["00004", "Плов из курицы", "Блюдо", "порц", 120],
      ["00005", "борщ со сметаной ", "Блюдо", "порц", 95],
      ["", "", "", "", ""],
      ["00006", "Компот из сухофруктов", "Блюдо", "порц", 35],
      ["", "Итого: 6 позиций", "", "", ""],
    ]),
    "Номенклатура"
  );
  const menuPath = path.join(OUT, "menu-iiko.xlsx");
  XLSX.writeFile(wb, menuPath);

  const browser = await chromium.launch({ executablePath: CHROME, headless: HEADLESS, args: ["--window-size=1460,1000"] });
  try {
    // 1. Руководитель пищеблока создаёт кабинет
    const ownerCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    ownerCtx.setDefaultTimeout(120_000);
    await ownerCtx.request.post(`${BASE}/api/auth/login`, { data: { email: X.owner.email, password } });
    const owner = await ownerCtx.newPage();
    await owner.goto(`${BASE}/settings/master-cabinet`, { waitUntil: "load" });
    await owner.getByTestId("master-pool-code").waitFor();
    await shot(owner, "w01-owner-settings", true);
    const backofficeEmail = `backoffice-${stamp}@example.test`;
    await owner.getByTestId("master-invite-name").fill("Петрова Мария Сергеевна");
    await owner.getByTestId("master-invite-email").fill(backofficeEmail);
    await owner.getByTestId("master-invite-submit").click();
    await owner.getByRole("dialog").waitFor();
    await shot(owner, "w02-owner-confirm");
    await owner.getByRole("dialog").getByRole("button", { name: "Создать и пригласить" }).click();
    await owner.getByTestId("master-invite-result").waitFor({ timeout: 60_000 });
    const inviteUrl = (await owner.getByTestId("master-invite-url").inputValue()).replace(/^https?:\/\/[^/]+/, BASE);
    const masterOrg = await db.organization.findFirst({ where: { kind: "directory", linkedServiceCode: code } });
    if (masterOrg) created.push(masterOrg.id);
    await shot(owner, "w03-owner-created", true);

    // 2. Сотрудник бэк-офиса: приглашение
    const boCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    boCtx.setDefaultTimeout(120_000);
    const bo = await boCtx.newPage();
    const nav: string[] = [];
    bo.on("framenavigated", (f) => { if (f === bo.mainFrame()) nav.push(new URL(f.url()).pathname); });
    await bo.goto(inviteUrl, { waitUntil: "load" });
    await shot(bo, "w04-invite-page");
    note(`invite page text: ${(await bo.locator("main, body").first().innerText()).replace(/\s+/g, " ").slice(0, 400)}`);
    await bo.locator("#password").fill(password);
    await bo.locator("#confirm").fill(password);
    await bo.locator('button[type="submit"]').click();
    await bo.waitForURL(/\/master(\?|$)/, { timeout: 120_000 });
    await bo.waitForTimeout(1500);
    note(`after accept navigation chain: ${nav.join(" → ")}`);
    if (nav.includes("/dashboard")) problems.push("после пароля крюк через /dashboard");
    await shot(bo, "w05-first-login");
    note(`first screen text: ${(await bo.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 700)}`);

    // 3. Загрузка меню из iiko
    await bo.getByTestId("master-upload-dish").first().click();
    const fileInput = bo.locator('input[type="file"]').first();
    await fileInput.setInputFiles(menuPath);
    await bo.getByTestId("master-preview").waitFor({ timeout: 60_000 });
    await shot(bo, "w06-menu-preview");
    const previewText = (await bo.getByTestId("master-preview").innerText()).replace(/\s+/g, " ");
    note(`menu preview: ${previewText.slice(0, 600)}`);
    for (const junk of ["Номенклатура. Выгрузка", "Итого", "Группа", "Супы", "Вторые блюда", "00001", "Код"]) {
      if (previewText.includes(junk)) problems.push(`меню из iiko: в предпросмотр попало «${junk}»`);
    }
    await bo.getByRole("button", { name: "Сохранить и разослать" }).click();
    await bo.locator("[data-sonner-toast]").filter({ hasText: "Готово" }).first().waitFor({ timeout: 120_000 });
    await bo.getByTestId("master-list-dish").waitFor();
    await shot(bo, "w07-menu-list");

    // 4. Сырьё списком
    await bo.getByTestId("master-tab-raw").click();
    await bo.getByTestId("master-paste-product").first().click();
    await shot(bo, "w08-raw-paste-dialog");
    await bo.getByTestId("master-paste-text").fill(
      "Молоко 3,2% | ООО «Агрокомплекс» | АО «Молочный комбинат»\nКартофель | ИП Петров\nФиле куриное охлаждённое | ООО «Приосколье» | ЗАО «Приосколье»\nЯйцо куриное С1; Творог 9%"
    );
    await bo.getByRole("button", { name: "Показать изменения" }).click();
    await bo.getByTestId("master-preview").waitFor({ timeout: 60_000 });
    await bo.getByRole("button", { name: "Сохранить и разослать" }).click();
    await bo.locator("[data-sonner-toast]").filter({ hasText: "Готово" }).first().waitFor({ timeout: 120_000 });
    await bo.getByTestId("master-list-product").waitFor();
    await shot(bo, "w09-raw-list");

    // 5. Объекты
    await bo.getByRole("tab", { name: /Объекты/ }).or(bo.getByTestId("master-tab-objects")).first().click();
    await shot(bo, "w10-objects");

    // 6. Попытки уйти из кабинета
    for (const p of ["/dashboard", "/journals", "/settings", "/settings/users", "/orders", "/"]) {
      await bo.goto(`${BASE}${p}`, { waitUntil: "domcontentloaded" });
      note(`bo ${p} → ${new URL(bo.url()).pathname}`);
    }
    await shot(bo, "w11-after-landing-visit");

    // 7. Выход и повторный вход
    await bo.goto(`${BASE}/master`, { waitUntil: "load" });
    const cookies = await boCtx.cookies();
    await boCtx.clearCookies();
    note(`cookies before logout: ${cookies.length}`);
    await bo.goto(`${BASE}/login`, { waitUntil: "load" });
    await shot(bo, "w12-login");
    const forgot = bo.getByRole("link", { name: /Забыли|забыли/ }).first();
    note(`login has «Забыли пароль»: ${await forgot.count()}`);
    await bo.locator('input[type="email"], input[name="email"]').first().fill(backofficeEmail);
    await bo.locator('input[type="password"]').first().fill(password);
    nav.length = 0;
    await bo.locator('button[type="submit"]').first().click();
    await bo.waitForURL(/\/master(\?|$)/, { timeout: 120_000 }).catch(() => problems.push(`повторный вход: не попал в /master, url=${bo.url()}`));
    note(`relogin chain: ${nav.join(" → ")}`);
    await shot(bo, "w13-relogin");

    // 8. Телефон
    const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await boCtx.storageState() });
    mob.setDefaultTimeout(120_000);
    const m = await mob.newPage();
    await m.goto(`${BASE}/master`, { waitUntil: "load" });
    await m.getByTestId("master-list-dish").waitFor().catch(() => undefined);
    await shot(m, "w14-mobile-menu", true);
    const sw = await m.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    if (sw[0] > sw[1]) problems.push(`телефон: горизонтальная прокрутка ${sw[0]} > ${sw[1]}`);
    await m.getByTestId("master-paste-dish").first().click().catch(() => undefined);
    await shot(m, "w15-mobile-paste");
    await mob.close();

    // 9. Вид со стороны пищеблока Y
    const yCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    yCtx.setDefaultTimeout(120_000);
    await yCtx.request.post(`${BASE}/api/auth/login`, { data: { email: Y.owner.email, password } });
    const y = await yCtx.newPage();
    const yDoc = await db.journalDocument.findFirst({ where: { organizationId: Y.org.id, template: { code: "finished_product" } } });
    await y.goto(`${BASE}/journals/finished_product/documents/${yDoc?.id}`, { waitUntil: "load" });
    await y.waitForTimeout(2500);
    await shot(y, "w16-kitchen-bzhgp");
    await y.getByRole("button", { name: "Понятно" }).click().catch(() => undefined);
    await y.getByRole("button", { name: /Редактировать список изделий/ }).first().click().catch((e) => problems.push("нет кнопки списка изделий: " + String(e).slice(0, 120)));
    await y.getByRole("dialog").waitFor().catch(() => undefined);
    await shot(y, "w17-kitchen-items-dialog");
    const dlg = await y.getByRole("dialog").innerText().catch(() => "");
    if (!dlg.includes("Мастер-кабинет")) problems.push("в списке изделий пищеблока нет пометки «Мастер-кабинет»");
    const yCfg = (await db.journalDocument.findUnique({ where: { id: yDoc!.id } }))?.config as Record<string, unknown>;
    note(`Y itemsCatalog: ${JSON.stringify(yCfg?.itemsCatalog)}`);
  } finally {
    await browser.close();
  }
}

main()
  .catch((err) => { problems.push(`script: ${String(err).slice(0, 500)}`); console.error(err); })
  .finally(async () => {
    if (process.env.WALK_KEEP !== "1") await db.organization.deleteMany({ where: { id: { in: created } } }).catch(() => undefined);
    fs.writeFileSync(path.join(OUT, "walk.json"), JSON.stringify({ log, problems }, null, 2));
    console.log(JSON.stringify({ problems }, null, 2));
    await db.$disconnect();
  });
