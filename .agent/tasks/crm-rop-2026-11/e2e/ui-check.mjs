// Живая проверка экранов CRM на локальном сервере (next dev :3000, локальная БД).
//   node .agent/tasks/crm-rop-2026-11/e2e/ui-check.mjs
import { chromium, devices } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = ".agent/tasks/crm-rop-2026-11/raw/screens";
mkdirSync(OUT, { recursive: true });
const log = [];
const note = (line) => {
  log.push(line);
  console.log(line);
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, locale: "ru-RU" });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(`${page.url()} :: ${message.text().slice(0, 300)}`);
});
page.on("pageerror", (error) => consoleErrors.push(`${page.url()} :: pageerror ${error.message.slice(0, 300)}`));

async function shot(name, full = true) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  note(`screenshot ${name}.png`);
}

// Вход владельцем платформы.
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.fill('input[placeholder="name@company.com"]', "owner@wesetup.local.test");
await page.fill('input[type="password"]', "LocalRoot-2026!");
await page.click('button[type="submit"]');
await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 });
note(`logged in → ${new URL(page.url()).pathname}`);

// Сводка.
await page.goto(`${BASE}/root/crm`, { waitUntil: "networkidle" });
await page.waitForSelector("[data-crm-summary]");
note(`summary tiles: ${(await page.locator("[data-crm-tile]").allTextContents()).map((text) => text.replace(/\s+/g, " ").trim()).join(" | ")}`);
note(`nav has CRM: ${await page.locator('header a[href="/root/crm"]').count()}`);
await shot("01-summary-desktop");

// «Обновить сейчас».
await page.click("[data-crm-sync]");
await page.waitForSelector("[data-sonner-toast]", { timeout: 120_000 });
note(`sync toast: ${(await page.locator("[data-sonner-toast]").first().textContent())?.replace(/\s+/g, " ")}`);

// Список «Ждут ответа».
await page.goto(`${BASE}/root/crm/contacts?queue=awaiting`, { waitUntil: "networkidle" });
const awaitingRows = await page.locator("[data-crm-contact-row]").count();
note(`awaiting rows: ${awaitingRows}`);
await shot("02-contacts-awaiting");

// Поиск.
await page.goto(`${BASE}/root/crm/contacts?q=${encodeURIComponent("Анна")}`, { waitUntil: "networkidle" });
note(`search «Анна» rows: ${await page.locator("[data-crm-contact-row]").count()}`);
const annaHref = await page.locator("[data-crm-contact-row] a").first().getAttribute("href");

// Карточка: ответственный, шаг, заметка, письмо, «ответ не нужен».
await page.goto(`${BASE}${annaHref}`, { waitUntil: "networkidle" });
await page.waitForSelector("[data-crm-timeline]");
note(`card items before: ${await page.locator("[data-crm-item]").count()}, awaiting banner: ${await page.locator("[data-crm-awaiting]").count()}`);
await shot("03-card-before");

await page.selectOption("[data-crm-owner]", { label: "Мария (продажи)" });
await page.waitForSelector("text=Ответственный назначен");
note("owner set: Мария (продажи)");

await page.click("text=Завтра 10:00");
await page.fill("[data-crm-next-note]", "Показать журнал бракеража в четверг");
await page.click("[data-crm-next-save]");
await page.waitForSelector("text=Следующий шаг назначен");
note("next step saved");

await page.click('[data-crm-composer-tab="note"]');
await page.fill("[data-crm-body]", "Анна — шеф бистро, решает сама.");
await page.click("[data-crm-send]");
await page.waitForSelector("text=Заметка сохранена");
note("note saved");

await page.click('[data-crm-composer-tab="email"]');
await page.fill("[data-crm-body]", "Анна, добрый день! В четверг в 11:00 покажу журнал бракеража. Подходит?");
await page.click("[data-crm-send]");
await page.waitForSelector("text=Письмо отправлено", { timeout: 60_000 });
note(`email sent toast: ${(await page.locator("[data-sonner-toast]").last().textContent())?.replace(/\s+/g, " ")}`);
await page.waitForTimeout(1500);
note(`card items after: ${await page.locator("[data-crm-item]").count()}, awaiting banner: ${await page.locator("[data-crm-awaiting]").count()}`);
await shot("04-card-after-actions");

// Ольга (показ): «Ответ не нужен».
await page.goto(`${BASE}/root/crm/contacts?q=${encodeURIComponent("Ольга")}`, { waitUntil: "networkidle" });
await page.locator("[data-crm-contact-row] a").first().click();
await page.waitForSelector("[data-crm-resolve]");
await page.click("[data-crm-resolve]");
await page.waitForSelector("text=Отмечено: ответ не нужен");
await page.waitForTimeout(1000);
note(`resolved → awaiting banner: ${await page.locator("[data-crm-awaiting]").count()}`);

// Стадия «В работе».
await page.click('[data-crm-stage="in_work"]');
await page.waitForSelector("text=Стадия: В работе");
note("stage → in_work");

// Лид вручную (WhatsApp).
await page.goto(`${BASE}/root/crm/contacts`, { waitUntil: "networkidle" });
await page.click("[data-crm-add-lead]");
await page.selectOption('[data-crm-lead-form] select[name="channel"]', "whatsapp");
await page.fill('[data-crm-lead-form] input[name="name"]', "Сергей");
await page.fill('[data-crm-lead-form] input[name="phone"]', "+7 916 222-33-44");
await page.fill('[data-crm-lead-form] input[name="company"]', "Столовая «Заря»");
await page.fill('[data-crm-lead-form] textarea[name="message"]', "Написал в WhatsApp: нужна автоматизация температурных журналов");
await shot("05-add-lead-dialog", false);
await page.click("text=Сохранить лид");
await page.waitForURL(/\/root\/crm\/contacts\/[a-z0-9]+$/, { timeout: 30_000 });
note(`manual lead → ${new URL(page.url()).pathname}, awaiting banner: ${await page.locator("[data-crm-awaiting]").count()}`);
await shot("06-manual-lead-card");

// Почта и фильтры.
await page.goto(`${BASE}/root/crm/mail`, { waitUntil: "networkidle" });
await page.fill("[data-crm-rule-pattern]", "promo-shop.ru");
await page.click("text=Добавить");
await page.waitForSelector("text=Адрес в стоп-листе");
await page.waitForTimeout(800);
note(`rules listed: ${await page.locator("[data-crm-rules] li").count()}`);
await page.click("[data-crm-mailbox-add]");
await page.waitForSelector("[data-crm-mailbox-form]");
await shot("07-mail-add-mailbox", false);
await page.click("text=Отмена");
await shot("08-mail-page");

// Команда: окно доступа с РОП.
await page.goto(`${BASE}/root/team`, { waitUntil: "networkidle" });
note(`ROP badges on team: ${await page.locator("[data-sales-head-badge]").count()}`);
const maria = page.locator("[data-team-member]").filter({ hasText: "Мария" });
await maria.locator("button", { hasText: /изменить|Изменить/ }).click();
await page.waitForSelector("[data-sales-head-toggle]");
await page.uncheck('[data-section="sales"]');
note(`sales unticked → ROP checked: ${await page.isChecked("[data-sales-head]")}`);
await page.check("[data-sales-head]");
note(`ROP ticked → sales re-checked: ${await page.isChecked('[data-section="sales"]')}`);
await shot("09-team-rop-dialog", false);
await page.click("text=Отмена");

// Телефон.
const phone = await browser.newContext({ ...devices["iPhone 13"], locale: "ru-RU" });
await phone.addCookies(await context.cookies());
const mobile = await phone.newPage();
mobile.on("pageerror", (error) => consoleErrors.push(`mobile :: pageerror ${error.message.slice(0, 300)}`));
for (const [name, path] of [
  ["10-summary-phone", "/root/crm"],
  ["11-contacts-phone", "/root/crm/contacts"],
  ["12-card-phone", annaHref],
]) {
  await mobile.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  note(`${name}: horizontal overflow ${overflow}px`);
  await mobile.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
}

note(`console errors: ${consoleErrors.length}`);
for (const error of consoleErrors) note(`  ${error}`);
writeFileSync(".agent/tasks/crm-rop-2026-11/raw/ui-check.txt", `${log.join("\n")}\n`);
await browser.close();
