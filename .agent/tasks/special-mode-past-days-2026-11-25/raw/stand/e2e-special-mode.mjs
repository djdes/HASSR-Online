// Спецрежим в «Пришла проверка» и в «Информации об организации»; «Правка прошлых дней» (стенд next start :3000).
// Запуск: node run.mjs <каталог снимков> <setup.json>
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("/opt/node-tools/node_modules/playwright");

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? "out-sm";
const SETUP = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const errors = [];

async function login(context, email, password) {
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`${email}: ${error.message}`));
  await page.goto(`${BASE}/login`, { waitUntil: "load" });
  await page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled, null, { timeout: 30000 });
  await page.fill("#email", email);
  await page.fill("#password", password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 }), page.click('button[type="submit"]')]);
  return page;
}
async function open(page, url) {
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle", timeout: 120000 });
  const legal = page.locator('[data-testid="legal-update-modal"]');
  if (await legal.count()) {
    await legal.locator('input[type="checkbox"], [role="checkbox"]').first().click();
    await page.click('[data-testid="legal-update-accept"]');
    await legal.waitFor({ state: "detached", timeout: 30000 });
  }
}
const dayKey = (offset) => {
  const date = new Date();
  // «Сегодня» организации — Москва (UTC+3).
  const msk = new Date(date.getTime() + 3 * 3600 * 1000);
  msk.setUTCDate(msk.getUTCDate() + offset);
  return msk.toISOString().slice(0, 10);
};

const browser = await chromium.launch();
const ownerContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
const owner = await login(ownerContext, "admin@haccp.local", "admin1234");
const ownerApi = ownerContext.request;

// Исходное состояние спецрежима — вернём его в конце.
const initial = await (await ownerApi.get(`${BASE}/api/settings/journal-controls`)).json();
check("стенд: настройка спецрежима читается", initial?.automation && typeof initial.automation.enabled === "boolean", JSON.stringify(initial.automation));
// Чистый старт — как у новой организации: спецрежим выключен, ни одной галочки.
const NEW_ORG = { enabled: false, autoFill: false, autoCreate: false, copyYesterday: false, closeDayAutofill: false, catchUp: false, pastDays: false, pastDaysLimit: 7 };
await ownerApi.patch(`${BASE}/api/settings/journal-controls`, { data: { automation: NEW_ORG } });

// Свой объект для сценария: документ журнала заводится на объекте.
const pointName = `Кафе e2e спецрежим ${new Date().toISOString().slice(11, 19)}`;
const pointRes = await ownerApi.post(`${BASE}/api/settings/buildings`, { data: { name: pointName, sphere: "food" } });
const point = (await pointRes.json().catch(() => ({}))).building;
check(`стенд: объект «${pointName}»`, pointRes.ok() && point?.id, String(pointRes.status()));
await ownerApi.post(`${BASE}/api/me/active-building`, { data: { buildingId: point.id } });

// Документ гигиены на текущий месяц (без автозаполнения) — свой для сценария.
const today = dayKey(0);
const monthStart = `${today.slice(0, 8)}01`;
const monthEnd = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10);
const created = await ownerApi.post(`${BASE}/api/journal-documents`, {
  data: { templateCode: "hygiene", title: `Гигиена e2e спецрежим ${today}`, dateFrom: monthStart, dateTo: monthEnd },
});
const doc = (await created.json().catch(() => ({}))).document;
check("стенд: документ гигиены на месяц", created.ok() && doc?.id, `${created.status()} ${monthStart}..${monthEnd}`);
// Сетка сотрудника — журнал холодильников (дни × оборудование, подсказка в title закрытого дня).
const coldCreated = await ownerApi.post(`${BASE}/api/journal-documents`, {
  data: { templateCode: "cold_equipment_control", title: `Холодильники e2e спецрежим ${today}`, dateFrom: monthStart, dateTo: monthEnd },
});
const coldDoc = (await coldCreated.json().catch(() => ({}))).document;
check("стенд: документ холодильников на месяц", coldCreated.ok() && coldDoc?.id, String(coldCreated.status()));

// ---------- AC1: «Пришла проверка» ----------
await open(owner, "/inspection");
const menuLink = owner.locator('a[href="/inspection/settings"]').filter({ hasText: "Спецрежим" });
check("AC1 меню раздела: пункт «Спецрежим» у руководителя", (await menuLink.count()) >= 1);
const inspectionCard = owner.locator("[data-inspection-special-mode]");
check("AC1 «К вам пришла проверка»: карточка спецрежима у руководителя", (await inspectionCard.count()) === 1);
check("AC1 карточка: переключатель доступен", await inspectionCard.locator('button[role="switch"]').isEnabled());
check("AC1 тихой ссылки у руководителя нет — вместо неё карточка", (await owner.locator("[data-inspection-settings-link]").count()) === 0);
await owner.screenshot({ path: `${OUT}/01-inspection-card.png`, fullPage: false });
await open(owner, "/inspection/settings");
const heading = (await owner.locator("h1").first().innerText().catch(() => "")).trim();
check("AC1 страница спецрежима: заголовок «Спецрежим»", /Спецрежим/.test(heading), heading);

// ---------- AC1: «проверка задач» без admin.full — как было: тихая ссылка, страница для просмотра ----------
const verifyContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
const verifyPage = await login(verifyContext, SETUP.verifyEmail, SETUP.verifyPassword);
await open(verifyPage, "/inspection");
check("AC1 «проверка задач»: карточки нет, тихая ссылка есть",
  (await verifyPage.locator("[data-inspection-special-mode]").count()) === 0 && (await verifyPage.locator("[data-inspection-settings-link]").count()) === 1);
check("AC1 «проверка задач»: пункта меню «Спецрежим» нет", (await verifyPage.locator('a[href="/inspection/settings"]').filter({ hasText: "Спецрежим" }).count()) === 0);
await verifyPage.click("[data-inspection-settings-link]");
await verifyPage.waitForURL((u) => u.pathname === "/inspection/settings", { timeout: 60000 });
await verifyPage.waitForLoadState("networkidle");
await verifyPage.locator("[data-inspection-special-mode]").first().waitFor({ timeout: 30000 }).catch(() => {});
const verifyCard = verifyPage.locator("[data-inspection-special-mode]");
check("AC1 «проверка задач»: страница открывается, не «Нет доступа»", (await verifyPage.locator("[data-access-denied]").count()) === 0 && (await verifyCard.count()) === 1);
check("AC1 «проверка задач»: спецрежим только для просмотра", (await verifyCard.locator('button[role="switch"]').count()) === 1 && !(await verifyCard.locator('button[role="switch"]').isEnabled()));
await verifyPage.screenshot({ path: `${OUT}/06-verify-user-settings.png` });
await verifyContext.close();

// ---------- Сотрудник до включения ----------
const cookContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
await login(cookContext, SETUP.email, SETUP.password);
const cookApi = cookContext.request;
const put = (date, employeeId = SETUP.cookId) =>
  cookApi.put(`${BASE}/api/journal-documents/${doc.id}/entries`, { data: { employeeId, date, data: { status: "day_off", temperatureAbove37: null } } });
const yesterday = dayKey(-1);
const weekAgo = dayKey(-7);
const eightDaysAgo = dayKey(-8);
const tomorrow = dayKey(1);
// Перенос строки по entryId: клетка-источник проходит те же правила (иначе сотрудник забирал чужую запись к себе).
const entryOf = async (res) => (await res.json().catch(() => ({}))).entry?.id;
const move = (entryId, date, employeeId = SETUP.cookId) =>
  cookApi.put(`${BASE}/api/journal-documents/${doc.id}/entries`, { data: { entryId, employeeId, date, data: { status: "day_off", temperatureAbove37: null } } });
let response = await ownerApi.put(`${BASE}/api/journal-documents/${doc.id}/entries`, { data: { employeeId: SETUP.adminId, date: dayKey(-3), data: { status: "day_off", temperatureAbove37: null } } });
const ownerEntryId = await entryOf(response);
check("стенд: запись руководителя 3 дня назад", response.ok() && ownerEntryId, String(response.status()));
response = await move(ownerEntryId, today);
let body = await response.json().catch(() => ({}));
check("перенос: чужую запись прошлого дня к себе на сегодня — отказ", response.status() === 403 && body.code === "foreign_row", `${response.status()} ${body.code ?? ""}`);
// Метка со смещением пишется на день раньше — проверяется этот день.
response = await put(`${today}T00:00:00+14:00`);
body = await response.json().catch(() => ({}));
check("дата со смещением «сегодня+14:00» (пишется вчерашним днём) без спецрежима — отказ", response.status() === 403 && body.code === "not_today", `${response.status()} ${body.code ?? ""}`);

response = await put(today);
check("AC4 сотрудник: сегодня — можно (как всегда)", response.ok(), String(response.status()));
response = await put(yesterday);
body = await response.json().catch(() => ({}));
check("AC4 без спецрежима: вчера — отказ «только сегодня»", response.status() === 403 && body.code === "not_today", `${response.status()} ${body.error ?? ""}`);

// Сетка сотрудника до включения: все прошлые дни закрыты подсказкой «только сегодня».
const notTodayTitle = "Заполнять можно только сегодняшний день. За прошлые дни правки вносит ответственный за журнал.";
const cookPage = await cookContext.newPage();
cookPage.on("pageerror", (error) => errors.push(`cook: ${error.message}`));
await cookApi.post(`${BASE}/api/me/active-building`, { data: { buildingId: point.id } });
const gridCounts = async () => {
  await cookPage.goto(`${BASE}/journals/cold_equipment_control/documents/${coldDoc.id}`, { waitUntil: "load", timeout: 120000 });
  await cookPage.waitForTimeout(3000);
  return cookPage.evaluate((title) => ({
    notToday: document.querySelectorAll(`[title="${title}"]`).length,
    window: document.querySelectorAll('[title^="Прошлые записи можно менять"]').length,
  }), notTodayTitle);
};
const gridBefore = await gridCounts();
check("AC4 сетка без спецрежима: прошлые дни сотруднику закрыты", gridBefore.notToday > 0 && gridBefore.window === 0, JSON.stringify(gridBefore));

// ---------- AC2/AC3: включить в «Информации об организации» ----------
await open(owner, "/settings/organization");
const orgCard = owner.locator("[data-inspection-special-mode]");
check("AC2 «Информация об организации»: карточка спецрежима", (await orgCard.count()) === 1);
await orgCard.locator('button[role="switch"]').click();
const dialog = owner.locator("[data-special-mode-dialog]");
await dialog.waitFor({ timeout: 15000 });
const pastOption = dialog.locator('[data-special-mode-option="pastDays"]');
check("AC3 окно: галочка «Правка прошлых дней»", (await pastOption.count()) === 1);
const tickedFirst = await dialog.locator("[data-special-mode-option]").evaluateAll((nodes) => nodes.map((node) => `${node.getAttribute("data-special-mode-option")}=${node.getAttribute("data-state")}`));
check("AC3 окно впервые: автоматика отмечена, «Правка прошлых дней» — нет (только руками)",
  (await pastOption.getAttribute("data-state")) !== "checked" && tickedFirst.filter((item) => item.endsWith("=checked")).length === tickedFirst.length - 1,
  tickedFirst.join(", "));
await owner.screenshot({ path: `${OUT}/02a-dialog-first-open.png` });
if ((await pastOption.getAttribute("data-state")) !== "checked") await pastOption.click();
const limitSelect = dialog.locator("[data-special-mode-past-days-limit]");
check("AC3 окно: «Насколько назад» — 6 вариантов, по умолчанию 7 дней", (await limitSelect.locator("option").count()) === 6 && (await limitSelect.inputValue()) === "7", await limitSelect.inputValue());
await limitSelect.selectOption("7");
await owner.screenshot({ path: `${OUT}/02-dialog-past-days.png` });
await dialog.locator("[data-special-mode-confirm]").click();
await dialog.waitFor({ state: "detached", timeout: 15000 });
await owner.waitForTimeout(800);
const chips = await orgCard.locator("[data-special-mode-visible]").innerText();
check("AC3 карточка: «Правка прошлых дней: 7 дней»", /Правка прошлых дней: 7 дней/.test(chips), chips.replace(/\s+/g, " ").slice(0, 200));
const saved = await (await ownerApi.get(`${BASE}/api/settings/journal-controls`)).json();
check("AC3 настройка сохранена", saved.automation.enabled && saved.automation.pastDays === true && saved.automation.pastDaysLimit === 7, JSON.stringify(saved.automation));
await owner.reload({ waitUntil: "networkidle" });
const hint = await owner.locator("text=Спецрежим разрешает правку прошлых дней").first().innerText().catch(() => "");
check("AC5 подсказка у «Запретить редактирование…»", /за последние 7 дней/.test(hint), hint.slice(0, 160));
await owner.screenshot({ path: `${OUT}/03-organization-card.png`, fullPage: true });

// Та же настройка видна в «Пришла проверка».
await open(owner, "/inspection");
const inspectionChips = await owner.locator("[data-inspection-special-mode] [data-special-mode-visible]").innerText();
check("AC2 включено в «Информации об организации» — видно в «Пришла проверка»", /Правка прошлых дней: 7 дней/.test(inspectionChips));

// ---------- AC4: сотрудник при включённой галочке ----------
response = await put(yesterday);
const yesterdayEntryId = await entryOf(response);
check("AC4 спецрежим: вчера своя строка — можно", response.ok() && yesterdayEntryId, String(response.status()));
response = await put(weekAgo);
check("AC4 спецрежим: 7 дней назад — можно (граница окна)", response.ok(), String(response.status()));
response = await put(eightDaysAgo);
body = await response.json().catch(() => ({}));
check("AC4 спецрежим: 8 дней назад — отказ за пределами окна", response.status() === 403 && /последние 7 дней/.test(body.error ?? ""), `${response.status()} ${body.error ?? ""}`);
response = await put(tomorrow);
body = await response.json().catch(() => ({}));
check("AC4 спецрежим: завтра — отказ", response.status() === 403, `${response.status()} ${body.error ?? ""}`);
response = await put(yesterday, SETUP.adminId);
body = await response.json().catch(() => ({}));
check("AC4 спецрежим: чужая строка — отказ", response.status() === 403 && body.code === "foreign_row", `${response.status()} ${body.code ?? ""}`);
response = await put(`${dayKey(-6)}T00:00:00+14:00`);
check("дата со смещением: «6 дней назад+14:00» (пишется 7 днями назад) — можно", response.ok(), String(response.status()));
response = await put(`${weekAgo}T00:00:00+14:00`);
body = await response.json().catch(() => ({}));
check("дата со смещением: «7 дней назад+14:00» (пишется 8 днями назад) — отказ за окном", response.status() === 403 && /последние 7 дней/.test(body.error ?? ""), `${response.status()} ${body.error ?? ""}`);
// Документ гигиены заводит заглушку на каждую клетку «сотрудник × день» — переносить некуда (409 «клетка занята»,
// как и раньше). Руководитель освобождает клетку позавчера, сотрудник переносит туда свою вчерашнюю запись.
response = await ownerApi.delete(`${BASE}/api/journal-documents/${doc.id}/entries`, { data: { employeeId: SETUP.cookId, date: dayKey(-2) } });
check("стенд: руководитель освободил клетку повара позавчера", response.ok(), String(response.status()));
response = await move(yesterdayEntryId, dayKey(-2));
body = await response.json().catch(() => ({}));
check("перенос в окне: своя вчерашняя запись на позавчера — можно",
  response.ok() && body.entry?.id === yesterdayEntryId && String(body.entry?.date ?? "").startsWith(dayKey(-2)),
  `${response.status()} ${body.entry?.date ?? body.code ?? ""}`);
response = await ownerApi.put(`${BASE}/api/journal-documents/${doc.id}/entries`, { data: { employeeId: SETUP.cookId, date: dayKey(-9), data: { status: "day_off", temperatureAbove37: null } } });
const oldCookEntryId = await entryOf(response);
check("стенд: руководитель записал строку повара 9 дней назад", response.ok() && oldCookEntryId, String(response.status()));
response = await move(oldCookEntryId, dayKey(-3));
body = await response.json().catch(() => ({}));
check("перенос: запись из-за окна (9 дней назад) в окно — отказ", response.status() === 403 && /последние 7 дней/.test(body.error ?? ""), `${response.status()} ${body.error ?? ""}`);

// Сетка сотрудника при включённой галочке: 7 последних дней открыты, раньше — подсказка про окно, будущее — закрыто.
const gridAfter = await gridCounts();
const daysInWindow = 7;
check("AC4 сетка: дни в окне открыты, раньше — «за последние 7 дней», будущее — закрыто",
  gridAfter.window > 0 && gridAfter.notToday < gridBefore.notToday && gridBefore.notToday - gridAfter.notToday - gridAfter.window === daysInWindow * (gridBefore.notToday / (Number(today.slice(8, 10)) - 1 + (Number(monthEnd.slice(8, 10)) - Number(today.slice(8, 10))))),
  JSON.stringify({ before: gridBefore, after: gridAfter }));
await cookPage.screenshot({ path: `${OUT}/04-cook-grid.png` });

// ---------- Выключили — снова как раньше ----------
await ownerApi.patch(`${BASE}/api/settings/journal-controls`, { data: { automation: { ...saved.automation, enabled: false } } });
response = await put(dayKey(-2));
body = await response.json().catch(() => ({}));
check("AC4 спецрежим выключен — вчерашние дни снова закрыты", response.status() === 403 && body.code === "not_today", `${response.status()}`);

// Телефон: окно спецрежима без горизонтальной прокрутки.
const phone = await browser.newContext({ ...devices["iPhone 13"], locale: "ru-RU" });
await phone.addCookies(await ownerContext.cookies());
const mp = await phone.newPage();
mp.on("pageerror", (error) => errors.push(`phone: ${error.message}`));
await open(mp, "/settings/organization");
await mp.locator("[data-inspection-special-mode] button[role=\"switch\"]").click();
await mp.locator("[data-special-mode-dialog]").waitFor({ timeout: 15000 });
const w = await mp.evaluate(() => ({ docW: document.documentElement.scrollWidth, vw: window.innerWidth }));
check("телефон: окно спецрежима без горизонтальной прокрутки", w.docW <= w.vw, JSON.stringify(w));
await mp.screenshot({ path: `${OUT}/05-phone-dialog.png` });
await phone.close();

// Вернуть исходное состояние спецрежима.
await ownerApi.patch(`${BASE}/api/settings/journal-controls`, { data: { automation: initial.automation } });
const restored = await (await ownerApi.get(`${BASE}/api/settings/journal-controls`)).json();
check("стенд: спецрежим возвращён как был", JSON.stringify(restored.automation) === JSON.stringify(initial.automation));

check("нет ошибок страницы", errors.length === 0, errors.slice(0, 3).join(" || "));
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, errors }, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} PASS`);
await browser.close();
process.exit(failed ? 1 : 0);
