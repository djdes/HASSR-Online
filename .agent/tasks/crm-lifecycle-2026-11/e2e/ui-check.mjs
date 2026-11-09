// Живая проверка воронки и задач CRM (next dev :3000, локальная БД после fixtures.ts + run.ts).
//   node .agent/tasks/crm-lifecycle-2026-11/e2e/ui-check.mjs
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = "http://localhost:3000";
const OUT = ".agent/tasks/crm-lifecycle-2026-11/raw/screens";
const SINK = process.env.SINK_LOG;
mkdirSync(OUT, { recursive: true });
const log = [];
const note = (line) => {
  log.push(line);
  console.log(line);
};
const sql = (query) => execFileSync("psql", ["-h", "127.0.0.1", "-p", "55432", "-U", "postgres", "wesetup", "-At", "-c", query], { encoding: "utf8" }).trim();
const sinkLines = () => (SINK ? readFileSync(SINK, "utf8").trim().split("\n") : []);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];

async function login(email, password, viewport = { width: 1600, height: 1000 }) {
  const context = await browser.newContext({ viewport, locale: "ru-RU" });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`${email} :: ${error.message.slice(0, 200)}`));
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[placeholder="name@company.com"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 90_000 });
  return page;
}

async function status(page, path) {
  const response = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  return response?.status();
}

const toastText = async (page) => (await page.locator("[data-sonner-toast]").last().innerText()).replace(/\s+/g, " ");

// ── Алексей (коммерческий директор, лимит 25 %) ──
const alexey = await login("alexey@wesetup.ru", "LocalUser-2026!");
await alexey.goto(`${BASE}/root/crm`, { waitUntil: "networkidle" });
note(`summary task tiles: ${(await alexey.locator("[data-crm-task-tiles]").innerText()).replace(/\s+/g, " ")}`);
await alexey.screenshot({ path: `${OUT}/01-summary.png`, fullPage: true });

await alexey.goto(`${BASE}/root/crm/funnel`, { waitUntil: "networkidle" });
for (const stage of ["registered", "contract_signed", "message_sent", "called", "won", "lost"]) {
  const names = await alexey.locator(`[data-funnel-column="${stage}"] [data-funnel-card]`).evaluateAll((els) => els.map((el) => el.getAttribute("data-funnel-card")));
  note(`funnel ${stage}: ${names.join(", ") || "—"}`);
}
await alexey.screenshot({ path: `${OUT}/02-funnel.png`, fullPage: true });

// Ручной перенос: «ИП Петров e2e» → «Был прозвон».
const petrov = alexey.locator('[data-funnel-card="ИП Петров e2e"]');
await petrov.locator("[data-funnel-move]").selectOption("called");
await alexey.waitForSelector("text=→ Был прозвон");
note(`move toast: ${await toastText(alexey)}`);
note(`db petrov deal: ${sql(`select stage || '|' || "stageManual" from "CrmDeal" where "organizationId"='lc-petrov' or "organizationId"='lc-solo'`)}`);

// Отказ с причиной: «Пекарня «Хлеб» e2e».
await alexey.locator('[data-funnel-card="Пекарня «Хлеб» e2e"] [data-funnel-move]').selectOption("lost");
await alexey.fill("[data-funnel-lost-reason]", "Не нужно сейчас, вернутся весной");
await alexey.locator('[role="dialog"] button', { hasText: "В отказ" }).click();
await alexey.waitForTimeout(1500);
note(`db pekarnya: ${sql(`select stage || '|' || coalesce("lostReason",'') from "CrmDeal" where "organizationId"='lc-pekarnya'`)}; open tasks: ${sql(`select count(*) from "CrmTask" where "organizationId"='lc-pekarnya' and status='open'`)}`);

// Задачи: закрыть задачу «Ромашки» с итогом «Дозвонился» и перезвоном.
await alexey.goto(`${BASE}/root/crm/tasks`, { waitUntil: "networkidle" });
note(`alexey tasks open: ${await alexey.locator("[data-crm-task]").count()}`);
await alexey.screenshot({ path: `${OUT}/03-tasks.png`, fullPage: true });
const romashkaTask = alexey.locator("[data-crm-task]").filter({ hasText: "Ромашка» e2e до" }).first();
await romashkaTask.locator("[data-task-complete]").click();
await alexey.click('[data-result="reached"]');
await alexey.fill('[data-task-complete-form] textarea', "Директор согласует счёт в среду");
await alexey.locator('[data-task-complete-form] button', { hasText: "через 2 дн." }).click();
await alexey.locator('[role="dialog"] button', { hasText: "Закрыть задачу" }).click();
await alexey.waitForSelector("text=Задача закрыта: Дозвонился");
note(`db romashka after call: deal ${sql(`select stage from "CrmDeal" where "organizationId"='lc-romashka'`)}, follow-up: ${sql(`select title from "CrmTask" where "organizationId"='lc-romashka' and scenario='manual'`)}`);

// Спец-КП «Ромашке» со скидкой 10 % — в пределах лимита, уходит сразу.
await alexey.goto(`${BASE}/root/crm/tasks`, { waitUntil: "networkidle" });
const followUp = alexey.locator("[data-crm-task]").filter({ hasText: "Перезвонить" }).first();
await followUp.locator("[data-crm-offer-open]").click();
await alexey.fill("[data-offer-discount]", "10");
await alexey.fill("[data-offer-email]", "owner@lc-romashka.ru");
await alexey.screenshot({ path: `${OUT}/04-offer-dialog.png` });
await alexey.locator('[role="dialog"] button', { hasText: "Отправить" }).click();
await alexey.waitForSelector("text=КП отправлено", { timeout: 60_000 });
note(`offer toast: ${await toastText(alexey)}`);
note(`db romashka promo: ${sql(`select code || '|' || value || '|' || coalesce("organizationId",'') from "PromoCode" where "organizationId"='lc-romashka'`)}`);
note(`db romashka deal: ${sql(`select stage || '|' || coalesce("offerJson"->'sent'->>'discountPercent','-') || '|' || coalesce("invoiceOrderId"::text,'-') from "CrmDeal" where "organizationId"='lc-romashka'`)}`);

// ── Мария (менеджер, охват «свои», лимит 10 %) ──
const maria = await login("sales@wesetup.local.test", "LocalUser-2026!");
await maria.goto(`${BASE}/root/crm/funnel`, { waitUntil: "networkidle" });
const mariaCards = await maria.locator("[data-funnel-card]").evaluateAll((els) => els.map((el) => el.getAttribute("data-funnel-card")));
note(`maria funnel cards: ${mariaCards.join(", ")}`);
note(`maria /root/crm/automation → ${await status(maria, "/root/crm/automation")}`);
const foreignDeal = sql(`select id from "CrmDeal" where "organizationId"='lc-romashka'`);
const foreignPatch = await maria.evaluate(async (id) => (await fetch(`/api/root/crm/deals/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage: "won" }) })).status, foreignDeal);
note(`maria PATCH foreign deal → ${foreignPatch}`);
await maria.goto(`${BASE}/root/crm/tasks`, { waitUntil: "networkidle" });
const stolovayaTask = maria.locator("[data-crm-task]").filter({ hasText: "Столовая комбината" }).first();
await stolovayaTask.locator("[data-crm-offer-open]").click();
note(`maria offer prefill discount: ${await maria.inputValue("[data-offer-discount]")}, tier: ${await maria.inputValue("[data-offer-tier]")}`);
await maria.fill("[data-offer-email]", "owner@lc-stolovaya.ru");
await maria.locator('[role="dialog"] button', { hasText: "Отправить" }).click();
await maria.waitForSelector("text=отправили на согласование", { timeout: 60_000 });
note(`maria offer toast: ${await toastText(maria)}`);
await maria.screenshot({ path: `${OUT}/05-maria-tasks.png`, fullPage: true });

// ── Алексей согласует 20 % вместо 25 % ──
await alexey.goto(`${BASE}/root/crm/tasks?kind=approval`, { waitUntil: "networkidle" });
const approval = alexey.locator('[data-crm-task="approval"]').first();
note(`approval task: ${(await approval.innerText()).split("\n")[0]}`);
await approval.locator("[data-approval-approve]").click();
await alexey.fill("[data-approval-percent]", "20");
await alexey.locator('[role="dialog"] button', { hasText: "Согласовать" }).click();
await alexey.waitForSelector("text=согласована");
note(`approve toast: ${await toastText(alexey)}`);

// ── Мария отправляет КП по согласованию ──
await maria.goto(`${BASE}/root/crm/tasks?kind=offer`, { waitUntil: "networkidle" });
const offerTask = maria.locator('[data-crm-task="offer"]').first();
note(`maria offer task: ${(await offerTask.innerText()).split("\n")[0]}`);
await offerTask.locator("[data-crm-offer-open]").click();
note(`maria approved prefill: ${await maria.inputValue("[data-offer-discount]")} / ${await maria.inputValue("[data-offer-email]")}`);
await maria.locator('[role="dialog"] button', { hasText: "Отправить" }).click();
await maria.waitForSelector("text=КП отправлено", { timeout: 60_000 });
note(`maria sent toast: ${await toastText(maria)}`);
note(`db stolovaya: ${sql(`select stage || '|' || coalesce("offerJson"->'sent'->>'discountPercent','-') || '|' || "amountRub" from "CrmDeal" where "organizationId"='lc-stolovaya'`)}; promo ${sql(`select code || ' ' || value || '%' from "PromoCode" where "organizationId"='lc-stolovaya'`)}`);

// ── Владелец: автоворонка и прогноз ──
const owner = await login("owner@wesetup.local.test", "LocalRoot-2026!");
await owner.goto(`${BASE}/root/crm/automation`, { waitUntil: "networkidle" });
note(`forecast items: messages ${await owner.locator('[data-forecast-item="message"]').count()}, tasks ${await owner.locator('[data-forecast-item="task"]').count()}`);
await owner.screenshot({ path: `${OUT}/06-automation.png`, fullPage: true });
await owner.click("[data-automation-save]");
await owner.waitForSelector("text=Настройки автоворонки сохранены");
note(`settings saved: ${sql(`select value from "PlatformSetting" where key='crm:lifecycle'`).slice(0, 120)}…`);

// Карточка контакта «Ромашки» — панель сделки и лента.
const romashkaContact = sql(`select "contactId" from "CrmDeal" where "organizationId"='lc-romashka'`);
await owner.goto(`${BASE}/root/crm/contacts/${romashkaContact}`, { waitUntil: "networkidle" });
note(`contact pipeline: ${(await owner.locator("[data-crm-pipeline]").innerText()).replace(/\s+/g, " ").slice(0, 260)}`);
await owner.screenshot({ path: `${OUT}/07-contact-pipeline.png`, fullPage: true });

// Роли: лимит скидки в редакторе.
await owner.goto(`${BASE}/root/team`, { waitUntil: "networkidle" });
note(`role discount badges: ${await owner.locator("[data-role-discount]").allInnerTexts()}`);

// Телефон: воронка листается по горизонтали, страница — нет.
const phone = await login("alexey@wesetup.ru", "LocalUser-2026!", { width: 390, height: 844 });
await phone.goto(`${BASE}/root/crm/funnel`, { waitUntil: "networkidle" });
const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
note(`phone page horizontal overflow: ${overflow}px`);
await phone.screenshot({ path: `${OUT}/08-phone-funnel.png` });
await phone.goto(`${BASE}/root/crm/tasks`, { waitUntil: "networkidle" });
note(`phone tasks overflow: ${await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)}px`);
await phone.screenshot({ path: `${OUT}/09-phone-tasks.png`, fullPage: true });

note(`sink: ${sinkLines().filter((line) => /КП|Коммерческое|предложение/i.test(line) || /Счёт/.test(line)).slice(-4).join("\n      ")}`);
note(`page errors: ${errors.length}`);
for (const error of errors) note(`  ${error}`);
writeFileSync(".agent/tasks/crm-lifecycle-2026-11/raw/ui-check.txt", `${log.join("\n")}\n`);
await browser.close();
