import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { forgetSessionVersions } from "@/lib/session-version";
import { createRateLimiter } from "@/lib/rate-limit";
import { userHasPermission } from "@/lib/permissions-server";
import { canWriteJournal } from "@/lib/journal-acl";
import { isManagementRole, getUserDisplayTitle } from "@/lib/user-roles";
import { ORG_ROSTER_WHERE } from "@/lib/journal-roster";
import { getOrgCustomNames } from "@/lib/org-custom-names";
import { journalDisplayName } from "@/lib/custom-names";
import { parseDisabledCodes } from "@/lib/disabled-journals";
import { orderHubJournals } from "@/lib/hub-journals-order";
import {
  OBJECT_QR_JOURNAL_CODES,
  OBJECT_QR_JOURNAL_HINTS,
  journalFillCodeBlock,
  listHubJournals,
  listJournalFillDocuments,
  loadJournalFillForm,
  loadOrganizationForFill,
  resolveJournalFillRows,
  todayKeyFor,
} from "@/lib/journal-fill";
import { submitJournalFill } from "@/lib/journal-fill-submit";
import { journalFillHints } from "@/lib/journal-fill-hints";
import { ensureQrPeriodDocuments } from "@/lib/journal-qr-rollover";
import { isNameSuggestionScope } from "@/lib/name-suggestions";
import { listNameSuggestions } from "@/lib/name-suggestions-db";
import { mintQrFillToken } from "@/lib/qr-fill-token";
import { stampFor } from "@/lib/quick-values";
import { rowKeyForEmployee } from "@/lib/tasksflow-adapters/row-key";
import type { TaskFormSchema } from "@/lib/tasksflow-adapters/task-form";
import { syncDailyJournalObligationsForOrganization, syncDailyJournalObligationsForUser } from "@/lib/journal-obligations";
import { scheduleObligationSync, utcDayKey } from "@/lib/obligation-sync-throttle";
import { documentInWorkerScope, documentWorkerScopeWhere, loadWorkerPointScope } from "@/lib/worker-point-scope";
import { maxAnswer, maxApi, maxSend, type MaxView } from "./client";
import { maxConfig } from "./config";
import { claimMaxLink, MaxError, maxAccount, maxContext, maxOrganizations } from "./service";
import { type MaxEvent, maxUpdateKey, parseMaxUpdate } from "./protocol";
import { newWizardId, parseMaxBotState, parseWizardPayload, wizardPayload, type MaxFillState } from "./bot-state";
import { answerFill, fillSubmission, renderFill, type FillContext, type FillInput } from "./bot-fill";
import {
  type BotTask,
  type SummaryRow,
  helpView,
  inviteForwardText,
  inviteIssuedView,
  inviteListView,
  journalsView,
  menuView,
  messageView,
  objectJournalView,
  organizationsView,
  parseBotPayload,
  reminderMessage,
  remindConfirmView,
  summaryView,
  todayView,
  unlinkedView,
} from "./bot-views";
import { claimMaxInvite, issueMaxInvite, MAX_INVITE_TTL_DAYS, parseMaxInvitePayload } from "./invite";

/**
 * Бот MAX без мини-сайта: меню, задачи дня, пошаговое заполнение журналов,
 * сводка и напоминания руководителя, подключение сотрудников — всё
 * кнопками в чате. Запись — общим ядром QR-форм (`submitJournalFill`).
 */
type Ctx = Awaited<ReturnType<typeof maxContext>>;
type Identity = NonNullable<Awaited<ReturnType<typeof findIdentity>>>;

const REMIND_INTERVAL_MS = 30 * 60_000;
const actionLimiter = createRateLimiter({ tokensPerInterval: 60, intervalMs: 60_000 });

function findIdentity(maxUserId: string) {
  return db.maxIdentity.findUnique({ where: { maxUserId } });
}

/** Нажатие — заменяем то же сообщение; сообщение — отвечаем новым. */
async function respond(event: MaxEvent, view: MaxView) {
  if (event.callbackId) {
    try {
      await maxAnswer(event.callbackId, { view });
      return;
    } catch {
      // Ответ на нажатие не принят — показываем экран новым сообщением.
    }
  }
  await maxSend(event.chatId, view.text, view.buttons);
}

function dateLabel(timezone: string | null | undefined): string {
  return stampFor(timezone || "Europe/Moscow").date;
}

function isManager(ctx: Ctx): boolean {
  return ctx.user.isRoot || ctx.user.canManageSettings || isManagementRole(ctx.actor.role);
}

/** Заполнять из бота можно в своей организации и с правом заполнения. */
async function fillAccess(ctx: Ctx): Promise<{ ok: true } | { ok: false; note: string }> {
  if (ctx.user.isRoot) return { ok: false, note: "Вы вошли как администратор платформы: журналы заполняют сотрудники организации." };
  if (ctx.organizationId !== ctx.user.organizationId) return { ok: false, note: "Заполнять журналы из бота можно в своей организации. Здесь доступны сводка, напоминания и подключение сотрудников." };
  if (!(await userHasPermission(ctx.user.id, "journals.fill"))) return { ok: false, note: "Заполнение журналов вам не назначено. Обратитесь к руководителю." };
  return { ok: true };
}

function aclActor(ctx: Ctx) {
  return { id: ctx.user.id, role: ctx.actor.role, isRoot: ctx.user.isRoot };
}

async function displayNames(organizationId: string) {
  const names = await getOrgCustomNames(organizationId);
  return (code: string, official: string) => journalDisplayName(names, code, official);
}

/** Задачи сотрудника на сегодня — обязательства дня, как в мини-приложении Telegram. */
async function loadTasks(ctx: Ctx): Promise<BotTask[]> {
  const now = new Date();
  const dateKey = utcDayKey(now);
  try {
    const hasRows = (await db.journalObligation.count({ where: { userId: ctx.user.id, dateKey } })) > 0;
    await scheduleObligationSync(`user:${ctx.user.id}`, () => syncDailyJournalObligationsForUser({ userId: ctx.user.id, organizationId: ctx.organizationId, now }), { force: !hasRows });
  } catch (error) {
    console.error("[max:bot] obligation sync failed", error instanceof Error ? error.name : "UnknownError");
  }
  const [rows, name] = await Promise.all([
    db.journalObligation.findMany({
      where: { userId: ctx.user.id, organizationId: ctx.organizationId, dateKey },
      select: { journalCode: true, status: true, template: { select: { name: true } } },
    }),
    displayNames(ctx.organizationId),
  ]);
  const byCode = new Map<string, BotTask>();
  for (const row of rows) {
    const existing = byCode.get(row.journalCode);
    const done = row.status === "done" && (existing?.done ?? true);
    byCode.set(row.journalCode, { code: row.journalCode, name: name(row.journalCode, row.template.name), done, object: OBJECT_QR_JOURNAL_CODES.has(row.journalCode) });
  }
  return orderHubJournals([...byCode.values()].filter((task) => !task.object), [...byCode.values()].filter((task) => task.object));
}

/** Журналы, которые можно заполнить сегодня: документ есть (или продолжится новым периодом) и есть право записи. */
async function loadFillableJournals(ctx: Ctx) {
  const org = await loadOrganizationForFill(ctx.organizationId);
  if (!org) throw new MaxError("Организация недоступна.", 403);
  const todayKey = todayKeyFor(org.timezone);
  const disabled = [...parseDisabledCodes(org.disabledJournalCodes)];
  const hub = await listHubJournals(ctx.organizationId, disabled, todayKey, { includeLapsed: true, includeObjects: true });
  const codes = hub.map((item) => item.code);
  // Хаб QR объединяет гигиену и здоровье в одну отметку; в боте это два журнала.
  if (codes.includes("hygiene") && !codes.includes("health_check") && !disabled.includes("health_check")) {
    if ((await listJournalFillDocuments(ctx.organizationId, "health_check", todayKey)).length > 0) codes.push("health_check");
  }
  const [templates, name] = await Promise.all([
    db.journalTemplate.findMany({ where: { code: { in: codes }, isActive: true }, select: { code: true, name: true } }),
    displayNames(ctx.organizationId),
  ]);
  const actor = aclActor(ctx);
  const writable = await Promise.all(templates.map(async (template) => ((await canWriteJournal(actor, template.code)) ? template : null)));
  const items = writable.filter((item): item is NonNullable<typeof item> => item !== null).map((template) => ({ code: template.code, name: name(template.code, template.name), object: OBJECT_QR_JOURNAL_CODES.has(template.code) }));
  return orderHubJournals(items.filter((item) => !item.object), items.filter((item) => item.object));
}

async function menuScreen(ctx: Ctx): Promise<MaxView> {
  const [access, orgs] = await Promise.all([fillAccess(ctx), maxOrganizations(ctx.user.id)]);
  const tasks = access.ok ? await loadTasks(ctx) : [];
  const org = await db.organization.findUnique({ where: { id: ctx.organizationId }, select: { timezone: true } });
  return menuView({
    userName: ctx.user.name,
    organizationName: ctx.organization.name,
    dateLabel: dateLabel(org?.timezone),
    canFill: access.ok,
    fillNote: access.ok ? null : access.note,
    tasks,
    manager: isManager(ctx),
    multipleOrganizations: orgs.length > 1,
  });
}

// ---------- Состояние заполнения ----------

async function saveState(identityId: string, state: MaxFillState | null) {
  await db.maxIdentity.update({ where: { id: identityId }, data: { botState: state ?? Prisma.DbNull, botStateAt: state ? new Date() : null } });
}

/** Сохранить, только если состояние не менялось с чтения: двойное нажатие не запишет дважды. */
async function swapState(identity: Identity, state: MaxFillState | null): Promise<boolean> {
  const result = await db.maxIdentity.updateMany({
    where: { id: identity.id, botStateAt: identity.botStateAt },
    data: { botState: state ?? Prisma.DbNull, botStateAt: state ? new Date() : null },
  });
  return result.count === 1;
}

function currentState(identity: Identity): MaxFillState | null {
  return parseMaxBotState(identity.botState, identity.botStateAt);
}

async function fillContext(state: MaxFillState, ctx: Ctx): Promise<{ form: TaskFormSchema; fctx: FillContext } | null> {
  if (!state.documentId || !state.rowKey) return null;
  const org = await loadOrganizationForFill(state.orgId);
  if (!org) return null;
  const todayKey = todayKeyFor(org.timezone);
  const form = await loadJournalFillForm(state.code, state.documentId, state.rowKey, todayKey);
  if (!form) return null;
  const hints = journalFillHints(state.code);
  const timezone = org.timezone || "Europe/Moscow";
  const suggestions: Record<string, string[]> = {};
  const key = form.fields[state.step]?.key;
  const scope = key ? hints.nameFields?.[key] : undefined;
  if (key && scope && isNameSuggestionScope(scope) && state.phase === "field") {
    suggestions[key] = (await listNameSuggestions(state.orgId, scope).catch(() => ({ values: [] as string[] }))).values.slice(0, 6);
  }
  return {
    form,
    fctx: {
      form,
      hints,
      suggestions,
      stamp: stampFor(timezone),
      todayKey,
      employeeName: ctx.user.name,
      timeAgo: (minutes) => stampFor(timezone, new Date(Date.now() - minutes * 60_000)).time,
    },
  };
}

/** Показать шаг: состояние сохраняется с новым `seq`, старые кнопки перестают действовать. */
async function showFill(event: MaxEvent, identity: Identity, ctx: Ctx, state: MaxFillState) {
  // Пределы схемы состояния: длинный текст ошибки ядра не должен сделать состояние нечитаемым.
  const next = { ...state, seq: state.seq + 1, notice: state.notice ? state.notice.slice(0, 1000) : null };
  if (next.phase === "document" || next.phase === "row") {
    const rendered = renderFill(next, { form: { fields: [] }, hints: {}, suggestions: {}, stamp: { date: "", time: "" }, todayKey: "", employeeName: ctx.user.name, timeAgo: () => "" });
    await saveState(identity.id, rendered.state);
    await respond(event, rendered.view);
    return;
  }
  const loaded = await fillContext(next, ctx);
  if (!loaded) {
    await saveState(identity.id, null);
    await respond(event, messageView("Форма журнала сейчас недоступна. Попробуйте ещё раз через минуту или заполните журнал по QR-коду."));
    return;
  }
  const keys = loaded.form.fields.map((field) => field.key);
  let current = next;
  if (current.keys.length === 0) current = { ...current, keys };
  else if (current.keys.join("|") !== keys.join("|")) {
    current = { ...current, keys, step: 0, phase: "field", values: {}, off: [], correction: null, editing: false, notice: "Форма журнала изменилась — начнём сначала." };
  }
  const rendered = renderFill(current, loaded.fctx);
  await saveState(identity.id, rendered.state);
  await respond(event, rendered.view);
}

async function chooseRow(event: MaxEvent, identity: Identity, ctx: Ctx, state: MaxFillState, documentId: string, documentTitle: string) {
  const resolved = await resolveJournalFillRows({ orgId: state.orgId, code: state.code, documentId, employeeId: ctx.user.id });
  const base = { ...state, documentId, documentTitle: documentTitle.slice(0, 300), choices: [] };
  if (resolved.perEmployee) return showFill(event, identity, ctx, { ...base, rowKey: rowKeyForEmployee(ctx.user.id), phase: "field", step: 0 });
  if (resolved.rows.length === 0) {
    await saveState(identity.id, null);
    return respond(event, messageView(`В документе «${documentTitle}» нет строк для заполнения. Попросите руководителя проверить документ.`));
  }
  const rows = [...resolved.rows].sort((a, b) => Number(b.mine) - Number(a.mine));
  if (rows.length === 1) return showFill(event, identity, ctx, { ...base, rowKey: rows[0].rowKey, rowLabel: rows[0].label, phase: "field", step: 0 });
  const choices = rows.slice(0, 28).map((row) => ({ id: row.rowKey, label: `${row.mine ? "★ " : ""}${row.label}${row.sublabel ? ` · ${row.sublabel}` : ""}`.slice(0, 120) }));
  return showFill(event, identity, ctx, { ...base, phase: "row", choices });
}

async function startFill(event: MaxEvent, identity: Identity, ctx: Ctx, code: string, documentId: string | null) {
  const access = await fillAccess(ctx);
  if (!access.ok) return respond(event, messageView(access.note));
  const [template, org, name] = await Promise.all([
    db.journalTemplate.findFirst({ where: { code, isActive: true }, select: { name: true } }),
    loadOrganizationForFill(ctx.organizationId),
    displayNames(ctx.organizationId),
  ]);
  if (!template || !org) return respond(event, messageView("Такого журнала нет. Откройте список журналов заново."));
  const journalName = name(code, template.name).slice(0, 300);
  if (OBJECT_QR_JOURNAL_CODES.has(code)) return respond(event, objectJournalView({ name: journalName, hint: OBJECT_QR_JOURNAL_HINTS[code] ?? "Этот журнал заполняют по QR-наклейке на объекте." }));
  const blocked = journalFillCodeBlock(code, org.disabledJournalCodes);
  if (blocked) return respond(event, messageView(blocked.error));
  if (!(await canWriteJournal(aclActor(ctx), code))) return respond(event, messageView(`Заполнять «${journalName}» вам не разрешено. Обратитесь к руководителю.`));

  const todayKey = todayKeyFor(org.timezone);
  // Первое заполнение после конца периода открывает документ нового периода — как скан QR.
  await ensureQrPeriodDocuments({ organizationId: ctx.organizationId, templateCode: code, todayKey, source: "max-bot" });
  // Документы точек сотрудника и общие: чужую точку бот не предлагает.
  const scope = await loadWorkerPointScope(ctx.organizationId, ctx.user.id);
  const docs = (await listJournalFillDocuments(ctx.organizationId, code, todayKey)).filter((doc) => documentInWorkerScope(scope, doc.buildingId));
  if (docs.length === 0) return respond(event, messageView(`На сегодня нет активного документа «${journalName}». Попросите руководителя создать его на сайте.`));
  const state: MaxFillState = {
    kind: "fill", id: newWizardId(), seq: 0, orgId: ctx.organizationId, code, name: journalName,
    phase: "document", documentId: null, documentTitle: null, rowKey: null, rowLabel: null, choices: [],
    step: 0, keys: [], values: {}, off: [], correction: null, picks: [], editing: false, notice: null,
  };
  const chosen = (documentId ? docs.find((doc) => doc.id === documentId) : null) ?? (docs.length === 1 ? docs[0] : null);
  if (chosen) return chooseRow(event, identity, ctx, state, chosen.id, chosen.title);
  const choices = docs.slice(0, 28).map((doc) => ({ id: doc.id, label: `${doc.title}${doc.building ? ` · ${doc.building}` : ""}`.slice(0, 120) }));
  return showFill(event, identity, ctx, { ...state, choices });
}

async function saveFill(event: MaxEvent, identity: Identity, ctx: Ctx, state: MaxFillState) {
  const loaded = await fillContext(state, ctx);
  if (!loaded || !state.documentId || !state.rowKey) {
    await saveState(identity.id, null);
    return respond(event, messageView("Форма журнала сейчас недоступна. Ничего не записано — попробуйте ещё раз."));
  }
  const submission = fillSubmission(state, loaded.form);
  const token = mintQrFillToken("journal", `${state.orgId}:${state.code}`);
  // Забираем состояние до записи: повторное нажатие «Сохранить» ничего не продублирует.
  if (!(await swapState(identity, null))) return respond(event, messageView("Эта запись уже обрабатывается."));
  let result: Awaited<ReturnType<typeof submitJournalFill>>;
  try {
    result = await submitJournalFill({
      request: new Request(`${maxConfig().siteBase}/api/max/webhook`, { method: "POST" }),
      orgId: state.orgId,
      code: state.code,
      token,
      documentId: state.documentId,
      employeeId: ctx.user.id,
      rowKey: state.rowKey,
      values: submission.values,
      off: submission.off,
      correction: submission.correction,
      messenger: { channel: "max", userKey: identity.maxUserId },
    });
  } catch (error) {
    // Сбой записи — ответы не теряются: «Сохранить» можно нажать ещё раз.
    await saveState(identity.id, state);
    throw error;
  }
  if (!result.ok) {
    const badIndex = loaded.form.fields.findIndex((field) => result.badKeys?.includes(field.key));
    const back: MaxFillState = { ...state, phase: badIndex >= 0 ? "field" : "confirm", step: badIndex >= 0 ? badIndex : state.step, editing: badIndex >= 0, notice: result.error };
    return showFill(event, identity, ctx, back);
  }
  try {
    await syncDailyJournalObligationsForUser({ userId: ctx.user.id, organizationId: ctx.organizationId, now: new Date() });
  } catch {
    // Задачи обновятся при следующем открытии меню.
  }
  const tasks = await loadTasks(ctx);
  const pending = tasks.filter((task) => !task.done && !task.object);
  const stamp = stampFor((await loadOrganizationForFill(state.orgId))?.timezone || "Europe/Moscow");
  const lines = [`✅ Записано: ${state.name}`, `${result.documentTitle} · ${stamp.date} ${stamp.time}`];
  if (result.count > 1) lines.push(`Строк добавлено: ${result.count}.`);
  lines.push("", pending.length ? `Осталось на сегодня: ${pending.length}.` : tasks.length ? "На сегодня всё заполнено. Спасибо!" : "");
  const buttons: MaxView["buttons"] = [];
  if (journalFillHints(state.code).append || result.mode === "appended") buttons.push([{ type: "callback", text: "➕ Добавить ещё", payload: `go:${state.code}:${state.documentId}` }]);
  const next = pending.find((task) => task.code !== state.code) ?? pending[0];
  if (next) buttons.push([{ type: "callback", text: `✍️ Следующий: ${next.name}`.slice(0, 64), payload: `go:${next.code}` }]);
  buttons.push([{ type: "callback", text: "🏠 Меню", payload: "menu" }]);
  return respond(event, { text: lines.join("\n").trim(), buttons });
}

async function onWizard(event: MaxEvent, identity: Identity, ctx: Ctx, payload: NonNullable<ReturnType<typeof parseWizardPayload>>) {
  const state = currentState(identity);
  if (!state || state.id !== payload.id) return respond(event, messageView("Это заполнение уже закончено или отменено. Начните заново из меню."));
  if (state.orgId !== ctx.organizationId) {
    await saveState(identity.id, null);
    return respond(event, messageView("Вы сменили организацию — заполнение отменено. Начните заново из меню."));
  }
  // Кнопка из старого сообщения: показываем текущий шаг, ничего не меняя.
  if (payload.seq !== state.seq) return showFill(event, identity, ctx, { ...state, notice: "Эта кнопка из прошлого шага — продолжайте отсюда." });
  const index = payload.arg !== null && /^\d{1,3}$/.test(payload.arg) ? Number(payload.arg) : -1;
  switch (payload.action) {
    case "cancel":
      await saveState(identity.id, null);
      return respond(event, messageView(`Заполнение «${state.name}» отменено — ничего не записано.`));
    case "doc": {
      const choice = state.phase === "document" ? state.choices[index] : undefined;
      if (!choice) return showFill(event, identity, ctx, state);
      const label = choice.label.split(" · ")[0] ?? choice.label;
      return chooseRow(event, identity, ctx, state, choice.id, label);
    }
    case "row": {
      const choice = state.phase === "row" ? state.choices[index] : undefined;
      if (!choice) return showFill(event, identity, ctx, state);
      return showFill(event, identity, ctx, { ...state, rowKey: choice.id, rowLabel: choice.label.replace(/^★ /, ""), choices: [], phase: "field", step: 0 });
    }
    case "save":
      if (state.phase !== "confirm") return showFill(event, identity, ctx, state);
      return saveFill(event, identity, ctx, state);
    case "resume":
      return showFill(event, identity, ctx, state);
  }
  const input: FillInput | null =
    payload.action === "p" ? { kind: "pick", index }
    : payload.action === "off" ? { kind: "off" }
    : payload.action === "back" ? { kind: "back" }
    : payload.action === "edit" ? { kind: "edit" }
    : payload.action === "ef" ? { kind: "editField", index }
    : null;
  if (!input) return showFill(event, identity, ctx, state);
  return applyInput(event, identity, ctx, state, input);
}

async function applyInput(event: MaxEvent, identity: Identity, ctx: Ctx, state: MaxFillState, input: FillInput) {
  const loaded = await fillContext(state, ctx);
  if (!loaded) return showFill(event, identity, ctx, state);
  const result = answerFill(state, loaded.fctx, input);
  return showFill(event, identity, ctx, result.ok ? result.state : { ...state, notice: result.error });
}

// ---------- Руководитель ----------

async function pendingByEmployee(ctx: Ctx) {
  const now = new Date();
  const dateKey = utcDayKey(now);
  try {
    const hasRows = (await db.journalObligation.count({ where: { organizationId: ctx.organizationId, dateKey } })) > 0;
    await scheduleObligationSync(`org:${ctx.organizationId}`, () => syncDailyJournalObligationsForOrganization(ctx.organizationId, now), { force: !hasRows });
  } catch (error) {
    console.error("[max:bot] organization sync failed", error instanceof Error ? error.name : "UnknownError");
  }
  // Руководитель точки видит и напоминает только по своим точкам (и общим).
  const scope = await loadWorkerPointScope(ctx.organizationId, ctx.user.id);
  const [rows, name] = await Promise.all([
    db.journalObligation.findMany({
      where: { organizationId: ctx.organizationId, dateKey, user: ORG_ROSTER_WHERE, ...documentWorkerScopeWhere(scope) },
      select: { userId: true, status: true, journalCode: true, template: { select: { name: true } }, user: { select: { name: true, maxIdentity: { select: { privateChatId: true } } } } },
    }),
    displayNames(ctx.organizationId),
  ]);
  const byUser = new Map<string, { userId: string; name: string; chatId: string | null; journals: Map<string, string> }>();
  for (const row of rows) {
    if (row.status !== "pending") continue;
    const entry = byUser.get(row.userId) ?? { userId: row.userId, name: row.user.name, chatId: row.user.maxIdentity?.privateChatId ?? null, journals: new Map() };
    entry.journals.set(row.journalCode, name(row.journalCode, row.template.name));
    byUser.set(row.userId, entry);
  }
  const pending = [...byUser.values()].sort((a, b) => b.journals.size - a.journals.size || a.name.localeCompare(b.name, "ru"));
  return { total: rows.length, done: rows.filter((row) => row.status === "done").length, pending };
}

async function requireManager(ctx: Ctx) {
  if (!isManager(ctx)) throw new MaxError("Этот раздел доступен руководителю.", 403);
}

async function summaryScreen(ctx: Ctx): Promise<MaxView> {
  await requireManager(ctx);
  const [data, org] = await Promise.all([pendingByEmployee(ctx), db.organization.findUnique({ where: { id: ctx.organizationId }, select: { timezone: true } })]);
  const rows: SummaryRow[] = data.pending.map((entry) => ({ name: entry.name, journals: [...entry.journals.values()], inMax: entry.chatId !== null, self: entry.userId === ctx.user.id }));
  return summaryView({ organizationName: ctx.organization.name, dateLabel: dateLabel(org?.timezone), total: data.total, done: data.done, rows });
}

function remindWait(lastReminderAt: Date | null | undefined, now = Date.now()): number | null {
  if (!lastReminderAt) return null;
  const left = lastReminderAt.getTime() + REMIND_INTERVAL_MS - now;
  return left > 0 ? Math.ceil(left / 60_000) : null;
}

async function remindScreen(ctx: Ctx): Promise<MaxView> {
  await requireManager(ctx);
  const [data, integration] = await Promise.all([pendingByEmployee(ctx), db.maxOrganizationIntegration.findUnique({ where: { organizationId: ctx.organizationId }, select: { lastReminderAt: true } })]);
  const targets = data.pending.filter((entry) => entry.userId !== ctx.user.id);
  const reachable = targets.filter((entry) => entry.chatId).length;
  return remindConfirmView({ reachable, notInMax: targets.length - reachable, waitMinutes: reachable ? remindWait(integration?.lastReminderAt) : null });
}

async function sendReminders(ctx: Ctx): Promise<MaxView> {
  await requireManager(ctx);
  const data = await pendingByEmployee(ctx);
  const targets = data.pending.filter((entry) => entry.userId !== ctx.user.id && entry.chatId);
  if (targets.length === 0) return remindConfirmView({ reachable: 0, notInMax: data.pending.length, waitMinutes: null });
  const now = new Date();
  await db.maxOrganizationIntegration.upsert({ where: { organizationId: ctx.organizationId }, create: { organizationId: ctx.organizationId }, update: {} });
  // Не чаще раза в 30 минут на организацию: условное обновление, второй руководитель не продублирует.
  const claimed = await db.maxOrganizationIntegration.updateMany({
    where: { organizationId: ctx.organizationId, OR: [{ lastReminderAt: null }, { lastReminderAt: { lt: new Date(now.getTime() - REMIND_INTERVAL_MS) } }] },
    data: { lastReminderAt: now },
  });
  if (claimed.count !== 1) {
    const integration = await db.maxOrganizationIntegration.findUnique({ where: { organizationId: ctx.organizationId }, select: { lastReminderAt: true } });
    return remindConfirmView({ reachable: targets.length, notInMax: 0, waitMinutes: remindWait(integration?.lastReminderAt) ?? 1 });
  }
  let sent = 0;
  for (const target of targets.slice(0, 100)) {
    const view = reminderMessage({ name: target.name, journals: [...target.journals.entries()].map(([code, name]) => ({ code, name, object: OBJECT_QR_JOURNAL_CODES.has(code) })) });
    try {
      await maxSend(target.chatId!, view.text, view.buttons);
      sent += 1;
    } catch {
      // Сотрудник мог остановить бота — остальным всё равно отправляем.
    }
  }
  await db.auditLog.create({ data: { organizationId: ctx.organizationId, userId: ctx.user.id, userName: ctx.user.name, action: "max.remind", entity: "Organization", entityId: ctx.organizationId, details: { sent, targets: targets.length } } }).catch(() => null);
  const failed = Math.min(targets.length, 100) - sent;
  return messageView(`🔔 Напоминание отправлено: ${sent}.${failed ? ` Не доставлено: ${failed} — эти сотрудники могли остановить бота.` : ""}`);
}

async function inviteScreen(ctx: Ctx, page: number): Promise<MaxView> {
  await requireManager(ctx);
  const staff = await db.user.findMany({
    where: { organizationId: ctx.organizationId, ...ORG_ROSTER_WHERE },
    select: { id: true, name: true, role: true, positionTitle: true, jobPosition: { select: { name: true } }, maxIdentity: { select: { id: true } } },
    orderBy: { name: "asc" },
  });
  const candidates = staff.filter((user) => !user.maxIdentity && user.id !== ctx.user.id).map((user) => ({ id: user.id, name: user.name, position: getUserDisplayTitle(user) || null }));
  return inviteListView({ candidates, connected: staff.filter((user) => user.maxIdentity).length, total: staff.length, page });
}

async function issueInvite(event: MaxEvent, ctx: Ctx, employeeId: string) {
  await requireManager(ctx);
  const invite = await issueMaxInvite({ organizationId: ctx.organizationId, employeeId, createdByUserId: ctx.user.id });
  await db.auditLog.create({ data: { organizationId: ctx.organizationId, userId: ctx.user.id, userName: ctx.user.name, action: "max.invite", entity: "User", entityId: employeeId } }).catch(() => null);
  await respond(event, inviteIssuedView({ name: invite.employeeName, validDays: MAX_INVITE_TTL_DAYS }));
  await maxSend(event.chatId, inviteForwardText({ url: invite.url, code: invite.token, organizationName: ctx.organization.name }));
}

async function acceptInvite(event: MaxEvent, token: string) {
  const claimed = await claimMaxInvite(token, { maxUserId: event.userId, chatId: event.chatId, displayName: event.name });
  const ctx = await maxContext(claimed.identityId);
  const menu = await menuScreen(ctx);
  const greeting = claimed.alreadyLinked ? "Вы уже подключены — вот ваше меню." : `✅ Готово, ${claimed.user.name}! MAX подключён к журналам «${ctx.organization.name}».\nТеперь журналы заполняются прямо здесь — кнопками.`;
  await maxSend(event.chatId, `${greeting}\n\n${menu.text}`, menu.buttons);
  if (claimed.alreadyLinked) return;
  try {
    const creator = await db.maxIdentity.findUnique({ where: { userId: claimed.createdByUserId }, select: { privateChatId: true } });
    if (creator) await maxSend(creator.privateChatId, `✅ Сотрудник подключён к MAX: ${claimed.user.name} (в MAX: «${event.name}»). Теперь бот сможет напоминать ему о журналах.`);
  } catch {
    // Уведомление руководителю не должно ломать подключение.
  }
}

// ---------- Разбор событий ----------

async function handleGroup(event: MaxEvent) {
  const match = /^\/connect\s+([A-Za-z0-9_-]{43})$/.exec(event.payload);
  if (!match || event.kind !== "message") return;
  const [admins, chat] = await Promise.all([
    maxApi<{ members: Array<{ user_id: number | string }> }>(`/chats/${encodeURIComponent(event.chatId)}/members/admins`),
    maxApi<{ type: string; title?: string }>(`/chats/${encodeURIComponent(event.chatId)}`),
  ]);
  if (chat.type !== "chat" || !admins.members?.some((admin) => String(admin.user_id) === event.userId)) throw new MaxError("Подключить группу может её администратор.", 403);
  await claimMaxLink(match[1], { maxUserId: event.userId, chatId: event.chatId, displayName: chat.title ?? "Группа MAX" }, true);
  await maxSend(event.chatId, "Группа найдена. Руководителю осталось подтвердить её в настройках MAX на сайте WeSetup.");
}

async function handleEvent(event: MaxEvent) {
  // Группы никогда не получают личных меню и журналов.
  if (!event.private) return handleGroup(event);
  const identity = await findIdentity(event.userId);
  if (event.kind === "stop") {
    if (identity) {
      await db.$transaction(async (tx) => {
        const removed = await tx.maxIdentity.deleteMany({ where: { id: identity.id } });
        if (removed.count) await tx.user.update({ where: { id: identity.userId }, data: { sessionVersion: { increment: 1 } } });
      });
      forgetSessionVersions([identity.userId]);
    }
    return;
  }
  if (!actionLimiter.consume(event.userId)) return respond(event, messageView("Слишком много нажатий подряд. Подождите минуту."));

  const invite = parseMaxInvitePayload(event.payload);
  if (invite && event.kind !== "callback") return acceptInvite(event, invite);
  if (event.kind === "start" && event.payload.startsWith("link_")) {
    await claimMaxLink(event.payload.slice(5), { maxUserId: event.userId, chatId: event.chatId, displayName: event.name });
    return respond(event, { text: "Остался один шаг: вернитесь на сайт WeSetup и подтвердите, что это ваш аккаунт MAX. Затем нажмите «Готово».", buttons: [[{ type: "callback", text: "Готово — открыть меню", payload: "menu" }]] });
  }
  if (!identity) return respond(event, unlinkedView(`${maxConfig().siteBase}/max/connect`));
  if (identity.privateChatId !== event.chatId) await db.maxIdentity.update({ where: { id: identity.id }, data: { privateChatId: event.chatId } });

  const ctx = await maxContext(identity.id);
  const wizard = event.kind === "callback" ? parseWizardPayload(event.payload) : null;
  if (wizard) return onWizard(event, identity, ctx, wizard);
  const payload = parseBotPayload(event.payload);

  // Ответ сообщением на вопрос заполнения.
  if (!payload && event.kind === "message") {
    const state = currentState(identity);
    if (state && state.orgId === ctx.organizationId && (state.phase === "field" || state.phase === "correction")) {
      return applyInput(event, identity, ctx, state, { kind: "text", text: event.payload.slice(0, 2000) });
    }
    if (state && state.orgId === ctx.organizationId) return showFill(event, identity, ctx, { ...state, notice: "Сейчас ответьте кнопкой под сообщением." });
  }

  switch (payload?.kind) {
    case "fill":
      return startFill(event, identity, ctx, payload.code, payload.documentId);
    case "object": {
      const template = await db.journalTemplate.findFirst({ where: { code: payload.code }, select: { name: true } });
      const name = await displayNames(ctx.organizationId);
      return respond(event, objectJournalView({ name: name(payload.code, template?.name ?? "Журнал"), hint: OBJECT_QR_JOURNAL_HINTS[payload.code] ?? "Этот журнал заполняют по QR-наклейке на объекте." }));
    }
    case "today": {
      const access = await fillAccess(ctx);
      if (!access.ok) return respond(event, messageView(access.note));
      const org = await db.organization.findUnique({ where: { id: ctx.organizationId }, select: { timezone: true } });
      return respond(event, todayView({ dateLabel: dateLabel(org?.timezone), tasks: await loadTasks(ctx) }));
    }
    case "journals": {
      const access = await fillAccess(ctx);
      if (!access.ok) return respond(event, messageView(access.note));
      return respond(event, journalsView({ organizationName: ctx.organization.name, journals: await loadFillableJournals(ctx), page: payload.page }));
    }
    case "help":
      return respond(event, helpView(isManager(ctx)));
    case "summary":
      return respond(event, await summaryScreen(ctx));
    case "remind":
      return respond(event, await remindScreen(ctx));
    case "remindConfirm":
      return respond(event, await sendReminders(ctx));
    case "invites":
      return respond(event, await inviteScreen(ctx, payload.page));
    case "invite":
      return issueInvite(event, ctx, payload.userId);
    case "orgs": {
      const user = await maxAccount(identity.userId);
      const organizations = await maxOrganizations(user.id);
      return respond(event, organizationsView({ organizations, activeId: ctx.organizationId, page: payload.page }));
    }
    case "org": {
      const organizations = await maxOrganizations(identity.userId);
      if (!organizations.some((org) => org.id === payload.id)) throw new MaxError("Нет доступа к этой организации.", 403);
      const settings = await db.maxOrganizationIntegration.findUnique({ where: { organizationId: payload.id } });
      if (settings?.enabled === false) throw new MaxError("Эта организация отключила доступ через MAX.", 403);
      await db.maxIdentity.update({ where: { id: identity.id }, data: { activeOrganizationId: payload.id, botState: Prisma.DbNull, botStateAt: null } });
      return respond(event, await menuScreen(await maxContext(identity.id)));
    }
    default: {
      const state = currentState(identity);
      // Незаконченное заполнение не теряется: в меню о нём напоминаем.
      const menu = await menuScreen(ctx);
      if (state && state.orgId === ctx.organizationId) {
        return respond(event, { text: `${menu.text}\n\nНезаконченное заполнение: «${state.name}».`, buttons: [[{ type: "callback", text: `▶️ Продолжить: ${state.name}`.slice(0, 64), payload: wizardPayload(state, "resume") }], ...menu.buttons] });
      }
      return respond(event, menu);
    }
  }
}

export async function handleMaxUpdate(input: unknown) {
  const event = parseMaxUpdate(input);
  if (!event) return;
  const id = maxUpdateKey(input);
  const now = new Date();
  // A lease permits retry after a crash, while CAS prevents concurrent delivery.
  await db.maxWebhookReceipt.upsert({ where: { id }, create: { id, leaseUntil: now }, update: {} });
  const leased = await db.maxWebhookReceipt.updateMany({ where: { id, completedAt: null, leaseUntil: { lte: now } }, data: { leaseUntil: new Date(now.getTime() + 60_000) } });
  if (!leased.count) {
    const receipt = await db.maxWebhookReceipt.findUnique({ where: { id } });
    if (!receipt?.completedAt) throw new MaxError("Update is processing", 503);
    return;
  }
  try {
    try {
      await handleEvent(event);
    } catch (error) {
      if (!(error instanceof MaxError)) throw error;
      // В группе — только текст: личных кнопок там нет.
      await respond(event, event.private ? messageView(error.message) : { text: error.message, buttons: [] });
    }
    await db.maxWebhookReceipt.update({ where: { id }, data: { completedAt: new Date() } });
  } catch (error) {
    await db.maxWebhookReceipt.updateMany({ where: { id, completedAt: null }, data: { leaseUntil: new Date(0) } });
    throw error;
  }
}
