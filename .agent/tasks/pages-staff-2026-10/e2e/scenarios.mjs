// Ключевые сценарии spec (AC1–AC7) под руководителем и заведующей на своей базе.
// Запуск из корня worktree: node .agent/tasks/pages-staff-2026-10/e2e/scenarios.mjs
// Скрипт возвращает базу как было: тестовая должность удаляется, штатная
// численность, наборы прав, состав комиссии, группа ХАССП и выключенные журналы — назад.
import fs from "node:fs";
import pg from "pg";
import {
  BASE,
  goto,
  horizontalOverflow,
  launch,
  newContext,
  problem,
  problems,
  shot,
  signIn,
  watchErrors,
  writeJson,
} from "./lib.mjs";

const results = {};
function record(name, data, ok = true) {
  results[name] = { ok, ...data };
  console.log(`  ${ok ? "✓" : "✗"} ${name}: ${JSON.stringify(data).slice(0, 220)}`);
  if (!ok) problem(`${name}: ${JSON.stringify(data).slice(0, 300)}`);
}

async function api(page, method, url, data) {
  const res = await page.request.fetch(`${BASE}${url}`, { method, data, timeout: 600_000 });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status(), body };
}

async function waitToast(page, pattern) {
  const toast = page.locator("[data-sonner-toast]").filter({ hasText: pattern }).first();
  const seen = await toast.waitFor({ timeout: 120_000 }).then(() => true).catch(() => false);
  return seen ? (await toast.innerText().catch(() => "")).trim() : "";
}

function dbClient() {
  const env = fs.readFileSync(".env", "utf8");
  const url = env.match(/^DATABASE_URL=(.*)$/m)[1].replace(/^"|"$/g, "");
  if (!url.includes("wesetup_pages_staff")) throw new Error("не своя база");
  return new pg.Client({ connectionString: url });
}

const ORG = "cmvbfyemt0000uw9mywdjiurr";
const browser = await launch();
const db = dbClient();
await db.connect();
const cleanup = [];

try {
  // ------------------------------------------------------------------ руководитель
  const context = await newContext(browser, "desktop");
  const page = await context.newPage();
  watchErrors(page, "owner");
  await signIn(page, "admin@haccp.local");
  const session = (await api(page, "GET", "/api/auth/session")).body;
  const ownerId = session?.user?.id;

  // ---------- AC1. Должности
  for (const position of (await api(page, "GET", "/api/positions")).body.positions) {
    if (position.name.startsWith("Тест ")) await api(page, "DELETE", `/api/positions/${position.id}`);
  }
  const before = (await api(page, "GET", "/api/positions")).body.positions;
  const byName = new Map(before.map((position) => [position.name, position]));
  // Штат и порядок должностей вернём прямо в базе (перестановка перенумеровывает sortOrder).
  const positionsSnapshot = await db.query(`select id, "plannedHeadcount", "sortOrder" from "JobPosition" where "organizationId" = $1`, [ORG]);
  cleanup.push(async () => {
    for (const row of positionsSnapshot.rows) {
      await db.query(`update "JobPosition" set "plannedHeadcount" = $2, "sortOrder" = $3 where id = $1`, [row.id, row.plannedHeadcount, row.sortOrder]);
    }
  });
  const planned = { "Повар горячего цеха": 1, Официант: 3, Уборщик: 0 };
  for (const [name, value] of Object.entries(planned)) {
    await api(page, "PATCH", `/api/positions/${byName.get(name).id}`, { plannedHeadcount: value });
  }

  await goto(page, "/settings/positions");
  const pills = {};
  for (const name of Object.keys(planned)) {
    const pill = page.locator(`[data-position-row="${name}"] [data-testid="staffing-pill"]`);
    pills[name] = {
      text: await pill.innerText().catch(() => ""),
      tone: await pill.getAttribute("class").then((cls) => (cls.includes("#116b2a") ? "full" : cls.includes("#b25f00") ? "vacancy" : cls.includes("#a13a32") ? "over" : "?")),
    };
  }
  const totals = await page.locator("[data-positions-totals]").innerText();
  record("AC1.2-pills", { pills, totals }, pills["Повар горячего цеха"].tone === "full" && pills["Официант"].tone === "vacancy" && pills["Уборщик"].tone === "over" && pills["Официант"].text.includes("1 из 3"));
  record("AC1.3-totals", { totals }, /По штату: 4/.test(totals) && /Занято: 3/.test(totals) && /Вакансий: 2/.test(totals));
  const cards = await page.locator("[data-staff-card]").evaluateAll((els) => els.map((el) => el.getAttribute("data-staff-card")));
  record("AC1.2-categories", { cards }, cards.join(",") === "positions-management,positions-staff,positions-commission");
  await shot(page, "ac1-positions-pills", { fullPage: true });

  // создание окном
  await page.getByTestId("position-create").click();
  let dialog = page.getByRole("dialog");
  await dialog.getByTestId("position-category-commission").click();
  await dialog.getByTestId("position-name").fill("Тест член комиссии");
  await dialog.getByTestId("position-headcount").fill("2");
  await shot(page, "ac1-create-dialog");
  await dialog.getByTestId("position-save").click();
  const createdToast = await waitToast(page, /добавлена/);
  const testRow = page.locator('[data-position-row="Тест член комиссии"]');
  await testRow.waitFor({ timeout: 120_000 });
  record("AC1.4-create", { toast: createdToast, pill: await testRow.getByTestId("staffing-pill").innerText(), inCommission: await page.locator('#positions-commission [data-position-row="Тест член комиссии"]').count() }, Boolean(createdToast));

  // ошибка API — тостом (такая же должность)
  await page.getByTestId("position-create").click();
  dialog = page.getByRole("dialog");
  await dialog.getByTestId("position-category-commission").click();
  await dialog.getByTestId("position-name").fill("Тест член комиссии");
  await dialog.getByTestId("position-save").click();
  const duplicateToast = await waitToast(page, /уже/);
  await shot(page, "ac1-duplicate-toast");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  record("AC1.4-api-error-toast", { toast: duplicateToast }, /уже существует/.test(duplicateToast));

  // правка окном
  await testRow.getByTestId("position-edit").click();
  dialog = page.getByRole("dialog");
  await dialog.getByTestId("position-headcount").fill("1");
  await dialog.getByTestId("position-save").click();
  const updatedToast = await waitToast(page, /сохранена/);
  await page
    .waitForFunction(() => document.querySelector('[data-position-row="Тест член комиссии"] [data-testid="staffing-pill"]')?.textContent?.includes("0 из 1"), null, { timeout: 60_000 })
    .catch(() => {});
  record("AC1.4-edit", { toast: updatedToast, pill: await testRow.getByTestId("staffing-pill").innerText() }, /0 из 1/.test(await testRow.getByTestId("staffing-pill").innerText()));

  // порядок: «ниже» у первой должности сотрудников, перезагрузка, «выше» — назад
  const staffRows = () => page.locator("#positions-staff [data-position-row]").evaluateAll((els) => els.map((el) => el.getAttribute("data-position-row")));
  const initialOrder = await staffRows();
  const orderResponse = page.waitForResponse((r) => r.url().includes("/api/positions/order") && r.request().method() === "PUT", { timeout: 120_000 });
  await page.locator(`#positions-staff [data-position-row="${initialOrder[0]}"]`).getByTestId("position-down").click();
  const orderStatus = (await orderResponse).status();
  await page.waitForTimeout(1500);
  await goto(page, "/settings/positions");
  const movedOrder = await staffRows();
  const restoreResponse = page.waitForResponse((r) => r.url().includes("/api/positions/order") && r.request().method() === "PUT", { timeout: 120_000 });
  await page.locator(`#positions-staff [data-position-row="${initialOrder[0]}"]`).getByTestId("position-up").click();
  await restoreResponse;
  await page.waitForTimeout(1500);
  await goto(page, "/settings/positions");
  const restoredOrder = await staffRows();
  record(
    "AC1.5-order",
    { orderStatus, initial: initialOrder.slice(0, 3), afterReload: movedOrder.slice(0, 3), restored: restoredOrder.slice(0, 3) },
    orderStatus === 200 && movedOrder[0] === initialOrder[1] && movedOrder[1] === initialOrder[0] && restoredOrder.join() === initialOrder.join()
  );

  // удаление: с людьми — объяснение, пустая — ConfirmDialog и удаление
  await page.locator('[data-position-row="Повар горячего цеха"]').getByTestId("position-delete").click();
  const blocked = page.locator('[role="dialog"]').filter({ hasText: "работают люди" });
  await blocked.waitFor({ timeout: 30_000 });
  const blockedText = await blocked.innerText();
  await shot(page, "ac1-delete-blocked");
  await blocked.getByRole("button", { name: "Отмена" }).click();
  record("AC1.4-delete-blocked", { text: blockedText.replace(/\s+/g, " ").slice(0, 300) }, /Сейчас на должности: 1 человек/.test(blockedText) && /Открыть сотрудников/.test(blockedText));

  await page.locator('[data-position-row="Тест член комиссии"]').getByTestId("position-delete").click();
  const confirm = page.locator('[role="dialog"]').filter({ hasText: "Удалить должность" });
  await confirm.waitFor({ timeout: 30_000 });
  await shot(page, "ac1-delete-confirm");
  await confirm.getByRole("button", { name: "Удалить", exact: true }).click();
  const deletedToast = await waitToast(page, /удалена/);
  await page.waitForTimeout(1500);
  record("AC1.4-delete", { toast: deletedToast, left: await page.locator('[data-position-row="Тест член комиссии"]').count() }, Boolean(deletedToast) && (await page.locator('[data-position-row="Тест член комиссии"]').count()) === 0);

  await page.getByRole("button", { name: /Как работает штатное расписание/ }).click();
  await page.waitForTimeout(400);
  await shot(page, "ac1-guide");
  record("AC1.6-guide", { text: (await page.locator("text=Штатная численность.").count()) > 0 }, (await page.getByText("«Занято N из M».").count()) > 0);

  // ---------- AC2. Доступ и права
  await goto(page, "/settings/access");
  const presets = await page.locator("[data-access-presets] [data-preset]").evaluateAll((els) => els.map((el) => el.getAttribute("data-preset")));
  const blocks = await page.locator("[data-staff-card]").evaluateAll((els) => els.map((el) => el.getAttribute("data-staff-card")));
  record("AC2.2-presets", { presets, configureLink: await page.getByTestId("access-link-role-presets").isVisible(), blocks }, presets.length === 8 && presets.includes("control_group") && blocks.join() === "presets,people,sections,journals,visibility,permissions");
  record("AC2.1-no-tabs", { tabs: await page.locator("[data-section-tabs]").count() }, (await page.locator("[data-section-tabs]").count()) === 0);

  const volkova = page.locator('[data-person="Волкова Анна Дмитриевна"]');
  await volkova.getByTestId("person-preset-edit").click();
  dialog = page.getByRole("dialog");
  await dialog.getByTestId("staff-preset-option-control_group").click();
  await shot(page, "ac2-preset-dialog");
  await dialog.getByTestId("person-preset-save").click();
  const presetToast = await waitToast(page, /Контроль-группа/);
  await page.waitForFunction(() => document.querySelector('[data-person="Волкова Анна Дмитриевна"]')?.textContent?.includes("назначен вручную"), null, { timeout: 120_000 }).catch(() => {});
  const volkovaText = (await volkova.innerText()).replace(/\s+/g, " ");
  record("AC2.3-change-preset", { toast: presetToast, row: volkovaText }, /Контроль-группа/.test(volkovaText) && /назначен вручную/.test(volkovaText));

  // разделы выбранного человека
  const personCard = page.locator("[data-access-person-sections]");
  await personCard.locator("button").first().click();
  await page.locator("[data-radix-popper-content-wrapper] input").first().fill("Волкова");
  await page.locator("[data-radix-popper-content-wrapper] button").filter({ hasText: "Волкова" }).first().click();
  await page.waitForTimeout(500);
  const personSections = await personCard.locator("[data-section]").evaluateAll((els) => els.map((el) => `${el.getAttribute("data-section")}:${el.getAttribute("data-state")}`));
  const presetRows = await page.locator("[data-preset-sections]").evaluateAll((els) =>
    els.map((el) => ({
      preset: el.getAttribute("data-preset-sections"),
      visible: [...el.querySelectorAll('[data-state="visible"]')].map((icon) => icon.getAttribute("data-section")),
      depends: [...el.querySelectorAll('[data-state="depends"]')].map((icon) => icon.getAttribute("data-section")),
    }))
  );
  await page.locator('[data-staff-card="sections"]').screenshot({ path: `${process.cwd()}/.agent/tasks/pages-staff-2026-10/raw/ac2-sections.png` });
  fs.copyFileSync(`${process.cwd()}/.agent/tasks/pages-staff-2026-10/raw/ac2-sections.png`, "C:\\Users\\Two\\wesetup-backup-2026-10-17\\pages-shots\\staff\\ac2-sections.png");
  const visibleOf = (preset) => presetRows.find((row) => row.preset === preset)?.visible ?? [];
  record(
    "AC2.4-sections",
    { personSections, presetRows },
    visibleOf("admin").length === 9 &&
      !visibleOf("head_chef").includes("company") &&
      visibleOf("control_group").join() === "staff,journals,checklists,inspection" &&
      personSections.filter((value) => value.endsWith(":visible")).map((value) => value.split(":")[0]).join() === "staff,journals,checklists,inspection"
  );

  // вернуть набор по должности
  await volkova.getByTestId("person-preset-edit").click();
  dialog = page.getByRole("dialog");
  await dialog.getByTestId("staff-preset-option-auto").click();
  await dialog.getByTestId("person-preset-save").click();
  await waitToast(page, /Повар/);
  await page.waitForFunction(() => document.querySelector('[data-person="Волкова Анна Дмитриевна"]')?.textContent?.includes("по должности"), null, { timeout: 120_000 }).catch(() => {});
  record("AC2.3-revert", { row: (await volkova.innerText()).replace(/\s+/g, " ") }, /по должности/.test(await volkova.innerText()));

  // себе — без администратора нельзя
  await page.locator('[data-person="Крылов Денис Сергеевич"]').getByTestId("person-preset-edit").click();
  dialog = page.getByRole("dialog");
  const cookLocked = await dialog.getByTestId("staff-preset-option-cook").isDisabled();
  await shot(page, "ac2-self-locked");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const selfApi = await api(page, "POST", `/api/staff/${ownerId}/preset`, { preset: "cook" });
  record("AC2.3-self-lockout", { cookLocked, api: selfApi }, cookLocked && selfApi.status === 400 && selfApi.body?.code === "SELF_LOCKOUT");

  // блоки «Журналы», «Видимость коллег», «Права на настройки» и переходы в редакторы
  const journalsText = (await page.locator('[data-staff-card="journals"]').innerText()).replace(/\s+/g, " ");
  const visibilityText = (await page.locator('[data-staff-card="visibility"]').innerText()).replace(/\s+/g, " ");
  record("AC2.5-6-7-blocks", { journals: journalsText.slice(0, 160), visibility: visibilityText.slice(0, 200), permissions: await page.locator('[data-staff-card="permissions"]').count() }, /из 46|из \d+/.test(journalsText) && /Список задан у/.test(visibilityText));
  const editors = {};
  for (const [testId, href] of [
    ["access-link-journal-access", "/settings/journal-access"],
    ["access-link-journals-by-position", "/settings/journals-by-position"],
    ["access-link-permissions", "/settings/permissions"],
    ["access-link-role-presets", "/settings/role-presets"],
  ]) {
    await goto(page, "/settings/access");
    await page.getByTestId(testId).click();
    await page.waitForURL((url) => url.pathname === href, { timeout: 300_000 });
    await page.waitForTimeout(1500);
    editors[href] = {
      backLink: await page.locator('main a[href="/settings/access"]').first().innerText().catch(() => ""),
      menuActive: await page.locator('[data-app-sidebar] [data-menu-item="access"]').getAttribute("aria-current").catch(() => null),
    };
    if (href === "/settings/journal-access") await shot(page, "ac2-editor-journal-access");
  }
  record("AC2.1-editors", editors, Object.values(editors).every((entry) => /Доступ и права/.test(entry.backLink) && entry.menuActive === "page"));

  // ---------- AC3. Бракеражная комиссия
  const original = await db.query(`select "journalCommissionJson", "disabledJournalCodes" from "Organization" where id = $1`, [ORG]);
  const originalCommission = original.rows[0].journalCommissionJson;
  const originalDisabled = original.rows[0].disabledJournalCodes;
  // Сохранение состава копирует его в действующие документы журнала — их настройки тоже вернём.
  const commissionDocs = await db.query(
    `select d.id, d.config from "JournalDocument" d join "JournalTemplate" t on t.id = d."templateId"
      where d."organizationId" = $1 and t.code in ('finished_product', 'perishable_rejection')`,
    [ORG]
  );
  cleanup.push(async () => {
    await db.query(`update "Organization" set "journalCommissionJson" = $2, "disabledJournalCodes" = $3 where id = $1`, [ORG, JSON.stringify(originalCommission), JSON.stringify(originalDisabled)]);
    for (const row of commissionDocs.rows) {
      await db.query(`update "JournalDocument" set config = $2 where id = $1`, [row.id, row.config === null ? null : JSON.stringify(row.config)]);
    }
  });
  await goto(page, "/settings/brakerage-commission");
  await page.locator('[data-commission="finished_product"] [data-member]').first().waitFor({ timeout: 300_000 });
  await page.locator('[data-commission="perishable_rejection"] [data-member], [data-commission="perishable_rejection"] [data-staff-empty]').first().waitFor({ timeout: 300_000 });
  const finished = await page.locator('[data-commission="finished_product"] [data-member]').evaluateAll((els) => els.map((el) => el.textContent.replace(/\s+/g, " ").trim()));
  await shot(page, "ac3-commission", { fullPage: true });
  record("AC3.2-members", { finished }, finished.length === 3 && finished.some((text) => /Лебедева.*Технолог.*Председатель/.test(text)));

  await page.locator("#perishable_rejection").getByTestId("commission-edit").click();
  dialog = page.getByRole("dialog");
  await dialog.getByText("Добавить из сотрудников").click();
  await dialog.getByPlaceholder("Найти по фамилии").fill("Белова");
  await dialog.locator("button").filter({ hasText: "Белова" }).first().click();
  await shot(page, "ac3-commission-dialog");
  await dialog.getByRole("button", { name: "Сохранить состав" }).click();
  await waitToast(page, /сохранён/);
  await page.locator('[data-commission="perishable_rejection"] [data-member="Белова Елена Андреевна"]').waitFor({ timeout: 120_000 }).catch(() => {});
  const perishable = await page.locator('[data-commission="perishable_rejection"] [data-member]').evaluateAll((els) => els.map((el) => el.textContent.replace(/\s+/g, " ").trim()));
  record("AC3.2-dialog-save", { perishable }, perishable.some((text) => text.includes("Белова")));

  await db.query(`update "Organization" set "disabledJournalCodes" = $2 where id = $1`, [ORG, JSON.stringify([...originalDisabled, "perishable_rejection"])]);
  await goto(page, "/settings/brakerage-commission");
  await page.locator('[data-commission="perishable_rejection"] [data-member]').first().waitFor({ timeout: 300_000 }).catch(() => {});
  const off = await page.locator("#perishable_rejection").getByTestId("commission-journal-off").isVisible();
  const enableHref = await page.locator('#perishable_rejection a[href="/settings/journals"]').count();
  const journalHref = await page.locator("#perishable_rejection").getByTestId("commission-open-journal").getAttribute("href");
  await page.locator("#perishable_rejection").screenshot({ path: `${process.cwd()}/.agent/tasks/pages-staff-2026-10/raw/ac3-journal-off.png` });
  fs.copyFileSync(`${process.cwd()}/.agent/tasks/pages-staff-2026-10/raw/ac3-journal-off.png`, "C:\\Users\\Two\\wesetup-backup-2026-10-17\\pages-shots\\staff\\ac3-journal-off.png");
  record("AC3.3-journal-link", { off, enableHref, journalHref, finishedOff: await page.locator("#finished_product").getByTestId("commission-journal-off").count() }, off && enableHref === 1 && journalHref === "/journals/perishable_rejection");
  record("AC3.4-copy-hint", { hint: await page.getByText("копируется в действующие документы журнала").first().isVisible() }, await page.getByText("копируется в действующие документы журнала").first().isVisible());

  // ---------- AC4. Группа ХАССП
  await goto(page, "/settings/haccp-group");
  const haccpEmpty = await page.locator("[data-staff-empty]").count();
  const emptyHref = await page.locator('[data-staff-empty] a[href="/production-control/haccp/team"]').count();
  await shot(page, "ac4-haccp-empty");
  const candidates = (await api(page, "GET", "/api/staff/control-group")).body.candidates;
  const idOf = (name) => candidates.find((candidate) => candidate.name === name)?.id;
  const created = [];
  for (const [name, role] of [["Морозов Илья Андреевич", "leader"], ["Лебедева Марина Олеговна", "member"]]) {
    const res = await api(page, "POST", "/api/production-control/records", { block: "team", data: { userId: idOf(name), role, duties: role === "leader" ? "Руководит группой, подписывает план ХАССП" : "" } });
    if (res.body?.record?.id) created.push(res.body.record.id);
    else console.log("  team POST", res.status, JSON.stringify(res.body));
  }
  cleanup.push(async () => {
    for (const id of created) await api(page, "DELETE", `/api/production-control/records/${id}`);
  });
  await goto(page, "/settings/haccp-group");
  const haccpMembers = await page.locator("[data-haccp-members] li").evaluateAll((els) => els.map((el) => el.textContent.replace(/\s+/g, " ").trim()));
  const editHref = await page.getByTestId("haccp-group-edit").first().getAttribute("href");
  await shot(page, "ac4-haccp-members", { fullPage: true });
  record("AC4-haccp", { haccpEmpty, emptyHref, haccpMembers, editHref, editButtons: await page.locator('a[href="/production-control/haccp/team"]').count() }, haccpEmpty === 1 && emptyHref === 1 && haccpMembers.length === 2 && /Руководитель группы/.test(haccpMembers[0]) && editHref === "/production-control/haccp/team");
  for (const id of created) await api(page, "DELETE", `/api/production-control/records/${id}`);
  created.length = 0;

  // ---------- AC5. Контроль-группа
  const cgApi = await api(page, "GET", "/api/staff/control-group");
  record("AC5.1-api", { status: cgApi.status, keys: Object.keys(cgApi.body ?? {}), candidate: cgApi.body?.candidates?.[0] }, cgApi.status === 200 && cgApi.body.canManage === true && typeof cgApi.body.candidates[0].isManager === "boolean");
  await goto(page, "/settings/control-group");
  const addCard = page.locator("[data-control-group-add]");
  const pick = async (name) => {
    await addCard.locator("button").first().click();
    await page.locator("[data-radix-popper-content-wrapper] input").first().fill(name.split(" ")[0]);
    await page.locator("[data-radix-popper-content-wrapper] button").filter({ hasText: name }).first().click();
    await page.waitForTimeout(300);
  };
  await pick("Волкова Анна Дмитриевна");
  const preview = await page.locator("[data-control-group-preview]").innerText();
  await page.getByTestId("control-group-add").click();
  await waitToast(page, /в контроль-группе/);
  await page.locator('[data-control-group-members] [data-member="Волкова Анна Дмитриевна"]').waitFor({ timeout: 120_000 }).catch(() => {});
  const memberText = (await page.locator('[data-control-group-members] [data-member="Волкова Анна Дмитриевна"]').innerText().catch(() => "")).replace(/\s+/g, " ");
  await shot(page, "ac5-member-added", { fullPage: true });
  record("AC5.2-add", { preview, memberText }, /Повар.*Контроль-группа/.test(preview) && /Видит всех/.test(memberText) && /Назначает задачи по всем журналам/.test(memberText) && /Сузить/.test(memberText));

  await pick("Громова Алина Павловна");
  await page.getByTestId("control-group-add").click();
  const adminConfirm = page.locator('[role="dialog"]').filter({ hasText: "потеряет полный доступ" });
  const adminConfirmShown = await adminConfirm.waitFor({ timeout: 30_000 }).then(() => true).catch(() => false);
  await shot(page, "ac5-admin-confirm");
  await adminConfirm.getByRole("button", { name: "Отмена" }).click().catch(() => {});
  record("AC5.2-admin-confirm", { adminConfirmShown }, adminConfirmShown);

  await page.locator('[data-member="Волкова Анна Дмитриевна"]').getByTestId("control-group-remove").click();
  const removeConfirm = page.locator('[role="dialog"]').filter({ hasText: "Убрать" });
  await removeConfirm.waitFor({ timeout: 30_000 });
  const removeText = (await removeConfirm.innerText()).replace(/\s+/g, " ");
  await shot(page, "ac5-remove-confirm");
  await removeConfirm.getByRole("button", { name: "Убрать", exact: true }).click();
  await waitToast(page, /снова по должности/);
  await page
    .waitForFunction(() => document.querySelectorAll("[data-control-group-members] [data-member]").length === 0, null, { timeout: 120_000 })
    .catch(() => {});
  record("AC5.2-remove", { removeText: removeText.slice(0, 200), left: await page.locator('[data-control-group-members] [data-member]').count() }, /Новый набор: «Повар»/.test(removeText) && (await page.locator('[data-control-group-members] [data-member]').count()) === 0);
  const forbidden = await api(page, "POST", "/api/staff/does-not-exist/preset", { preset: "control_group" });
  record("AC5.2-api-error", { forbidden }, forbidden.status === 404);

  // ---------- AC6. Проверяющие и аудиторы
  const iaApi = await api(page, "GET", "/api/staff/inspectors-auditors");
  await goto(page, "/settings/inspectors");
  const external = await page.locator("[data-inspectors-external] li[data-token-status]").count();
  const internal = await page.locator("[data-inspectors-internal] > li").count();
  const issueHref = await page.getByTestId("inspectors-issue-qr").first().getAttribute("href");
  const roleLinks = await page.locator("[data-inspectors-internal] a").evaluateAll((els) => els.map((el) => el.getAttribute("href")));
  await shot(page, "ac6-inspectors", { fullPage: true });
  record(
    "AC6-inspectors",
    { apiStatus: iaApi.status, apiExternal: iaApi.body?.external?.length, apiInternal: iaApi.body?.internal?.length, external, internal, issueHref, roleLinks, tokenHashInApi: JSON.stringify(iaApi.body).includes("tokenHash") },
    iaApi.status === 200 && external === iaApi.body.external.length && internal === iaApi.body.internal.length && issueHref === "/settings/inspector-portal" && !JSON.stringify(iaApi.body).includes("tokenHash")
  );
  await context.close();

  // ---------- AC7. Шапка /settings/users на 1440 и 1280, телефон 390
  for (const kind of ["desktop", "laptop", "mobile"]) {
    const ctx = await newContext(browser, kind);
    const p = await ctx.newPage();
    watchErrors(p, `owner/${kind}`);
    await signIn(p, "admin@haccp.local");
    await goto(p, "/settings/users");
    await p.locator("main h1").first().waitFor({ timeout: 300_000 });
    const header = await p.evaluate(() => {
      const h1 = document.querySelector("main h1");
      const root = h1?.parentElement?.parentElement;
      const width = window.innerWidth;
      const controls = [...(root?.querySelectorAll("a, button") ?? [])].map((el) => {
        const rect = el.getBoundingClientRect();
        return { text: el.textContent.trim().slice(0, 30), left: Math.round(rect.left), right: Math.round(rect.right) };
      });
      return { width, scrollWidth: document.documentElement.scrollWidth, controls, outside: controls.filter((c) => c.right > width || c.left < 0) };
    });
    await shot(p, `ac7-users-${kind}`);
    record(`AC7-users-${kind}`, { width: header.width, scrollWidth: header.scrollWidth, controls: header.controls.length, outside: header.outside }, header.outside.length === 0 && header.scrollWidth <= header.width + 1 && header.controls.length >= 3);
    await ctx.close();
  }

  // ---------- Заведующая: просмотр без кнопок, где правит администратор
  const chefContext = await newContext(browser, "desktop");
  const chef = await chefContext.newPage();
  watchErrors(chef, "headchef");
  await signIn(chef, "chef@haccp.local");
  await goto(chef, "/settings/access");
  const chefAccess = {
    editButtons: await chef.getByTestId("person-preset-edit").count(),
    configure: await chef.getByTestId("access-link-role-presets").count(),
    permissionsBlock: await chef.locator('[data-staff-card="permissions"]').count(),
    menu: await chef.locator('[data-app-sidebar] nav[data-section-menu="staff"] [data-menu-item]').evaluateAll((els) => els.map((el) => el.getAttribute("data-menu-item"))),
  };
  await shot(chef, "headchef-access-readonly", { fullPage: true });
  const chefPreset = await api(chef, "POST", `/api/staff/${idOf("Волкова Анна Дмитриевна")}/preset`, { preset: "control_group" });
  record("AC2.3-headchef-readonly", { ...chefAccess, presetApi: chefPreset.status }, chefAccess.editButtons === 0 && chefAccess.configure === 0 && chefPreset.status === 403);
  await goto(chef, "/settings/control-group");
  const chefCg = { add: await chef.locator("[data-control-group-add]").count(), remove: await chef.getByTestId("control-group-remove").count() };
  record("AC5.2-headchef-readonly", chefCg, chefCg.add === 0);
  await goto(chef, "/settings/positions");
  record("AC1.1-headchef-manage", { create: await chef.getByTestId("position-create").count() }, (await chef.getByTestId("position-create").count()) === 1);
  record("AC8.2-headchef-menu", { menu: chefAccess.menu }, ["positions", "users", "access", "commission", "haccpGroup", "controlGroup", "inspectors"].every((id) => chefAccess.menu.includes(id)) && !chefAccess.menu.includes("responsibles"));
  await chefContext.close();
} finally {
  for (const step of cleanup.reverse()) {
    try {
      await step();
    } catch (error) {
      console.log("  cleanup:", error.message);
    }
  }
  await db.end();
  await browser.close();
  writeJson("scenarios.json", { finishedAt: new Date().toISOString(), results, problems });
  console.log(problems.length ? `ПРОБЛЕМЫ: ${problems.length}` : "Все сценарии прошли");
}
