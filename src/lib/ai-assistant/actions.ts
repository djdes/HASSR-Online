import crypto from "node:crypto";
import { translatorFor } from "@/i18n/translator";
import type { Locale } from "@/i18n/locales";
import { FREE_MAX_USERS } from "@/lib/plan-limits";
import { journalTitle } from "@/i18n/journal-presentation";
import { loadMessages } from "@/i18n/messages";
import { presentDocumentTitle } from "@/i18n/journal-document-presentation";
import { z } from "zod";
import { db } from "@/lib/db";
import { canWriteJournal } from "@/lib/journal-acl";
import { reconcileEntryStaffFields } from "@/lib/journal-staff-binding";
import {
  checkEntryScope,
  checkEntryWrite,
  loadEntryWriteContext,
  logPastDayOverride,
  maybeTriggerColdEquipmentCapaDetection,
  toEntryDayUtc,
  toPrismaJsonValue,
  type EntryWriteActor,
} from "@/lib/journal-entry-write";
import {
  HYGIENE_STATUS_OPTIONS,
  isEntryDataEmpty,
  toDateKey,
} from "@/lib/hygiene-document";
import { readHygieneFormVersion } from "@/lib/hygiene-v2";
import {
  buildStaffAutoFillEntryData,
  loadStaffScheduleMap,
  staffScheduleKey,
  STAFF_JOURNAL_TEMPLATE_CODES,
} from "@/lib/staff-journal-autofill";
import { createStaffMember, type CreateStaffResult } from "@/lib/staff-create";
import { SEATS_PER_POINT } from "@/lib/tariff-plans";
import { isManagementRole } from "@/lib/user-roles";
import { orgTodayKey } from "@/lib/timezone";
import {
  documentInWorkerScope,
  loadManagerPointScope,
  personWorkerScopeWhere,
} from "@/lib/worker-point-scope";

/**
 * Действия AI-помощника: предложение → подтверждение → исполнение.
 *
 * Исполнитель диспетчера возвращает `action` как обычный JSON — это
 * НЕДОВЕРЕННЫЙ вход. Здесь он проходит три рубежа:
 *
 * 1. `prepareAction` — Zod-валидация и резолв в человекочитаемое превью
 *    (имена вместо id, счётчик ячеек). Невозможные действия отсекаются
 *    сразу, до показа карточки.
 * 2. HMAC-подпись (`signAction`) — stateless-токен на 10 минут,
 *    привязанный к организации и пользователю. Токен авторизует ПОКАЗ
 *    карточки, не запись.
 * 3. `verifyAndExecuteAction` — при клике «Выполнить» подпись
 *    проверяется, и действие проходит ПОЛНЫЙ набор боевых guard'ов
 *    (org-scope, ACL журнала, «своя строка/сегодня», закрытые дни) —
 *    ровно тех же, что у ручных маршрутов. AI-путь не даёт ничего сверх
 *    прав сессии.
 *
 * Каждое исполненное действие пишется в AuditLog — проверяющему важно,
 * кто и чем заполнил журнал.
 */

const ACTION_TTL_MS = 10 * 60 * 1000;
const MAX_CELLS = 2000;

// Схемы экспортируются для MCP и REST API (src/lib/public-api): описания
// полей уходят модели в JSON Schema инструментов.
export const assistantAddStaffSchema = z.object({
  fullName: z.string().trim().min(2).max(200).describe("ФИО сотрудника полностью, как в документах"),
  jobPositionId: z.string().min(1).max(100).describe("id должности из list_employees → positions"),
  phone: z.string().trim().max(30).optional().describe("Телефон в любом формате; можно не указывать"),
});
const addStaffSchema = assistantAddStaffSchema;

const primitive = z.union([z.string().max(500), z.number(), z.boolean(), z.null()]);

const fillValuesSchema = z.union([
  z.object({
    kind: z.literal("status"),
    status: z.enum(
      HYGIENE_STATUS_OPTIONS.map((o) => o.value) as [string, ...string[]]
    ),
  }),
  z.object({ kind: z.literal("auto") }),
  z.object({
    kind: z.literal("data"),
    data: z.record(z.string().max(60), primitive),
  }),
]);

export const assistantFillCellsSchema = z.object({
  documentId: z.string().min(1).max(100).describe("id документа журнала из list_journals → documents"),
  employeeIds: z
    .array(z.string().min(1).max(100))
    .min(1)
    .max(50)
    .describe("id сотрудников из list_employees — строки документа"),
  dates: z
    .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .min(1)
    .max(62)
    .describe("Даты в формате YYYY-MM-DD внутри периода документа"),
  values: fillValuesSchema.describe(
    "Что записать: status — статус гигиенического журнала; auto — типовое заполнение по графику (hygiene, health_check); data — только значения, которые пользователь назвал сам"
  ),
});
const fillCellsSchema = assistantFillCellsSchema;

export type ProposedAction =
  | { kind: "add_staff"; input: z.infer<typeof addStaffSchema> }
  | { kind: "fill_journal_cells"; input: z.infer<typeof fillCellsSchema> };

export type ActionActor = EntryWriteActor;

export type PendingActionPreview = {
  token: string;
  kind: ProposedAction["kind"];
  title: string;
  details: string[];
  expiresAt: number;
};

export type PrepareResult =
  | { ok: true; preview: PendingActionPreview }
  | { ok: false; error: string };

function statusLabel(status: string, t: Awaited<ReturnType<typeof translatorFor>>): string {
  if (status === "healthy") return t("hygiene.statuses.healthy");
  if (status === "day_off") return t("hygiene.statuses.dayOff");
  if (status === "sick_leave") return t("hygiene.statuses.sickLeave");
  if (status === "suspended") return t("hygiene.statuses.suspended");
  if (status === "vacation") return t("hygiene.statuses.vacation");
  return status;
}

/**
 * Валидация действия от исполнителя + человекочитаемое превью для
 * карточки. Все выборки — только внутри `organizationId`.
 */
export async function prepareAction(
  raw: { kind: string; input: unknown },
  ctx: { orgId: string; actor: ActionActor; locale?: Locale }
): Promise<PrepareResult> {
  const t = await translatorFor(ctx.locale ?? "ru");
  if (raw.kind === "add_staff") {
    const parsed = addStaffSchema.safeParse(raw.input);
    if (!parsed.success) {
      return { ok: false, error: t("assistantActions.invalidStaff") };
    }
    if (!isManagementRole(ctx.actor.role) && !ctx.actor.isRoot) {
      return { ok: false, error: t("assistantActions.managerOnly") };
    }
    const position = await db.jobPosition.findFirst({
      where: { id: parsed.data.jobPositionId, organizationId: ctx.orgId },
      select: { name: true },
    });
    if (!position) {
      return { ok: false, error: t("assistantActions.positionMissing") };
    }
    const action: ProposedAction = { kind: "add_staff", input: parsed.data };
    return {
      ok: true,
      preview: {
        token: signAction(action, ctx.orgId, ctx.actor.id),
        kind: "add_staff",
        title: t("assistantActions.addStaff"),
        details: [
          t("assistantActions.staffIdentity", { name: parsed.data.fullName, position: position.name }),
          ...(parsed.data.phone ? [t("assistantActions.phone", { phone: parsed.data.phone })] : []),
          t("assistantActions.accessRules"),
        ],
        expiresAt: Date.now() + ACTION_TTL_MS,
      },
    };
  }

  if (raw.kind === "fill_journal_cells") {
    const parsed = fillCellsSchema.safeParse(raw.input);
    if (!parsed.success) {
      return { ok: false, error: t("assistantActions.invalidFill") };
    }
    const input = parsed.data;
    if (input.employeeIds.length * input.dates.length > MAX_CELLS) {
      return { ok: false, error: t("assistantActions.tooManyCells") };
    }

    const doc = await db.journalDocument.findFirst({
      where: { id: input.documentId, organizationId: ctx.orgId },
      select: {
        id: true,
        title: true,
        status: true,
        dateFrom: true,
        dateTo: true,
        buildingId: true,
        template: { select: { code: true, name: true } },
      },
    });
    // Точки человека: документ чужой точки для него не существует.
    const scope = await loadManagerPointScope(ctx.orgId, ctx.actor.id);
    if (!doc || !documentInWorkerScope(scope, doc.buildingId)) {
      return { ok: false, error: t("assistantActions.documentMissing") };
    }
    if (doc.status === "closed") return { ok: false, error: t("assistantActions.documentClosed") };

    const templateCode = doc.template?.code ?? "";
    const isStaffJournal = (
      STAFF_JOURNAL_TEMPLATE_CODES as readonly string[]
    ).includes(templateCode);
    if (input.values.kind === "status" && templateCode !== "hygiene") {
      return {
        ok: false,
        error: t("assistantActions.hygieneStatusOnly"),
      };
    }
    if (input.values.kind === "auto" && !isStaffJournal) {
      return {
        ok: false,
        error:
          t("assistantActions.autoStaffOnly"),
      };
    }

    if (
      templateCode &&
      !(await canWriteJournal(
        { id: ctx.actor.id, role: ctx.actor.role, isRoot: ctx.actor.isRoot },
        templateCode
      ))
    ) {
      return { ok: false, error: t("assistantActions.noAccess") };
    }

    const fromKey = toDateKey(doc.dateFrom);
    const toKey = toDateKey(doc.dateTo);
    const badDate = input.dates.find((d) => d < fromKey || d > toKey);
    if (badDate) {
      return {
        ok: false,
        error: t("assistantActions.periodError", { date: badDate, from: fromKey, to: toKey }),
      };
    }

    const employees = await db.user.findMany({
      where: { id: { in: input.employeeIds }, organizationId: ctx.orgId, ...personWorkerScopeWhere(scope) },
      select: { id: true, name: true },
    });
    if (employees.length !== new Set(input.employeeIds).size) {
      return { ok: false, error: t("assistantActions.employeeMissing") };
    }

    const valueLabel =
      input.values.kind === "status"
        ? statusLabel(input.values.status, t)
        : input.values.kind === "auto"
          ? t("assistantActions.autoValues")
          : Object.entries(input.values.data)
              .map(([k, v]) => `${k}: ${String(v)}`)
              .join(", ");

    const action: ProposedAction = {
      kind: "fill_journal_cells",
      input,
    };
    const cellCount = input.employeeIds.length * input.dates.length;
    const sortedDates = [...input.dates].sort();
    const locale = ctx.locale ?? "ru";
    const messages = await loadMessages(locale);
    const localizedName = journalTitle(locale, messages.journals.names, templateCode, doc.template?.name ?? t("assistantActions.journal"));
    const displayTitle = presentDocumentTitle({ title: doc.title, templateCode, sourceNames: doc.template ? [doc.template.name] : [], localizedName,
      dateFrom: fromKey, dateTo: toKey, locale, formatTitle: (name, period) => t("journalWidgets.headerEdit.generatedTitle", { name, period }) });
    return {
      ok: true,
      preview: {
        token: signAction(action, ctx.orgId, ctx.actor.id),
        kind: "fill_journal_cells",
        title: t("assistantActions.fillJournal"),
        details: [
          t("assistantActions.documentDetail", { journal: localizedName, title: displayTitle }),
          t("assistantActions.employees", { names: employees.map(e => e.name).join(", ") }),
          sortedDates.length > 1 ? t("assistantActions.dateRange", { from: sortedDates[0], to: sortedDates[sortedDates.length - 1], count: cellCount }) : t("assistantActions.singleDate", { date: sortedDates[0], count: cellCount }),
          t("assistantActions.value", { value: valueLabel }),
        ],
        expiresAt: Date.now() + ACTION_TTL_MS,
      },
    };
  }

  return { ok: false, error: t("assistantActions.unknownAction") };
}

// ---------------------------------------------------------------------------
// Подпись

function actionSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is not set");
  return secret;
}

function hmac(payload: string): string {
  return crypto
    .createHmac("sha256", actionSecret())
    .update(payload)
    .digest("base64url");
}

export function signAction(
  action: ProposedAction,
  orgId: string,
  userId: string
): string {
  const payload = Buffer.from(
    JSON.stringify({ action, orgId, userId, exp: Date.now() + ACTION_TTL_MS })
  ).toString("base64url");
  return `${payload}.${hmac(payload)}`;
}

type TokenPayload = {
  action: ProposedAction;
  orgId: string;
  userId: string;
  exp: number;
};

export function verifyActionToken(
  token: string,
  ctx: { orgId: string; userId: string }
): { ok: true; action: ProposedAction } | { ok: false; error: string; code: "invalidToken" | "expiredToken" | "foreignToken" } {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return { ok: false, code: "invalidToken", error: "Некорректный токен действия" };
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = hmac(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, code: "invalidToken", error: "Некорректный токен действия" };
  }
  let parsed: TokenPayload;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, code: "invalidToken", error: "Некорректный токен действия" };
  }
  if (parsed.exp < Date.now()) {
    return { ok: false, code: "expiredToken", error: "Действие устарело — попросите помощника ещё раз" };
  }
  // Подтверждает тот же человек и та же организация, что получили превью.
  if (parsed.orgId !== ctx.orgId || parsed.userId !== ctx.userId) {
    return { ok: false, code: "foreignToken", error: "Токен действия не подходит этой сессии" };
  }
  return { ok: true, action: parsed.action };
}

// ---------------------------------------------------------------------------
// Исполнение

export type ExecuteResult =
  /** `entityId` — id созданного сотрудника для add_staff. */
  | { ok: true; summary: string; entityId?: string }
  /** `code` — `billing_free_limit`, если места тарифа заняты (API ответит 402). */
  | { ok: false; error: string; code?: string };

export async function verifyAndExecuteAction(
  token: string,
  ctx: { orgId: string; actor: ActionActor; locale?: Locale; inApp?: boolean }
): Promise<ExecuteResult> {
  const t = await translatorFor(ctx.locale ?? "ru");
  const verified = verifyActionToken(token, {
    orgId: ctx.orgId,
    userId: ctx.actor.id,
  });
  if (!verified.ok) return { ok: false, error: t(`assistantActions.${verified.code}`) };
  return executeProposedAction(verified.action, ctx);
}

/**
 * Исполнение уже проверенного действия: полный набор боевых guard'ов и,
 * если `audit` не `false`, строка AuditLog. Подпись проверяет вызывающая
 * сторона: чат-помощник — токеном, MCP и REST API — ключом
 * (они пишут свой аудит `public_api.call` и передают `audit: false`).
 */
export async function executeProposedAction(
  action: ProposedAction,
  /** `inApp` — запрос из приложения WeSetup: к оплате не зовём (правила сторов). */
  ctx: { orgId: string; actor: ActionActor; locale?: Locale; inApp?: boolean },
  opts: { audit?: { action: string; details?: Record<string, unknown> } | false } = {}
): Promise<ExecuteResult> {
  const audit = opts.audit === undefined ? { action: "ai_assistant.action" } : opts.audit;
  const result =
    action.kind === "add_staff"
      ? await executeAddStaff(action.input, ctx)
      : await executeFillCells(action.input, ctx);

  if (result.ok && audit) {
    await db.auditLog
      .create({
        data: {
          organizationId: ctx.orgId,
          userId: ctx.actor.id,
          userName: ctx.actor.name,
          action: audit.action,
          entity: action.kind,
          entityId:
            action.kind === "fill_journal_cells"
              ? action.input.documentId
              : null,
          details: {
            kind: action.kind,
            input: JSON.parse(JSON.stringify(action.input)),
            summary: result.summary,
            ...audit.details,
          },
        },
      })
      .catch((err) => console.error("[ai-actions] audit log failed", err));
  }
  return result;
}

async function executeAddStaff(
  input: z.infer<typeof addStaffSchema>,
  ctx: { orgId: string; actor: ActionActor; locale?: Locale; inApp?: boolean }
): Promise<ExecuteResult> {
  const t = await translatorFor(ctx.locale ?? "ru");
  if (!isManagementRole(ctx.actor.role) && !ctx.actor.isRoot) {
    return { ok: false, error: t("assistantActions.managerOnly") };
  }
  // Руководитель точки добавляет людей на свои точки, как форма на сайте
  // (/api/staff): иначе новый сотрудник работал бы на всех точках.
  const scope = await loadManagerPointScope(ctx.orgId, ctx.actor.id);
  const result = await createStaffMember(ctx.orgId, scope ? { ...input, buildingIds: scope.points } : input);
  if (!result.ok) return result.code === "billing_free_limit"
    ? { ok: false, error: seatLimitReply(t, result, ctx.inApp === true), code: result.code }
    : { ok: false, error: result.status === 404 ? t("assistantActions.positionMissing")
      : result.status === 400 ? t("assistantActions.invalidPhone")
      : t("common.assistant.actionFailed") };
  return {
    ok: true,
    summary: t("assistantActions.staffAdded", { name: result.user.name, position: result.positionName }),
    entityId: result.user.id,
  };
}

/**
 * Места заняты — лимит и следующий тариф, как в тосте: бесплатный →
 * «Стандарт», «Стандарт» → «Премиум», «Премиум» → по согласованию. В
 * приложении WeSetup — только факт.
 */
function seatLimitReply(
  t: Awaited<ReturnType<typeof translatorFor>>,
  refusal: Extract<CreateStaffResult, { ok: false }>,
  inApp: boolean
): string {
  const count = refusal.limit ?? FREE_MAX_USERS;
  if (inApp) return t("common.billing.limit", { count });
  if (refusal.nextTier === "standard") return t("common.billing.limitToStandard", { count, seats: SEATS_PER_POINT.standard });
  if (refusal.nextTier === "premium") return t("common.billing.limitToPremium", { count, seats: SEATS_PER_POINT.premium });
  if (refusal.nextTier === null) return t("common.billing.limitContact", { count, seats: SEATS_PER_POINT.premium });
  return t("common.billing.limitAction", { count });
}

async function executeFillCells(
  input: z.infer<typeof fillCellsSchema>,
  ctx: { orgId: string; actor: ActionActor; locale?: Locale }
): Promise<ExecuteResult> {
  const t = await translatorFor(ctx.locale ?? "ru");
  // Полный боевой набор guard'ов — тот же, что у bulk-маршрута покраски.
  // Между превью и подтверждением могло измениться что угодно (документ
  // закрыли, день заперся) — проверяем всё заново.
  const doc = await db.journalDocument.findUnique({
    where: { id: input.documentId },
    include: { template: { select: { code: true } } },
  });
  if (
    !doc ||
    doc.organizationId !== ctx.orgId ||
    !documentInWorkerScope(await loadManagerPointScope(ctx.orgId, ctx.actor.id), doc.buildingId)
  ) {
    return { ok: false, error: t("assistantActions.documentMissing") };
  }
  if (doc.status === "closed") {
    return { ok: false, error: t("assistantActions.documentClosed") };
  }

  const templateCode = doc.template?.code ?? "";
  if (
    templateCode &&
    !(await canWriteJournal(
      { id: ctx.actor.id, role: ctx.actor.role, isRoot: ctx.actor.isRoot },
      templateCode
    ))
  ) {
    return { ok: false, error: t("assistantActions.noAccess") };
  }

  // Гигиена по новой форме (Приложение №1): три графы подписывает сам
  // сотрудник по QR, допуск — ответственный. «Здоров» / «Отстранён» за
  // человека ассистент не ставит; автозаполнение — только график.
  const hygieneFormVersion = templateCode === "hygiene" ? readHygieneFormVersion(doc.config) : 1;
  if (
    hygieneFormVersion === 2 &&
    input.values.kind === "status" &&
    (input.values.status === "healthy" || input.values.status === "suspended")
  ) {
    return {
      ok: false,
      error: t("assistantActions.selfSignature"),
    };
  }

  const org = await db.organization.findUnique({
    where: { id: ctx.orgId },
    select: { timezone: true },
  });
  const todayKey = orgTodayKey(org?.timezone ?? undefined);

  // Рядовой сотрудник — только своя строка и только сегодня, как руками.
  for (const employeeId of input.employeeIds) {
    for (const dateKey of input.dates) {
      const scope = checkEntryScope({
        actor: { id: ctx.actor.id, role: ctx.actor.role, isRoot: ctx.actor.isRoot },
        responsibleUserId: doc.responsibleUserId,
        employeeId,
        entryDayKey: dateKey,
        todayKey,
      });
      if (!scope.allowed) return { ok: false, error: t(scope.code === "foreign_row" ? "journalWidgets.headerEdit.foreignRow" : "journalWidgets.headerEdit.notToday") };
    }
  }

  const employees = await db.user.findMany({
    where: { id: { in: input.employeeIds }, organizationId: ctx.orgId },
    include: { jobPosition: { select: { name: true } } },
  });
  if (employees.length !== new Set(input.employeeIds).size) {
    return { ok: false, error: t("assistantActions.employeeMissing") };
  }
  const employeeById = new Map(employees.map((e) => [e.id, e]));

  const docFrom = toDateKey(doc.dateFrom);
  const docTo = toDateKey(doc.dateTo);
  const badDate = input.dates.find((d) => d < docFrom || d > docTo);
  if (badDate) {
    return { ok: false, error: t("assistantActions.dateOutside", { date: badDate }) };
  }

  // Значения ячеек. Для kind:"auto" гигиенического журнала статус берётся
  // из графиков (выходные/отпуска/больничные) — та же логика, что у
  // штатного автозаполнения. Числа модель придумать не может: kind:"data"
  // несёт только то, что пользователь назвал сам, и оно было показано в
  // карточке подтверждения.
  const scheduleMap =
    input.values.kind === "auto" && templateCode === "hygiene"
      ? await loadStaffScheduleMap(db, {
          employeeIds: input.employeeIds,
          dateKeys: input.dates,
          organizationId: ctx.orgId,
        })
      : null;

  function cellData(employeeId: string, dateKey: string): unknown {
    if (input.values.kind === "status") {
      return {
        status: input.values.status,
        temperatureAbove37: input.values.status === "healthy" ? false : null,
      };
    }
    if (input.values.kind === "auto") {
      return buildStaffAutoFillEntryData(
        templateCode,
        scheduleMap?.get(staffScheduleKey(employeeId, dateKey)),
        { hygieneFormVersion }
      );
    }
    return input.values.data;
  }

  const writeCtx = await loadEntryWriteContext(doc);
  const accepted: Array<{ employeeId: string; date: Date; data: unknown }> = [];
  const overrideDates: Date[] = [];
  let skipped = 0;
  let leftForQr = 0;

  for (const dateKey of input.dates) {
    const dateObj = toEntryDayUtc(dateKey);
    if (!dateObj) return { ok: false, error: t("assistantActions.invalidDate") };

    const decision = checkEntryWrite(writeCtx, ctx.actor, dateObj);
    if (!decision.allowed) {
      // Запертый день не валит действие целиком — как у покраски мышью.
      skipped += input.employeeIds.length;
      continue;
    }
    if (decision.isOverride) overrideDates.push(dateObj);

    for (const employeeId of input.employeeIds) {
      const employee = employeeById.get(employeeId);
      const data = cellData(employeeId, dateKey);
      // v2: без графика ячейку не трогаем — пустой upsert стёр бы подпись с QR.
      if (hygieneFormVersion === 2 && input.values.kind === "auto" && isEntryDataEmpty(data)) {
        leftForQr += 1;
        continue;
      }
      accepted.push({
        employeeId,
        date: dateObj,
        data: employee ? reconcileEntryStaffFields(data, employee) : data,
      });
    }
  }

  if (overrideDates.length > 0) {
    await logPastDayOverride({
      organizationId: doc.organizationId,
      actor: ctx.actor,
      documentId: doc.id,
      employeeId: null,
      dates: overrideDates,
      templateCode: doc.template?.code ?? null,
    });
  }

  if (accepted.length === 0) {
    return {
      ok: false,
      error:
        leftForQr > 0
          ? t("assistantActions.nothingToFill")
          : t("assistantActions.allDaysClosed"),
    };
  }

  await db.$transaction(
    accepted.map((item) =>
      db.journalDocumentEntry.upsert({
        where: {
          documentId_employeeId_date: {
            documentId: doc.id,
            employeeId: item.employeeId,
            date: item.date,
          },
        },
        update: { data: toPrismaJsonValue(item.data) },
        create: {
          documentId: doc.id,
          employeeId: item.employeeId,
          date: item.date,
          data: toPrismaJsonValue(item.data),
        },
      })
    )
  );

  maybeTriggerColdEquipmentCapaDetection(doc.template?.code, ctx.orgId);

  return {
    ok: true,
    summary:
      t("assistantActions.cellsFilled", { count: accepted.length, skipped, qr: leftForQr }),
  };
}
