// Живая проверка экранов CRM v2 (next dev :3000, локальная БД после fixtures.ts + run.ts + scenarios.ts).
//   node .agent/tasks/crm-funnel-v2-2026-11/e2e/ui-check.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = "http://localhost:3000";
const OUT = ".agent/tasks/crm-funnel-v2-2026-11/raw/screens";
mkdirSync(OUT, { recursive: true });
const log = [];
const note = (line) => {
  log.push(line);
  console.log(line);
};
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];

async function login(email, password, viewport = { width: 1440, height: 950 }) {
  const context = await browser.newContext({ viewport, locale: "ru-RU", deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`${email} :: ${error.message.slice(0, 200)}`));
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[placeholder="name@company.com"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 120_000 });
  return page;
}
const go = async (page, path) => (await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 180_000 }))?.status();
const shot = (page, name, fullPage = true) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// ── Алексей: коммерческий директор, охват «все» ──
const alexey = await login("alexey@wesetup.ru", "LocalUser-2026!");
note(`summary: ${await go(alexey, "/root/crm")}`);
note(`summary sales tiles: ${await alexey.locator("[data-crm-sales-tiles] a").count()}`);
await shot(alexey, "01-summary");

note(`tasks: ${await go(alexey, "/root/crm/tasks")}`);
note(`tasks cards: ${await alexey.locator("[data-crm-task]").count()}, call buttons: ${await alexey.locator("[data-crm-call]").count()}, mail buttons: ${await alexey.locator("[data-crm-mail]").count()}, offer buttons: ${await alexey.locator("[data-crm-offer-open]").count()}`);
note(`raw links in task text: ${await alexey.locator("[data-crm-task] p", { hasText: "http" }).count()}`);
await shot(alexey, "02-tasks-desktop");

// Закрыть звонок с итогом и следующим шагом через диалог.
const romashka = alexey.locator("[data-crm-task='call']", { hasText: "Ромашка" }).first();
await romashka.locator("[data-crm-task-done]").click();
await alexey.locator("[data-crm-outcome='promised']").click();
await alexey.fill("textarea[name='result']", "Директор согласует в пятницу");
note(`follow-up suggested: ${await alexey.locator("[data-crm-next-step]").isChecked()}`);
await shot(alexey, "03-task-outcome-dialog", false);
await alexey.getByRole("button", { name: "Закрыть задачу" }).first().click();
await alexey.locator("[data-sonner-toast]").first().waitFor({ timeout: 30_000 });
note(`close toast: ${(await alexey.locator("[data-sonner-toast]").first().innerText()).replace(/\s+/g, " ")}`);
await go(alexey, "/root/crm/tasks");
note(`follow-up task visible: ${await alexey.locator("[data-crm-task]", { hasText: "Перезвонить: Кафе «Ромашка»" }).count()}`);

// Согласование: решение с процентом.
const approval = alexey.locator("[data-crm-task='approve_discount']").first();
note(`approvals pending: ${await alexey.locator("[data-crm-task='approve_discount']").count()}`);

// Фильтры.
note(`filter unassigned: ${await go(alexey, "/root/crm/tasks?who=unassigned")}, cards ${await alexey.locator("[data-crm-task]").count()}`);
note(`filter kind=last_chance: ${await go(alexey, "/root/crm/tasks?kind=last_chance")}, cards ${await alexey.locator("[data-crm-task]").count()}`);

// КП со скидкой из задачи «Последний шанс».
await go(alexey, "/root/crm/tasks?kind=last_chance");
await alexey.locator("[data-crm-offer-open]").first().click();
await alexey.locator("[data-crm-offer-form]").waitFor();
note(`offer price line: ${(await alexey.locator("[data-crm-offer-price]").innerText()).replace(/\s+/g, " ")}`);
await shot(alexey, "04-offer-dialog", false);
await alexey.keyboard.press("Escape");

note(`funnel: ${await go(alexey, "/root/crm/funnel")}`);
const columns = await alexey.locator("[data-funnel-column]").evaluateAll((nodes) => nodes.map((node) => `${node.getAttribute("data-funnel-column")}=${node.querySelectorAll("[data-funnel-card]").length}`));
note(`funnel columns: ${columns.join(", ")}`);
await shot(alexey, "05-funnel-desktop");
// Перенос через список: «Пекарня» → «Был прозвон».
await alexey.locator("[data-funnel-card='Пекарня «Хлеб» e2e'] [data-funnel-move]").selectOption("called");
await alexey.waitForTimeout(1500);
await go(alexey, "/root/crm/funnel");
note(`pekarnya column after move: ${await alexey.locator("[data-funnel-column='called'] [data-funnel-card='Пекарня «Хлеб» e2e']").count()}`);

note(`automation: ${await go(alexey, "/root/crm/automation")}`);
note(`forecast items: ${await alexey.locator("[data-forecast-item]").count()}`);
await shot(alexey, "06-automation");

// ── Владелец: роли с лимитом скидки ──
const owner = await login("owner@wesetup.local.test", "LocalRoot-2026!");
note(`team: ${await go(owner, "/root/team")}`);
note(`role discount badges: ${await owner.locator("[data-role-discount-badge]").count()}`);
await shot(owner, "07-team-roles");

// ── Мария: менеджер, охват «свои» ──
const maria = await login("sales@wesetup.local.test", "LocalUser-2026!");
note(`manager tasks: ${await go(maria, "/root/crm/tasks")}, cards ${await maria.locator("[data-crm-task]").count()}`);
await shot(maria, "08-manager-tasks");
note(`manager funnel: ${await go(maria, "/root/crm/funnel")}, cards ${await maria.locator("[data-funnel-card]").count()}`);
note(`manager automation (expect 404): ${await go(maria, "/root/crm/automation")}`);

// ── Телефон 390 px ──
const phone = await login("alexey@wesetup.ru", "LocalUser-2026!", { width: 390, height: 844 });
await go(phone, "/root/crm/tasks");
note(`phone tasks overflowX: ${await overflowX(phone)}`);
const card = phone.locator("[data-crm-task]").first();
const box = await card.boundingBox();
const actions = await card.locator("[data-crm-task-actions]").boundingBox();
note(`phone first card height: ${Math.round(box?.height ?? 0)}px, actions below text: ${actions && box ? actions.y > box.y + 40 : false}`);
await shot(phone, "09-phone-tasks", false);
await card.scrollIntoViewIfNeeded();
await card.screenshot({ path: `${OUT}/09b-phone-task-card.png` });
await go(phone, "/root/crm/funnel");
note(`phone funnel overflowX: ${await overflowX(phone)}`);
await shot(phone, "10-phone-funnel", false);
await go(phone, "/root/crm");
note(`phone summary overflowX: ${await overflowX(phone)}`);

note(`page errors: ${errors.length}${errors.length ? ` — ${errors.join(" | ")}` : ""}`);
writeFileSync(".agent/tasks/crm-funnel-v2-2026-11/raw/ui-check.txt", `${log.join("\n")}\n`);
await browser.close();
