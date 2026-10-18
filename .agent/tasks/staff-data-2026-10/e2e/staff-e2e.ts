// AC1–AC3, AC5, AC6: «Сотрудники» — сквозная проверка на своей базе.
//   AC1 штатная численность (API + поле + пилюля), порядок должностей;
//   AC2 «Набор прав» в окне доступа, самоблокировка, сохранение пресета;
//   AC3 контроль-группа: ACL, правило назначения, «Иерархия», список группы;
//   AC5 «Проверяющие и аудиторы» без хэшей токенов;
//   AC6 почта сотрудника: строка, окно правки, PUT /api/users/[id].
// Запуск (dev-сервер worktree на 3044, база wesetup_staff):
//   BASE=http://localhost:3044 npx tsx .agent/tasks/staff-data-2026-10/e2e/staff-e2e.ts
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { chromium, type APIRequestContext, type Page } from "playwright";

const DB_URL = "postgresql://postgres:postgres@localhost:5432/wesetup_staff?sslmode=disable";
if (!/@localhost:5432\/wesetup_staff\b/.test(DB_URL)) throw new Error("Только localhost:5432/wesetup_staff");
const db = new PrismaClient({ adapter: new PrismaPg(new pg.Pool({ connectionString: DB_URL })) });

const BASE = process.env.BASE ?? "http://localhost:3044";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const RAW = path.join(HERE, "..", "raw");
fs.mkdirSync(RAW, { recursive: true });
const ORG = "cmvbfyemt0000uw9mywdjiurr";
const PASSWORD = "Staff2026!";
const POS = {
  manager: "cmvbh5wjg0000u89mqmlfo07l",
  chef: "cmvbh5wzw0001u89mxi20jpsa",
  technologist: "cmvbh63rg000hu89mt5y42f79",
  hallManager: "cmvbh64us000ku89mr8da6ez2",
  hotCook: "cmvbh5x6v0003u89m76q3wkqm",
  waiter: "cmvbh608i0009u89mtwtcu480",
};

const checks: Array<{ ac: string; name: string; ok: boolean; detail?: unknown }> = [];
const check = (ac: string, name: string, ok: boolean, detail?: unknown) => {
  checks.push({ ac, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${ac}] ${name}${detail !== undefined ? ` :: ${JSON.stringify(detail).slice(0, 300)}` : ""}`);
};

async function login(page: Page, email: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 300_000 });
    await page.waitForLoadState("networkidle").catch(() => null);
    // Холодный dev-сервер собирает страницу входа дольше 30 секунд.
    const ready = await page
      .locator("#email")
      .waitFor({ timeout: 180_000 })
      .then(() => true)
      .catch(() => false);
    if (!ready) continue;
    await page.fill("#email", email);
    await page.fill("#password", PASSWORD);
    await page.click('button[type="submit"]').catch(() => null);
    const left = await page
      .waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120_000 })
      .then(() => true)
      .catch(() => false);
    if (left) return;
  }
  throw new Error(`login failed: ${email}`);
}

async function json(request: APIRequestContext, method: string, url: string, data?: unknown) {
  const response = await request.fetch(`${BASE}${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(data !== undefined ? { data: JSON.stringify(data) } : {}),
    timeout: 300_000,
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 200);
  }
  return { status: response.status(), body: body as Record<string, unknown>, text };
}

/** Раскрыть должность (страница помнит раскрытую в sessionStorage — кликаем, только если закрыта). */
async function openPosition(page: Page, position: RegExp, employee: string) {
  const row = page.locator("label", { hasText: employee }).first();
  // Раскрытая должность восстанавливается из sessionStorage после гидрации — даём ей время.
  await page.locator("button", { hasText: position }).first().waitFor({ timeout: 120_000 });
  await page.waitForTimeout(1500);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await row.isVisible().catch(() => false)) return row;
    await page.locator("button", { hasText: position }).first().click();
    if (await row.waitFor({ timeout: 8_000 }).then(() => true).catch(() => false)) return row;
  }
  await row.waitFor({ timeout: 30_000 });
  return row;
}

async function main() {
  const users = await db.user.findMany({
    where: { organizationId: ORG },
    select: { id: true, email: true, permissionPreset: true, phone: true, contactEmail: true },
  });
  const byEmail = (email: string) => {
    const user = users.find((item) => item.email === email);
    if (!user) throw new Error(`no user ${email}`);
    return user;
  };
  const admin = byEmail("admin@haccp.local");
  const hall = byEmail("hall-manager@haccp.local"); // контроль-группа с ролью руководителя
  const sanitation = byEmail("sanitation@haccp.local"); // контроль-группа с линейной ролью
  const hotCook = byEmail("hotcook1@haccp.local");
  const coldCook = byEmail("coldcook1@haccp.local");
  const technologist = byEmail("technologist@haccp.local");

  const originalPositions = await db.jobPosition.findMany({
    where: { organizationId: ORG },
    select: { id: true, sortOrder: true, plannedHeadcount: true },
  });
  const originalScopes = await db.managerScope.findMany({ where: { organizationId: ORG } });
  const createdTokenIds: string[] = [];
  const createdClaimIds: string[] = [];

  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const adminCtx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: "ru-RU" });
    const adminPage = await adminCtx.newPage();
    await login(adminPage, admin.email);
    const api = adminCtx.request;

    // ------------------------------------------------------------- AC1
    const bad = await json(api, "PATCH", `/api/positions/${POS.hotCook}`, { plannedHeadcount: 1000 });
    check("AC1.4", "PATCH plannedHeadcount=1000 → 400", bad.status === 400, bad.body);
    const badStr = await json(api, "PATCH", `/api/positions/${POS.hotCook}`, { plannedHeadcount: "3" });
    check("AC1.4", "PATCH plannedHeadcount=\"3\" → 400", badStr.status === 400, badStr.body);
    const badFloat = await json(api, "POST", "/api/positions", { name: "E2E дробь", categoryKey: "staff", plannedHeadcount: 1.5 });
    check("AC1.4", "POST plannedHeadcount=1.5 → 400", badFloat.status === 400, badFloat.body);
    for (const [id, planned] of [[POS.hotCook, 2], [POS.chef, 1], [POS.waiter, 0]] as const) {
      const res = await json(api, "PATCH", `/api/positions/${id}`, { plannedHeadcount: planned });
      check("AC1.4", `PATCH ${id} plannedHeadcount=${planned} → 200`, res.status === 200 && (res.body.position as { plannedHeadcount?: number })?.plannedHeadcount === planned, res.status);
    }
    const created = await json(api, "POST", "/api/positions", { name: "E2E Пекарь", categoryKey: "staff", plannedHeadcount: 4 });
    const createdId = (created.body.position as { id?: string } | undefined)?.id;
    check("AC1.4", "POST с plannedHeadcount=4 → 200", created.status === 200 && (created.body.position as { plannedHeadcount?: number })?.plannedHeadcount === 4, created.body);
    const cleared = createdId ? await json(api, "PATCH", `/api/positions/${createdId}`, { plannedHeadcount: null }) : null;
    check("AC1.4", "PATCH plannedHeadcount=null («не задано») → 200", cleared?.status === 200 && (cleared.body.position as { plannedHeadcount?: unknown })?.plannedHeadcount === null);

    const list = await json(api, "GET", "/api/positions");
    const positions = (list.body.positions ?? []) as Array<Record<string, unknown>>;
    const hot = positions.find((item) => item.id === POS.hotCook);
    const waiter = positions.find((item) => item.id === POS.waiter);
    const free = positions.find((item) => item.id === POS.manager);
    check("AC1.3", "GET /api/positions: занято 1 из 2, вакансия 1", hot?.occupied === 1 && hot?.vacancies === 1 && hot?.overstaffed === 0 && hot?.staffingLabel === "занято 1 из 2", hot);
    check("AC1.3", "GET /api/positions: перебор при плане 0", waiter?.overstaffed === 1 && waiter?.staffingLabel === "занято 1 из 0", waiter);
    check("AC1.3", "GET /api/positions: план не задан — «занято N»", free?.plannedHeadcount === null && free?.staffingLabel === "занято 1", free);
    const totals = list.body.totals as Record<string, unknown> | undefined;
    check("AC1.3", "GET /api/positions: итоги totals", totals?.withPlan === 3 && totals?.planned === 3 && totals?.occupiedPlanned === 3 && totals?.staffingLabel === "занято 3 из 3", totals);
    fs.writeFileSync(path.join(RAW, "ac1-positions-api.json"), JSON.stringify({ hot, waiter, free, totals }, null, 2));

    const management = originalPositions
      .filter((item) => [POS.manager, POS.chef, POS.technologist, POS.hallManager].includes(item.id))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((item) => item.id);
    const reversed = [...management].reverse();
    const ordered = await json(api, "PUT", "/api/positions/order", { ids: reversed });
    const afterOrder = await db.jobPosition.findMany({ where: { id: { in: reversed } }, select: { id: true, sortOrder: true } });
    const sorted = [...afterOrder].sort((a, b) => a.sortOrder - b.sortOrder).map((item) => item.id);
    check("AC1.5", "PUT /api/positions/order сохраняет порядок", ordered.status === 200 && JSON.stringify(sorted) === JSON.stringify(reversed), { status: ordered.status, sorted });
    const foreign = await db.jobPosition.findFirst({ where: { organizationId: { not: ORG } }, select: { id: true } });
    const unknown = await json(api, "PUT", "/api/positions/order", { ids: [POS.chef, foreign?.id ?? "cm-unknown-position"] });
    check("AC1.5", "PUT order с чужим/неизвестным id → 404", unknown.status === 404, unknown.body);
    const dup = await json(api, "PUT", "/api/positions/order", { ids: [POS.chef, POS.chef] });
    check("AC1.5", "PUT order с повтором → 400", dup.status === 400, dup.body);
    const empty = await json(api, "PUT", "/api/positions/order", { ids: [] });
    check("AC1.5", "PUT order с пустым списком → 400", empty.status === 400, empty.body);

    const cookCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const cookPage = await cookCtx.newPage();
    await login(cookPage, hotCook.email);
    const cookOrder = await json(cookCtx.request, "PUT", "/api/positions/order", { ids: [POS.chef] });
    check("AC1.5", "PUT order от повара → 403", cookOrder.status === 403, cookOrder.body);
    await cookCtx.close();

    // ------------------------------------------------------------- AC6 (API)
    const badEmail = await json(api, "PUT", `/api/users/${hotCook.id}`, { contactEmail: "volkova@" });
    check("AC6.1", "PUT /api/users/[id] с неверной почтой → 400", badEmail.status === 400, badEmail.body);
    const goodEmail = await json(api, "PUT", `/api/users/${hotCook.id}`, { contactEmail: "volkova@example.com", phone: "+7 985 123-45-67" });
    check("AC6.1", "PUT /api/users/[id] с почтой → 200", goodEmail.status === 200 && (goodEmail.body.user as { contactEmail?: string })?.contactEmail === "volkova@example.com", goodEmail.body);

    // ------------------------------------------------------------- UI: /settings/users
    await adminPage.goto(`${BASE}/settings/users`, { waitUntil: "load", timeout: 300_000 });
    await adminPage.waitForLoadState("networkidle").catch(() => null);
    // Раскрыть «Повар горячего цеха», чтобы были видны сотрудник и контакты.
    const hotRow = adminPage.locator("button", { hasText: /^Повар горячего цеха/ }).first();
    await hotRow.scrollIntoViewIfNeeded();
    const pills = adminPage.getByTestId("staffing-pill");
    check("AC1.6", "в строке должности пилюля «занято N из M»", (await pills.count()) >= 3 && (await adminPage.getByText("занято 1 из 2").count()) >= 1, await pills.allTextContents());
    await openPosition(adminPage, /^Повар горячего цеха/, "Волкова");
    await adminPage.getByTestId("staff-row-contacts").first().waitFor({ timeout: 30_000 });
    const contacts = await adminPage.getByTestId("staff-row-contacts").first().textContent();
    check("AC6.1", "в строке сотрудника видны телефон и почта", Boolean(contacts?.includes("volkova@example.com") && contacts?.includes("+7")), contacts);
    await hotRow.scrollIntoViewIfNeeded();
    await adminPage.screenshot({ path: path.join(RAW, "ac1-ac6-staff-page.png"), fullPage: false });

    // Окно правки должности — поле «Штатная численность».
    const hotCard = adminPage.locator("div.group\\/pos", { hasText: "Повар горячего цеха" }).first();
    await hotCard.hover();
    await hotCard.getByRole("button", { name: /Изменить должность|Редактировать должность|должност/i }).first().click();
    const headcount = adminPage.getByTestId("position-headcount");
    await headcount.waitFor({ timeout: 30_000 });
    check("AC1.6", "в окне правки должности есть «Штатная численность» = 2", (await headcount.inputValue()) === "2");
    await adminPage.screenshot({ path: path.join(RAW, "ac1-edit-position-dialog.png") });
    await headcount.fill("3");
    const patchDone = adminPage.waitForResponse((r) => r.url().includes("/api/positions/") && r.request().method() === "PATCH", { timeout: 120_000 });
    await adminPage.getByRole("button", { name: "Сохранить", exact: true }).click();
    await patchDone;
    await adminPage.waitForTimeout(500);
    const saved = await db.jobPosition.findUnique({ where: { id: POS.hotCook }, select: { plannedHeadcount: true } });
    check("AC1.6", "сохранение поля из окна → plannedHeadcount=3", saved?.plannedHeadcount === 3, saved);

    // Окно правки сотрудника — поле «Почта».
    await adminPage.goto(`${BASE}/settings/users`, { waitUntil: "load", timeout: 300_000 });
    await adminPage.waitForLoadState("networkidle").catch(() => null);
    const cookRow = await openPosition(adminPage, /^Повар горячего цеха/, "Волкова");
    await cookRow.getByRole("button", { name: /Редактировать сотрудника|Изменить/ }).first().click();
    const emailField = adminPage.getByTestId("staff-contact-email");
    await emailField.waitFor({ timeout: 30_000 });
    check("AC6.1", "в окне правки сотрудника есть поле «Почта»", (await emailField.inputValue()) === "volkova@example.com");
    await emailField.fill("anna.volkova@example.com");
    await adminPage.screenshot({ path: path.join(RAW, "ac6-edit-employee-email.png") });
    const putDone = adminPage.waitForResponse((r) => r.url().includes("/api/users/") && r.request().method() === "PUT", { timeout: 120_000 });
    await adminPage.getByRole("button", { name: "Сохранить", exact: true }).click();
    const putResponse = await putDone;
    check("AC6.1", "окно правки отправляет PUT /api/users/[id] → 200", putResponse.status() === 200, putResponse.status());
    await adminPage.waitForTimeout(500);
    const emailSaved = await db.user.findUnique({ where: { id: hotCook.id }, select: { contactEmail: true } });
    check("AC6.1", "почта из окна сохраняется через PUT /api/users/[id]", emailSaved?.contactEmail === "anna.volkova@example.com", emailSaved);

    // ------------------------------------------------------------- AC2: окно доступа
    const access = await json(api, "GET", `/api/users/${technologist.id}/access`);
    check("AC2.1", "GET /api/users/[id]/access отдаёт permissionPreset и effectivePreset", access.status === 200 && access.body.permissionPreset === null && access.body.effectivePreset === "head_chef", { p: access.body.permissionPreset, e: access.body.effectivePreset });
    await adminPage.goto(`${BASE}/settings/users`, { waitUntil: "load", timeout: 300_000 });
    await adminPage.waitForLoadState("networkidle").catch(() => null);
    await (await openPosition(adminPage, /^Технолог/, "Лебедева")).getByRole("button", { name: /Редактировать сотрудника|Изменить/ }).first().click();
    await adminPage.getByRole("button", { name: "Добавить доступ" }).click();
    const picker = adminPage.getByTestId("staff-preset-picker");
    await picker.waitFor({ timeout: 60_000 });
    check("AC2.2", "блок «Набор прав» показывает текущий выбор «По должности»", ((await adminPage.getByTestId("staff-preset-summary").textContent()) ?? "").includes("По должности"));
    await adminPage.getByTestId("staff-preset-toggle").click();
    await adminPage.getByTestId("staff-preset-option-control_group").click();
    const optionText = await adminPage.getByTestId("staff-preset-option-control_group").textContent();
    check("AC2.2", "у пресета — описание и список возможностей", Boolean(optionText?.includes("Сам не заполняет") && optionText.includes("Назначает задачи сотрудникам")), optionText);
    await picker.scrollIntoViewIfNeeded();
    await adminPage.screenshot({ path: path.join(RAW, "ac2-access-dialog-preset.png") });
    const presetCalls: string[] = [];
    adminPage.on("request", (request) => {
      if (request.url().includes("/preset")) presetCalls.push(`${request.method()} ${request.postData()}`);
    });
    const presetDone = adminPage.waitForResponse((r) => r.url().includes("/preset") && r.request().method() === "POST", { timeout: 120_000 });
    const accessDone = adminPage.waitForResponse((r) => r.url().includes("/access") && r.request().method() === "PUT", { timeout: 120_000 });
    await adminPage.getByRole("button", { name: "Сохранить", exact: true }).last().click();
    const presetResponse = await presetDone;
    await accessDone;
    check("AC2.2", "POST /api/staff/[id]/preset → 200", presetResponse.status() === 200, await presetResponse.text().catch(() => ""));
    await adminPage.waitForTimeout(500);
    const techAfter = await db.user.findUnique({ where: { id: technologist.id }, select: { permissionPreset: true } });
    check("AC2.2", "сохранение вызывает POST /api/staff/[id]/preset при изменении", techAfter?.permissionPreset === "control_group" && presetCalls.length === 1, { techAfter, presetCalls });
    // Повторное сохранение без изменений — без запроса пресета.
    presetCalls.length = 0;
    await adminPage.locator("label", { hasText: "Лебедева" }).first().getByRole("button", { name: /Редактировать сотрудника|Изменить/ }).first().click().catch(() => null);
    await adminPage.getByRole("button", { name: "Добавить доступ" }).click().catch(() => null);
    await adminPage.getByTestId("staff-preset-picker").waitFor({ timeout: 60_000 }).catch(() => null);
    const accessAgain = adminPage.waitForResponse((r) => r.url().includes("/access") && r.request().method() === "PUT", { timeout: 120_000 }).catch(() => null);
    await adminPage.getByRole("button", { name: "Сохранить", exact: true }).last().click().catch(() => null);
    await accessAgain;
    await adminPage.waitForTimeout(500);
    check("AC2.2", "без изменения пресета запрос не уходит", presetCalls.length === 0, presetCalls);

    const selfLock = await json(api, "POST", `/api/staff/${admin.id}/preset`, { preset: "control_group" });
    check("AC2.3", "себе нельзя снять «Администратора» → 400 SELF_LOCKOUT", selfLock.status === 400 && selfLock.body.code === "SELF_LOCKOUT", selfLock.body);
    const selfAuto = await json(api, "POST", `/api/staff/${admin.id}/preset`, { preset: null });
    check("AC2.3", "себе «по должности» (управляющий = администратор) → 200", selfAuto.status === 200, selfAuto.body);
    // Окно на себе: варианты без «Администратора» заблокированы.
    await adminPage.goto(`${BASE}/settings/users`, { waitUntil: "load", timeout: 300_000 });
    await adminPage.waitForLoadState("networkidle").catch(() => null);
    await (await openPosition(adminPage, /^Управляющий/, "Крылов")).getByRole("button", { name: /Редактировать сотрудника|Изменить/ }).first().click();
    await adminPage.getByRole("button", { name: "Добавить доступ" }).click();
    await adminPage.getByTestId("staff-preset-toggle").click();
    const lockedOption = adminPage.getByTestId("staff-preset-option-control_group");
    check("AC2.3", "в окне на себе «Контроль-группа» недоступна", await lockedOption.isDisabled());
    await lockedOption.scrollIntoViewIfNeeded();
    await adminPage.screenshot({ path: path.join(RAW, "ac2-access-dialog-self-locked.png") });
    await adminPage.keyboard.press("Escape");

    // ------------------------------------------------------------- AC3: контроль-группа
    const toCg = await json(api, "POST", `/api/staff/${hall.id}/preset`, { preset: "control_group" });
    const toCg2 = await json(api, "POST", `/api/staff/${sanitation.id}/preset`, { preset: "control_group" });
    check("AC3.1", "руководитель ставит пресет «Контроль-группа»", toCg.status === 200 && toCg2.status === 200 && toCg.body.effectivePreset === "control_group");
    const scopeRes = await json(api, "POST", "/api/manager-scope", {
      managerId: hall.id,
      viewMode: "job_positions",
      viewJobPositionIds: [POS.hotCook],
      assignableJournalCodes: ["hygiene"],
    });
    check("AC3.3", "руководитель настраивает «Иерархию» контроль-группы", scopeRes.status === 200, scopeRes.status);

    const group = await json(api, "GET", "/api/staff/control-group");
    const members = (group.body.members ?? []) as Array<{ id: string; scope: { sees: string; assigns: string } }>;
    const hallMember = members.find((member) => member.id === hall.id);
    const candidates = (group.body.candidates ?? []) as Array<{ id: string }>;
    check("AC3.5", "GET /api/staff/control-group: участники с описанием иерархии и кандидаты", group.status === 200 && hallMember?.scope.sees === "Видит должности: Повар горячего цеха" && hallMember.scope.assigns.includes("Гигиенический") && candidates.some((c) => c.id === hotCook.id) && !candidates.some((c) => c.id === admin.id), { hallMember, candidates: candidates.length });
    fs.writeFileSync(path.join(RAW, "ac3-control-group-api.json"), JSON.stringify(group.body, null, 2));

    const hallCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const hallPage = await hallCtx.newPage();
    await login(hallPage, hall.email);
    const cg = hallCtx.request;
    const today = new Date().toISOString().slice(0, 10);
    const assign = (userId: string, journalCode: string) =>
      json(cg, "POST", "/api/journal-task-claims/assign", {
        journalCode,
        scopeKey: `e2e-staff-data-${journalCode}-${userId}`,
        scopeLabel: "E2E проверка назначения",
        dateKey: today,
        userId,
      });
    const okAssign = await assign(hotCook.id, "hygiene");
    const claimId = (okAssign.body.claim as { id?: string } | undefined)?.id;
    if (claimId) createdClaimIds.push(claimId);
    check("AC3.3", "контроль-группа назначает своему сотруднику свой журнал", okAssign.status === 200 || (okAssign.status === 409 && typeof okAssign.body.reason === "string"), okAssign.body);
    const outside = await assign(coldCook.id, "hygiene");
    check("AC3.3", "сотрудник вне ManagerScope → 403", outside.status === 403 && outside.body.code === "TARGET_OUT_OF_SCOPE", outside.body);
    const otherJournal = await assign(hotCook.id, "cleaning");
    check("AC3.3", "журнал вне assignableJournalCodes → 403", otherJournal.status === 403 && otherJournal.body.code === "JOURNAL_OUT_OF_SCOPE", otherJournal.body);
    const toControl = await json(api, "POST", "/api/journal-task-claims/assign", {
      journalCode: "hygiene",
      scopeKey: "e2e-staff-data-cg",
      scopeLabel: "E2E",
      dateKey: today,
      userId: sanitation.id,
    });
    check("AC3.3", "участнику контроль-группы задачу не назначить (даже руководителем) → 409", toControl.status === 409 && toControl.body.code === "TARGET_CONTROL_GROUP", toControl.body);

    const scopePost = await json(cg, "POST", "/api/manager-scope", { managerId: hall.id, viewMode: "all" });
    check("AC3.4", "контроль-группа не меняет «Иерархию»: POST → 403", scopePost.status === 403, scopePost.body);
    const scopeId = (scopeRes.body.scope as { id?: string } | undefined)?.id ?? "x";
    const scopeDel = await json(cg, "DELETE", `/api/manager-scope?id=${scopeId}`);
    check("AC3.4", "контроль-группа не меняет «Иерархию»: DELETE → 403", scopeDel.status === 403, scopeDel.body);

    const claimWrite = await json(cg, "POST", "/api/journal-task-claims", {
      journalCode: "hygiene",
      scopeKey: "e2e-staff-data-self",
      scopeLabel: "E2E",
      dateKey: today,
    });
    check("AC3.2", "ACL: контроль-группа (роль руководителя) не берёт задачу на заполнение → 403", claimWrite.status === 403, claimWrite.body);
    const doc = await db.journalDocument.findFirst({ where: { organizationId: ORG, status: "active" }, select: { id: true } });
    const close = await json(cg, "PATCH", `/api/journal-documents/${doc?.id}`, { status: "closed" });
    check("AC3.2", "контроль-группа не закрывает документ → 403", close.status === 403, close.body);
    await hallPage.goto(`${BASE}/journals`, { waitUntil: "load", timeout: 300_000 });
    check("AC3.2", "контроль-группа открывает /journals (чтение)", new URL(hallPage.url()).pathname.startsWith("/journals"), hallPage.url());
    await hallPage.screenshot({ path: path.join(RAW, "ac3-control-group-journals.png") });
    await hallCtx.close();

    // ------------------------------------------------------------- AC5
    const tokenRes = await json(api, "POST", "/api/settings/inspector-tokens", { mode: "qr", ttl: "7d", label: "E2E СЭС" });
    const tokenId = typeof tokenRes.body.createdId === "string" ? tokenRes.body.createdId : undefined;
    if (tokenId) createdTokenIds.push(tokenId);
    const inspectors = await json(api, "GET", "/api/staff/inspectors-auditors");
    const external = (inspectors.body.external ?? []) as Array<{ id: string; kind: string; status: string; issuedBy: unknown }>;
    const internal = (inspectors.body.internal ?? []) as Array<{ name: string; roles: Array<{ kind: string }> }>;
    check("AC5.2", "GET /api/staff/inspectors-auditors → 200, без хэшей токенов", inspectors.status === 200 && !inspectors.text.includes("tokenHash"), { status: inspectors.status });
    check("AC5.1", "внешние: QR портала с видом, статусом и тем, кто выпустил", external.some((item) => item.kind === "qr" && item.status === "active" && item.issuedBy !== null), external.slice(0, 2));
    check("AC5.1", "внутренние: люди с ролями проверки", internal.length > 0 && internal.every((person) => person.roles.length > 0), internal.map((person) => [person.name, person.roles.map((role) => role.kind)]));
    fs.writeFileSync(path.join(RAW, "ac5-inspectors-auditors-api.json"), JSON.stringify(inspectors.body, null, 2));
    const cookCtx2 = await browser.newContext();
    const cookPage2 = await cookCtx2.newPage();
    await login(cookPage2, hotCook.email);
    const cookList = await json(cookCtx2.request, "GET", "/api/staff/inspectors-auditors");
    check("AC5.2", "повару список недоступен → 403", cookList.status === 403, cookList.status);
    await cookCtx2.close();

    // Мобильная ширина страницы «Сотрудники».
    const mobileCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const mobilePage = await mobileCtx.newPage();
    await login(mobilePage, admin.email);
    await mobilePage.goto(`${BASE}/settings/users`, { waitUntil: "load", timeout: 300_000 });
    await mobilePage.waitForLoadState("networkidle").catch(() => null);
    await openPosition(mobilePage, /^Повар горячего цеха/, "Волкова");
    await mobilePage.getByTestId("staff-row-contacts").first().scrollIntoViewIfNeeded();
    const noOverflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    check("AC1.6", "390 px: страница без горизонтального скролла", noOverflow);
    await mobilePage.screenshot({ path: path.join(RAW, "ac1-ac6-staff-page-mobile.png") });
    await mobileCtx.close();
  } finally {
    // Возвращаем базу как было.
    for (const position of originalPositions) {
      await db.jobPosition.update({ where: { id: position.id }, data: { sortOrder: position.sortOrder, plannedHeadcount: position.plannedHeadcount } }).catch(() => null);
    }
    await db.jobPosition.deleteMany({ where: { organizationId: ORG, name: { startsWith: "E2E " } } }).catch(() => null);
    for (const user of users) {
      await db.user.update({ where: { id: user.id }, data: { permissionPreset: user.permissionPreset, phone: user.phone, contactEmail: user.contactEmail } }).catch(() => null);
    }
    await db.managerScope.deleteMany({ where: { organizationId: ORG, id: { notIn: originalScopes.map((scope) => scope.id) } } }).catch(() => null);
    if (createdClaimIds.length) await db.journalTaskClaim.deleteMany({ where: { id: { in: createdClaimIds } } }).catch(() => null);
    await db.journalTaskClaim.deleteMany({ where: { organizationId: ORG, scopeKey: { startsWith: "e2e-staff-data" } } }).catch(() => null);
    if (createdTokenIds.length) await db.inspectorToken.deleteMany({ where: { id: { in: createdTokenIds } } }).catch(() => null);
    await browser.close();
    await db.$disconnect();
  }

  const failed = checks.filter((item) => !item.ok);
  fs.writeFileSync(path.join(HERE, "staff-e2e.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), passed: checks.length - failed.length, failed: failed.length, checks }, null, 2));
  console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
  if (failed.length) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(error);
  const failed = checks.filter((item) => !item.ok);
  fs.writeFileSync(path.join(HERE, "staff-e2e.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), aborted: String(error).slice(0, 500), passed: checks.length - failed.length, failed: failed.length, checks }, null, 2));
  process.exitCode = 1;
});
