// e2e части A: «График и учет генеральных уборок» — барабан дат, несколько
// уборок в месяце, операции редактора месяца, задачи TasksFlow по датам.
// Стенд: npx tsx .agent/tasks/general-cleaning-qr-switcher-2026-09/e2e/gc-setup.ts
// Запуск (dev на 3020 с wesetup_e2e): npx tsx .agent/tasks/general-cleaning-qr-switcher-2026-09/e2e/gc-e2e.ts
//
// TasksFlow: моковый сервер на 127.0.0.1:4999 поднимается в этом процессе.
// Очередь (outbox) проигрывается обработчиком крона В ЭТОМ процессе — только
// если в очереди нет чужих ожидающих команд (чужие организации не трогаем).
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";

import { db } from "../../journal-responsibles-org-2026-09/e2e/db";

const BASE = process.env.BASE ?? "http://localhost:3020";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SHOTS = path.join(HERE, "..", "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const state = JSON.parse(fs.readFileSync(path.join(HERE, "gc-state.json"), "utf8"));
const E2E_KEY_SECRET = "gc-e2e-integration-key-secret-2026";
const CRON_SECRET = "gc-e2e-cron-secret";
const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

// Процесс теста: свои секреты для крона и расшифровки ключа TF.
process.env.INTEGRATION_KEY_SECRET = E2E_KEY_SECRET;
process.env.CRON_SECRET = CRON_SECRET;
process.env.NEXTAUTH_URL = BASE;

type Check = { id: string; name: string; ok: boolean; detail?: unknown };
const checks: Check[] = [];
const pageErrors: string[] = [];
/**
 * Ошибки dev-сборки от параллельных правок других агентов (Turbopack HMR:
 * «module factory is not available», «was instantiated because it was
 * required from module») — в отчёт отдельно, в провал не идут.
 */
const foreignErrors: string[] = [];
const HMR_NOISE = /module factory is not available|was instantiated because it was required from module|HMR update/i;
function check(id: string, name: string, ok: boolean, detail?: unknown) {
  checks.push({ id, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${id}] ${name}${detail !== undefined ? ` :: ${JSON.stringify(detail).slice(0, 600)}` : ""}`);
}

function orgToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
function ddmm(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
}

/* ---------------------------------------------------------------- мок TF */
type TfRequest = { method: string; url: string; idempotencyKey: string | null; auth: string | null; body: unknown };
const tfRequests: TfRequest[] = [];
let nextTaskId = 7000;
const tfServer = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : null;
    tfRequests.push({
      method: req.method ?? "",
      url: req.url ?? "",
      idempotencyKey: (req.headers["idempotency-key"] as string) ?? null,
      auth: (req.headers.authorization as string) ?? null,
      body,
    });
    const json = (status: number, payload: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    if (req.method === "POST" && req.url === "/api/tasks") {
      nextTaskId += 1;
      json(200, { id: nextTaskId, isCompleted: false, price: 0, ...body });
      return;
    }
    if (req.method === "DELETE" && /^\/api\/tasks\/\d+$/.test(req.url ?? "")) {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === "POST" && /^\/api\/tasks\/\d+\/complete$/.test(req.url ?? "")) {
      json(200, { id: Number(req.url?.split("/")[3]), isCompleted: true });
      return;
    }
    json(200, []);
  });
});

async function runOutbox(label: string): Promise<boolean> {
  const foreign = await db.tasksFlowOutbox.count({
    where: { status: "pending", organizationId: { not: state.orgId } },
  });
  if (foreign > 0) {
    check(label, "outbox: в очереди есть чужие команды — проигрывание пропущено", false, { foreign });
    return false;
  }
  const { GET } = await import("../../../../src/app/api/cron/tasksflow-outbox/route");
  const response = await GET(new Request(`http://local/api/cron/tasksflow-outbox?secret=${CRON_SECRET}`));
  const body = await response.json();
  console.log(`   outbox ${label}:`, JSON.stringify(body));
  return true;
}

/* ---------------------------------------------------------------- браузер */
async function login(context: BrowserContext, email: string) {
  await context.addInitScript(
    `document.addEventListener("DOMContentLoaded",function(){var s=document.createElement("style");s.textContent="nextjs-portal{display:none!important}";document.head.appendChild(s)})`,
  );
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 600_000 });
  for (let i = 0; i < 30; i += 1) {
    await page.fill("#email", email);
    await page.fill("#password", state.password);
    if ((await page.inputValue("#email")) === email) break;
    await page.waitForTimeout(300);
  }
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 600_000 });
  await page.close();
}

async function dismissOverlays(page: Page) {
  const terms = page.getByRole("button", { name: "Принять и продолжить" });
  if (await terms.isVisible().catch(() => false)) {
    await page.locator("div.fixed.inset-0 input[type=checkbox]").first().check();
    await terms.click();
    await terms.waitFor({ state: "hidden", timeout: 15_000 }).catch(() => null);
  }
  await page
    .locator('[aria-labelledby="whats-new-title"] button[aria-label="Закрыть"]')
    .click({ timeout: 2_000 })
    .catch(() => {});
  const guide = page.locator('[role="dialog"][aria-labelledby="fill-guide-title"]');
  if (await guide.isVisible().catch(() => false)) {
    await guide.getByRole("button", { name: "Понятно" }).first().click().catch(() => null);
  }
}

function watchErrors(page: Page) {
  const record = (text: string) => {
    (HMR_NOISE.test(text) ? foreignErrors : pageErrors).push(text.slice(0, 1500));
  };
  page.on("pageerror", (error) => record(`pageerror ${page.url()}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Failed to load resource|telegram\.org|DevTools|favicon|net::ERR|hydrat/i.test(text)) return;
    record(`console ${page.url()}: ${text}`);
  });
}

async function loadDoc(docId: string) {
  const doc = await db.journalDocument.findUniqueOrThrow({ where: { id: docId } });
  return doc.config as {
    year: number;
    rows: Array<{
      id: string;
      roomId?: string;
      roomName: string;
      plan: Record<string, string>;
      fact: Record<string, string>;
      cleanings: Array<{ id: string; planned: string | null; done: string | null; doneBy?: string; doneSource?: string }>;
    }>;
  };
}

async function monthCell(page: Page, room: string, kind: "план" | "выполнено", monthIndex: number) {
  return page
    .getByRole("button", {
      name: new RegExp(`^${MONTHS[monthIndex]}, ${room.replace(/[()]/g, "\\$&")}: ${kind}`),
    })
    .first();
}

async function main() {
  await new Promise<void>((resolve) => tfServer.listen(4999, "127.0.0.1", resolve));
  const today = orgToday();
  const monthIndex = Number(today.slice(5, 7)) - 1;
  const kitchenId = state.roomIds["Кухня (e2e)"];
  const storageId = state.roomIds["Склад (e2e)"];
  const barId = state.roomIds["Бар (e2e)"];
  const kitchenRowId = `row-room-${kitchenId}`;
  const todayRowKey = `gc::${kitchenRowId}::${today}`;

  const browser = await chromium.launch({ channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
  await login(context, state.managerEmail);
  const page = await context.newPage();
  watchErrors(page);

  /* ---------------- A-1: создание документа, барабан даты, план по графику */
  await page.goto(`${BASE}/journals/general_cleaning`, { waitUntil: "load", timeout: 600_000 });
  await page.waitForTimeout(1500);
  await dismissOverlays(page);
  await page.getByRole("button", { name: /Создать документ/ }).first().click({ timeout: 120_000 });
  const dialog = page.getByRole("dialog").filter({ hasText: "Создание документа" });
  await dialog.waitFor({ timeout: 60_000 });
  await dismissOverlays(page);
  const dateLabel = await dialog.getByText("Дата документа", { exact: true }).count();
  check("A-1a", "в окне создания поле «Дата документа»", dateLabel > 0);
  await dialog.getByRole("button", { name: "Выбрать дату" }).click();
  const daySpin = page.getByRole("spinbutton", { name: "День" });
  await daySpin.waitFor({ timeout: 30_000 });
  const spinCount = await page.getByRole("spinbutton").count();
  const dayBefore = Number(await daySpin.getAttribute("aria-valuenow"));
  await daySpin.focus();
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(700);
  const dayAfter = Number(await daySpin.getAttribute("aria-valuenow"));
  const valueText = await daySpin.getAttribute("aria-valuetext");
  await page.screenshot({ path: path.join(SHOTS, "gc-a1-wheel-date.png") });
  check("A-1b", "барабан «день | месяц | год», стрелка вниз — следующий день", spinCount === 3 && dayAfter !== dayBefore, {
    spinCount,
    dayBefore,
    dayAfter,
    valueText,
  });
  await page.getByRole("button", { name: "Готово" }).click();
  const typed = await dialog.locator("input[placeholder='ДД.ММ.ГГГГ']").inputValue();
  check("A-1c", "дата с барабана попала в поле ДД.ММ.ГГГГ", /^\d{2}\.\d{2}\.\d{4}$/.test(typed), typed);
  await dialog.getByRole("button", { name: /^Создать$/ }).click();
  await page.waitForURL(/\/journals\/general_cleaning\/documents\//, { timeout: 180_000 });
  const docId = page.url().split("/documents/")[1].split(/[?#]/)[0];
  await page.waitForTimeout(1500);
  await dismissOverlays(page);
  let cfg = await loadDoc(docId);
  const kitchenRow = cfg.rows.find((r) => r.roomId === kitchenId);
  const storageRow = cfg.rows.find((r) => r.roomId === storageId);
  const barRow = cfg.rows.find((r) => r.roomId === barId);
  const kitchenDates = kitchenRow?.cleanings.map((c) => c.planned) ?? [];
  const fridaysOk =
    kitchenDates.length > 0 &&
    kitchenDates.every((d) => d && d >= today && new Date(`${d}T00:00:00Z`).getUTCDay() === 5);
  const storageDates = storageRow?.cleanings.map((c) => c.planned ?? "") ?? [];
  const storageOk =
    storageDates.length > 0 &&
    storageDates.every((d) => {
      const day = Number(d.slice(8, 10));
      const last = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0)).getUTCDate();
      return d >= today && (day === 1 || day === 15 || day === last);
    });
  check("A-1d", "план сразу по графику помещений: пятницы / 1, 15, последний; без графика — пусто", fridaysOk && storageOk && (barRow?.cleanings.length ?? -1) === 0, {
    kitchen: kitchenDates.slice(0, 5),
    storage: storageDates.slice(0, 5),
    bar: barRow?.cleanings.length,
    year: cfg.year,
  });
  const monthKey = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"][monthIndex];
  check("A-1e", "строка «План» — проекция дат («DD, DD»)", /^\d{2}(, \d{2})*$/.test(kitchenRow?.plan[monthKey] ?? ""), kitchenRow?.plan[monthKey]);

  /* ---------------- A-2: редактор месяца, добавить сегодняшнюю дату */
  const planCell = await monthCell(page, "Кухня (e2e)", "план", monthIndex);
  await planCell.waitFor({ timeout: 60_000 });
  await planCell.click();
  const popover = page.locator('[data-slot="popover-content"]').filter({ hasText: "Кухня (e2e)" });
  await popover.waitFor({ timeout: 30_000 });
  const scheduleText = await popover.getByText("каждую пятницу").count();
  const tfHint = await popover.getByText("В день уборки исполнитель получит задачу в TasksFlow").count();
  await page.screenshot({ path: path.join(SHOTS, "gc-a2-month-editor.png") });
  check("A-2a", "редактор месяца: график помещения и подсказка про TasksFlow", scheduleText > 0 && tfHint > 0, { scheduleText, tfHint });
  await popover.getByRole("button", { name: "Добавить дату" }).click();
  const addSpin = popover.getByRole("spinbutton");
  await addSpin.waitFor({ timeout: 15_000 });
  const addConfirm = popover.getByRole("button", { name: new RegExp(`^Добавить ${ddmm(today).replace(".", "\\.")}`) });
  const addLabel = await addConfirm.textContent().catch(() => null);
  await page.screenshot({ path: path.join(SHOTS, "gc-a2-add-wheel.png") });
  check("A-2b", "«Добавить дату»: по умолчанию ближайший свободный день (сегодня)", Boolean(addLabel), addLabel);
  await addConfirm.click();
  await popover.getByRole("button", { name: "Добавить дату" }).waitFor({ timeout: 30_000 });
  cfg = await loadDoc(docId);
  const kitchenAfterAdd = cfg.rows.find((r) => r.roomId === kitchenId);
  check(
    "A-2c",
    "дата в плане (операция под блокировкой), проекция обновлена",
    Boolean(kitchenAfterAdd?.cleanings.some((c) => c.planned === today && !c.done)) &&
      (kitchenAfterAdd?.plan[monthKey] ?? "").includes(today.slice(8, 10)),
    kitchenAfterAdd?.plan[monthKey],
  );
  const audit = await db.auditLog.count({ where: { organizationId: state.orgId, action: "general_cleaning.op", entityId: docId } });
  check("A-2d", "AuditLog general_cleaning.op записан", audit > 0, audit);

  /* ---------------- A-5: задача TasksFlow на сегодняшнюю дату через outbox */
  let createRow = null as null | { status: string; payload: unknown; idempotencyKey: string };
  for (let i = 0; i < 40 && !createRow; i += 1) {
    createRow = await db.tasksFlowOutbox.findFirst({
      where: { organizationId: state.orgId, action: "createTask" },
      select: { status: true, payload: true, idempotencyKey: true },
    });
    if (!createRow) await page.waitForTimeout(500);
  }
  const payload = (createRow?.payload ?? {}) as { rowKey?: string; task?: Record<string, unknown> };
  check(
    "A-5a",
    "команда createTask в outbox: разовая, ключ gc-create::doc::строка::дата",
    createRow?.idempotencyKey === `gc-create::${docId}::${kitchenRowId}::${today}` &&
      payload.rowKey === todayRowKey &&
      payload.task?.isRecurring === false &&
      payload.task?.workerId === 501 &&
      payload.task?.verifierWorkerId === 502,
    { key: createRow?.idempotencyKey, rowKey: payload.rowKey, task: payload.task },
  );
  if (await runOutbox("A-5b")) {
    const post = tfRequests.find((r) => r.method === "POST" && r.url === "/api/tasks");
    const link = await db.tasksFlowTaskLink.findFirst({
      where: { integrationId: state.integrationId, journalDocumentId: docId, rowKey: todayRowKey },
    });
    const journalLink = JSON.parse(String((post?.body as { journalLink?: string })?.journalLink ?? "{}"));
    check(
      "A-5b",
      "TF получил задачу «Генеральная уборка · Кухня (e2e) · DD.MM (дн)», создана ссылка",
      Boolean(post) &&
        String((post?.body as { title?: string })?.title).startsWith(`Генеральная уборка · Кухня (e2e) · ${ddmm(today)}`) &&
        post?.idempotencyKey === `gc-create::${docId}::${kitchenRowId}::${today}` &&
        post?.auth === "Bearer tfk_gc_e2e_key_0000000000" &&
        journalLink.kind === "wesetup-general_cleaning" &&
        journalLink.rowKey === todayRowKey &&
        Boolean(link),
      { title: (post?.body as { title?: string })?.title, key: post?.idempotencyKey, linkId: link?.id },
    );
  }

  /* ---------------- A-7: перенос сегодняшней даты → удаление задачи в TF */
  const todaySlot = popover.getByRole("button", { name: new RegExp(`^${today.slice(8, 10)}${ddmm(today).replace(".", "\\.")}`) });
  const slotButton = (await todaySlot.count()) > 0
    ? todaySlot.first()
    : popover.locator("li button[aria-expanded]").filter({ hasText: ddmm(today) }).first();
  await slotButton.click();
  await popover.getByRole("button", { name: "Перенести" }).click();
  const moveConfirm = popover.getByRole("button", { name: /^Перенести на / });
  await moveConfirm.waitFor({ timeout: 15_000 });
  const moveLabel = await moveConfirm.textContent();
  await page.screenshot({ path: path.join(SHOTS, "gc-a7-move-wheel.png") });
  await moveConfirm.click();
  await popover.getByRole("button", { name: "Добавить дату" }).waitFor({ timeout: 30_000 });
  cfg = await loadDoc(docId);
  const moved = cfg.rows.find((r) => r.roomId === kitchenId);
  const movedTo = addDays(today, 1);
  check(
    "A-7a",
    "«Перенести»: сегодняшняя дата ушла из плана, новая — в плане",
    !moved?.cleanings.some((c) => c.planned === today) && Boolean(moved?.cleanings.some((c) => c.planned === movedTo || (moveLabel ?? "").includes(ddmm(c.planned ?? "")))),
    { moveLabel, dates: moved?.cleanings.map((c) => c.planned).slice(0, 6) },
  );
  let deleteRow = null as null | { status: string; payload: unknown };
  for (let i = 0; i < 40 && !deleteRow; i += 1) {
    deleteRow = await db.tasksFlowOutbox.findFirst({
      where: { organizationId: state.orgId, action: "deleteTask", idempotencyKey: { startsWith: `gc-delete::${docId}::` } },
      select: { status: true, payload: true },
    });
    if (!deleteRow) await page.waitForTimeout(500);
  }
  const linkAfterMove = await db.tasksFlowTaskLink.findFirst({
    where: { integrationId: state.integrationId, journalDocumentId: docId, rowKey: todayRowKey },
  });
  check("A-7b", "дата убрана → deleteTask в outbox, ссылка удалена", Boolean(deleteRow) && !linkAfterMove, deleteRow);
  if (await runOutbox("A-7c")) {
    const del = tfRequests.find((r) => r.method === "DELETE");
    check("A-7c", "TF получил DELETE задачи", Boolean(del), del?.url);
  }

  /* ---------------- A-5c: дату вернули — команда снова в очереди (новое поколение) */
  await popover.getByRole("button", { name: "Добавить дату" }).click();
  await popover.getByRole("button", { name: new RegExp(`^Добавить ${ddmm(today).replace(".", "\\.")}`) }).click();
  await popover.getByRole("button", { name: "Добавить дату" }).waitFor({ timeout: 30_000 });
  let requeued = null as null | { status: string; payload: unknown };
  for (let i = 0; i < 40; i += 1) {
    requeued = await db.tasksFlowOutbox.findFirst({
      where: { organizationId: state.orgId, idempotencyKey: `gc-create::${docId}::${kitchenRowId}::${today}` },
      select: { status: true, payload: true },
    });
    if (requeued?.status === "pending") break;
    await page.waitForTimeout(500);
  }
  check(
    "A-5c",
    "дату вернули в план — createTask снова pending, поколение 1",
    requeued?.status === "pending" && (requeued?.payload as { generation?: number })?.generation === 1,
    requeued,
  );
  if (await runOutbox("A-5d")) {
    const posts = tfRequests.filter((r) => r.method === "POST" && r.url === "/api/tasks");
    check(
      "A-5d",
      "повторное создание уходит с Idempotency-Key …#g1",
      posts.length === 2 && posts[1].idempotencyKey === `gc-create::${docId}::${kitchenRowId}::${today}#g1`,
      posts.map((p) => p.idempotencyKey),
    );
  }

  /* ---------------- A-6: выполнение задачи → отметка ровно этой даты; устаревший PATCH её не стирает */
  const staleConfig = (await db.journalDocument.findUniqueOrThrow({ where: { id: docId } })).config;
  const { sanitationDayAdapter } = await import("../../../../src/lib/tasksflow-adapters/sanitation-day");
  const applied = await sanitationDayAdapter.applyRemoteCompletion({
    documentId: docId,
    rowKey: todayRowKey,
    completed: true,
    todayKey: today,
  });
  cfg = await loadDoc(docId);
  const markedSlot = cfg.rows.find((r) => r.roomId === kitchenId)?.cleanings.find((c) => c.planned === today);
  check("A-6a", "выполнение задачи TF отметило ровно эту дату (doneSource: task)", applied && markedSlot?.done === today && markedSlot?.doneSource === "task", markedSlot);
  const stalePatch = await page.request.patch(`${BASE}/api/journal-documents/${docId}`, {
    data: { config: staleConfig },
  });
  cfg = await loadDoc(docId);
  const afterStale = cfg.rows.find((r) => r.roomId === kitchenId)?.cleanings.find((c) => c.planned === today);
  check("A-6b", "PATCH устаревшим конфигом не стирает отметку задачи", stalePatch.ok() && afterStale?.done === today, {
    status: stalePatch.status(),
    slot: afterStale,
  });

  /* ---------------- A-3: отметить выполненной (барабан, не позже сегодня) */
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(1500);
  await dismissOverlays(page);
  await (await monthCell(page, "Кухня (e2e)", "план", monthIndex)).click();
  await popover.waitFor({ timeout: 30_000 });
  const movedSlotDate = cfg.rows
    .find((r) => r.roomId === kitchenId)
    ?.cleanings.find((c) => c.planned && c.planned > today && !c.done && c.planned <= addDays(today, 7))?.planned;
  if (movedSlotDate && movedSlotDate.slice(5, 7) === today.slice(5, 7)) {
    await popover.locator("li button[aria-expanded]").filter({ hasText: ddmm(movedSlotDate) }).first().click();
    await popover.getByRole("button", { name: "Отметить выполненной" }).click();
    const markSpin = popover.getByRole("spinbutton");
    await markSpin.waitFor({ timeout: 15_000 });
    await markSpin.focus();
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(700);
    const markConfirm = popover.getByRole("button", { name: /^Отметить \d\d\.\d\d/ });
    const markLabel = await markConfirm.textContent();
    await page.screenshot({ path: path.join(SHOTS, "gc-a3-mark-done.png") });
    await markConfirm.click();
    await popover.getByRole("button", { name: "Добавить дату" }).waitFor({ timeout: 30_000 });
    cfg = await loadDoc(docId);
    const doneSlot = cfg.rows.find((r) => r.roomId === kitchenId)?.cleanings.find((c) => c.planned === movedSlotDate);
    check(
      "A-3",
      "«Отметить выполненной»: день с барабана (раньше плана, не позже сегодня), doneBy — руководитель",
      Boolean(doneSlot?.done) &&
        (doneSlot?.done as string) <= today &&
        doneSlot?.doneSource === "manual" &&
        doneSlot?.doneBy === state.managerId,
      { markLabel, doneSlot },
    );
  } else {
    check("A-3", "нет будущей даты этого месяца в пределах недели для отметки", false, { movedSlotDate });
  }

  /* ---------------- A-4: внеплановая уборка (сегодня уже отмечено — барабан уводит на свободный день) */
  await popover.getByRole("button", { name: "Внеплановая уборка" }).click();
  const unplannedSpin = popover.getByRole("spinbutton");
  await unplannedSpin.waitFor({ timeout: 15_000 });
  await unplannedSpin.focus();
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(700);
  const unplannedConfirm = popover.getByRole("button", { name: /^Отметить \d\d\.\d\d/ });
  const unplannedLabel = await unplannedConfirm.textContent().catch(() => null);
  await page.screenshot({ path: path.join(SHOTS, "gc-a4-unplanned.png") });
  if (unplannedLabel) {
    await unplannedConfirm.click();
    await popover.getByRole("button", { name: "Добавить дату" }).waitFor({ timeout: 30_000 });
  }
  cfg = await loadDoc(docId);
  const unplanned = cfg.rows.find((r) => r.roomId === kitchenId)?.cleanings.filter((c) => !c.planned) ?? [];
  check(
    "A-4",
    "внеплановая уборка: только прошедший день, в «Факт», без плановой даты",
    unplanned.length === 1 && (unplanned[0].done as string) < today && unplanned[0].id === `u:${unplanned[0].done}`,
    { unplannedLabel, unplanned },
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  /* ---------------- A-8: «Заполнить план по графику помещений» — предпросмотр */
  await page.getByRole("button", { name: "Заполнить план по графику помещений" }).click();
  const fillDialog = page.getByRole("dialog").filter({ hasText: "Заполнить план по графику помещений" });
  await fillDialog.waitFor({ timeout: 30_000 });
  const noSchedule = await fillDialog.getByText("в карточке помещения нет графика — пропустим").count();
  await fillDialog.getByRole("radio", { name: /Обновить будущие даты/ }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, "gc-a8-fill-preview.png") });
  const confirmText = await fillDialog.getByRole("button", { name: /Заполнить:|Менять нечего/ }).textContent();
  check("A-8", "предпросмотр заполнения: строки, режимы, без графика — пропуск", noSchedule > 0 && Boolean(confirmText), {
    noSchedule,
    confirmText,
  });
  await fillDialog.getByRole("button", { name: "Отмена" }).click();

  /* ---------------- A-9: телефон — карточки и годовой лист */
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "ru-RU",
    hasTouch: true,
    isMobile: true,
  });
  await login(mobile, state.managerEmail);
  const phone = await mobile.newPage();
  watchErrors(phone);
  await phone.goto(`${BASE}/journals/general_cleaning/documents/${docId}`, { waitUntil: "load", timeout: 600_000 });
  await phone.waitForTimeout(1500);
  await dismissOverlays(phone);
  const cardsToggle = phone.getByRole("button", { name: /Карточки/ }).first();
  if (await cardsToggle.isVisible().catch(() => false)) await cardsToggle.click();
  await phone.waitForTimeout(500);
  const summaryVisible = await phone.getByText("Уборки:").first().isVisible().catch(() => false);
  const yearAction = phone.getByRole("button", { name: "изменить" }).first();
  let sheetOk = false;
  if (await yearAction.isVisible().catch(() => false)) {
    await yearAction.click();
    await phone.getByText(`График генеральных уборок на ${cfg.year} год`).waitFor({ timeout: 15_000 }).catch(() => null);
    await phone.screenshot({ path: path.join(SHOTS, "gc-a9-year-sheet.png") });
    await phone.getByRole("button", { name: new RegExp(`^${MONTHS[monthIndex]}`) }).first().click().catch(() => null);
    await phone.waitForTimeout(600);
    sheetOk = (await phone.getByRole("button", { name: "Все месяцы" }).count()) > 0;
    await phone.screenshot({ path: path.join(SHOTS, "gc-a9-month-in-sheet.png") });
  }
  check("A-9", "телефон: сводка на карточке, годовой лист → месяц в том же листе", sheetOk && summaryVisible, {
    sheetOk,
    summaryVisible,
  });

  check("A-10", "без ошибок страницы / консоли", pageErrors.length === 0, pageErrors.slice(0, 10));

  await browser.close();
  tfServer.close();
  const summary = { passed: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok).length };
  fs.writeFileSync(
    path.join(HERE, "gc-e2e.json"),
    JSON.stringify(
      { at: new Date().toISOString(), docId, today, summary, checks, tfRequests, pageErrors, foreignErrors },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(summary));
  if (summary.failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    tfServer.close();
    await db.$disconnect();
  });
