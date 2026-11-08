// Живая проверка ролей панели (next dev :3000, локальная БД, данные — e2e CRM).
//   node .agent/tasks/platform-roles-2026-11/e2e/ui-check.mjs
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = "http://localhost:3000";
const OUT = ".agent/tasks/platform-roles-2026-11/raw/screens";
mkdirSync(OUT, { recursive: true });
const log = [];
const note = (line) => {
  log.push(line);
  console.log(line);
};
const sql = (query) => execFileSync("psql", ["-h", "127.0.0.1", "-p", "55432", "-U", "postgres", "wesetup", "-At", "-c", query], { encoding: "utf8" }).trim();

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];

async function login(email, password) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ru-RU" });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`${email} :: ${error.message.slice(0, 200)}`));
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[placeholder="name@company.com"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 });
  return page;
}

async function status(page, path) {
  const response = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  return response?.status();
}

// ── Владелец: роли, роль менеджеру, закрепление клиента ──
const owner = await login("owner@wesetup.local.test", "LocalRoot-2026!");
await owner.goto(`${BASE}/root/team`, { waitUntil: "networkidle" });
note(`roles listed: ${await owner.locator("[data-role-row]").count()}`);
note(`alexey row: ${(await owner.locator("[data-team-member]").filter({ hasText: "Алексей" }).innerText()).replace(/\s+/g, " ").slice(0, 160)}`);
await owner.screenshot({ path: `${OUT}/01-team-roles.png`, fullPage: true });

// Новая роль → удалить (CRUD).
await owner.click("[data-role-add]");
await owner.fill("[data-role-title]", "Аккаунт-менеджер");
await owner.click('[data-role-scope="own"]');
await owner.screenshot({ path: `${OUT}/02-role-form.png` });
await owner.click("text=Сохранить доступ");
await owner.waitForSelector("text=Роль сохранена");
note(`after create: ${await owner.locator("[data-role-row]").count()} roles`);
const created = owner.locator("[data-role-row]").filter({ hasText: "Аккаунт-менеджер" });
await created.locator('button[aria-label="Удалить роль"]').click();
await owner.locator('[role="dialog"] button', { hasText: "Удалить роль" }).click();
await owner.waitForSelector("text=Роль удалена");
note(`after delete: ${await owner.locator("[data-role-row]").count()} roles`);

// Мария → «Менеджер по продажам».
const maria = owner.locator("[data-team-member]").filter({ hasText: "Мария" });
await maria.locator("button", { hasText: /Изменить/ }).click();
await owner.click('[data-role="sales_manager"]');
await owner.waitForTimeout(300);
await owner.screenshot({ path: `${OUT}/03-access-dialog-role.png` });
await owner.click("text=Сохранить доступ");
await owner.waitForSelector("text=Доступ сохранён");
await owner.waitForTimeout(500);
note(`maria row: ${(await maria.innerText()).replace(/\s+/g, " ").slice(0, 160)}`);
note(`db maria: ${sql(`select r.title || '|' || array_to_string(u."platformSections", ',') || '|' || u."platformSalesHead" from "User" u join "PlatformRole" r on r.id=u."platformRoleId" where u.email='sales@wesetup.local.test'`)}`);

// Подпись и РОП владельцу.
await owner.click("[data-owner-settings]");
await owner.fill("[data-owner-title]", "Генеральный директор");
await owner.click("text=Сохранить доступ");
await owner.waitForSelector("text=Доступ сохранён");
note(`db owner: ${sql(`select coalesce("platformTitle",'-') || '|' || "platformSalesHead" from "User" where email='owner@wesetup.local.test'`)}`);

// Закрепить «Кафе «Ромашка»» за Марией.
await owner.goto(`${BASE}/root/organizations/fixture-cafe`, { waitUntil: "networkidle" });
const mariaId = sql(`select id from "User" where email='sales@wesetup.local.test'`);
await owner.selectOption("[data-account-manager-select]", mariaId);
await owner.waitForSelector("text=Клиент закреплён за менеджером");
note(`toast: ${(await owner.locator("[data-sonner-toast]").last().innerText()).replace(/\s+/g, " ")}`);
await owner.screenshot({ path: `${OUT}/04-client-manager.png` });
note(`db cafe manager: ${sql(`select coalesce("accountManagerId",'-') = '${mariaId}' from "Organization" where id='fixture-cafe'`)}, Иван owner → ${sql(`select coalesce(u.email,'-') from "CrmContact" c left join "User" u on u.id=c."ownerId" where c.name='Иван Петров'`)}`);

// ── Менеджер: свои клиенты и лиды ──
const manager = await login("sales@wesetup.local.test", "LocalUser-2026!");
await manager.goto(`${BASE}/root`, { waitUntil: "networkidle" });
note(`manager clients list: ${(await manager.locator("table tbody tr, [data-client-row]").count())} rows; has Ромашка: ${(await manager.content()).includes("Ромашка")}; has Кофейня владельца: ${(await manager.content()).includes("Кофейня владельца")}`);
await manager.screenshot({ path: `${OUT}/05-manager-clients.png`, fullPage: true });
note(`manager /root/organizations/fixture-cafe → ${await status(manager, "/root/organizations/fixture-cafe")}`);
note(`manager /root/organizations/fixture-bfs-inn → ${await status(manager, "/root/organizations/fixture-bfs-inn")}`);
note(`manager /root/crm/mail → ${await status(manager, "/root/crm/mail")}`);
note(`manager /root/health → ${await status(manager, "/root/health")}`);
const sergey = sql(`select id from "CrmContact" where name='Сергей'`);
note(`manager foreign lead /root/crm/contacts/${sergey} → ${await status(manager, `/root/crm/contacts/${sergey}`)}`);
const apiStatus = await manager.evaluate(async (id) => (await fetch(`/api/root/crm/contacts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage: "lost" }) })).status, sergey);
note(`manager PATCH foreign lead → ${apiStatus}`);
await manager.goto(`${BASE}/root/crm/contacts`, { waitUntil: "networkidle" });
const names = await manager.locator("[data-crm-contact-row]").allInnerTexts();
note(`manager CRM rows: ${names.map((text) => text.split("\n")[0]).join(", ")}`);
await manager.screenshot({ path: `${OUT}/06-manager-crm.png`, fullPage: true });
const dmitry = sql(`select id from "CrmContact" where name='Дмитрий'`);
await manager.goto(`${BASE}/root/crm/contacts/${dmitry}`, { waitUntil: "networkidle" });
await manager.click("[data-crm-take]");
await manager.waitForSelector("text=Клиент закреплён за вами");
note(`take free lead → Дмитрий owner: ${sql(`select coalesce(u.email,'-') from "CrmContact" c left join "User" u on u.id=c."ownerId" where c.name='Дмитрий'`)}`);
const reassign = await manager.evaluate(async ({ id, to }) => (await fetch(`/api/root/crm/contacts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ownerId: to }) })).status, { id: dmitry, to: sql(`select id from "User" where email='alexey@wesetup.ru'`) });
note(`manager reassign to someone else → ${reassign}`);
const managerAssign = await manager.evaluate(async (to) => (await fetch(`/api/root/organizations/fixture-cafe/manager`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ managerId: to }) })).status, mariaId);
note(`manager PUT client manager → ${managerAssign}`);
await manager.screenshot({ path: `${OUT}/07-manager-took-lead.png`, fullPage: true });

// ── Коммерческий директор: подпись КП ──
const director = await login("alexey@wesetup.ru", "LocalUser-2026!");
await director.goto(`${BASE}/root/proposals`, { waitUntil: "networkidle" });
note(`director КП sender: ${await director.inputValue('[data-testid="kp-sender-name"]')} / ${await director.inputValue('[data-testid="kp-sender-position"]')}`);
await director.waitForTimeout(2500);
const previewHasTitle = await director.evaluate(() =>
  [document.body.innerText, ...[...document.querySelectorAll("iframe")].map((frame) => frame.getAttribute("srcdoc") ?? frame.contentDocument?.body?.innerText ?? "")].join("\n").includes("Коммерческий директор"),
);
note(`director КП preview mentions «Коммерческий директор»: ${previewHasTitle}`);
await director.screenshot({ path: `${OUT}/08-director-proposal.png`, fullPage: true });
note(`director /root/crm/mail → ${await status(director, "/root/crm/mail")}`);

note(`page errors: ${errors.length}`);
for (const error of errors) note(`  ${error}`);
writeFileSync(".agent/tasks/platform-roles-2026-11/raw/ui-check.txt", `${log.join("\n")}\n`);
await browser.close();
