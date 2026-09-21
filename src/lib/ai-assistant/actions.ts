import crypto from "node:crypto";
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
  toDateKey,
} from "@/lib/hygiene-document";
import {
  buildStaffAutoFillEntryData,
  loadStaffScheduleMap,
  staffScheduleKey,
  STAFF_JOURNAL_TEMPLATE_CODES,
} from "@/lib/staff-journal-autofill";
import { createStaffMember } from "@/lib/staff-create";
import { isManagementRole } from "@/lib/user-roles";
import { orgTodayKey } from "@/lib/timezone";

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

const addStaffSchema = z.object({
  fullName: z.string().trim().min(2).max(200),
  jobPositionId: z.string().min(1).max(100),
  phone: z.string().trim().max(30).optional(),
});

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

const fillCellsSchema = z.object({
  documentId: z.string().min(1).max(100),
  employeeIds: z.array(z.string().min(1).max(100)).min(1).max(50),
  dates: z
    .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .min(1)
    .max(62),
  values: fillValuesSchema,
});

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

function statusLabel(status: string): string {
  return (
    HYGIENE_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status
  );
}

/**
 * Валидация действия от исполнителя + человекочитаемое превью для
 * карточки. Все выборки — только внутри `organizationId`.
 */
export async function prepareAction(
  raw: { kind: string; input: unknown },
  ctx: { orgId: string; actor: ActionActor }
): Promise<PrepareResult> {
  if (raw.kind === "add_staff") {
    const parsed = addStaffSchema.safeParse(raw.input);
    if (!parsed.success) {
      return { ok: false, error: "Некорректные данные сотрудника" };
    }
    if (!isManagementRole(ctx.actor.role) && !ctx.actor.isRoot) {
      return { ok: false, error: "Добавлять сотрудников может только менеджер" };
    }
    const position = await db.jobPosition.findFirst({
      where: { id: parsed.data.jobPositionId, organizationId: ctx.orgId },
      select: { name: true },
    });
    if (!position) {
      return { ok: false, error: "Должность не найдена" };
    }
    const action: ProposedAction = { kind: "add_staff", input: parsed.data };
    return {
      ok: true,
      preview: {
        token: signAction(action, ctx.orgId, ctx.actor.id),
        kind: "add_staff",
        title: "Добавить сотрудника",
        details: [
          `${parsed.data.fullName} — ${position.name}`,
          ...(parsed.data.phone ? [`Телефон: ${parsed.data.phone}`] : []),
          "Доступ к журналам — по правилам должности",
        ],
        expiresAt: Date.now() + ACTION_TTL_MS,
      },
    };
  }

  if (raw.kind === "fill_journal_cells") {
    const parsed = fillCellsSchema.safeParse(raw.input);
    if (!parsed.success) {
      return { ok: false, error: "Некорректные данные заполнения" };
    }
    const input = parsed.data;
    if (input.employeeIds.length * input.dates.length > MAX_CELLS) {
      return { ok: false, error: "Слишком много ячеек за один раз" };
    }

    const doc = await db.journalDocument.findFirst({
      where: { id: input.documentId, organizationId: ctx.orgId },
      select: {
        id: true,
        title: true,
        status: true,
        dateFrom: true,
        dateTo: true,
        template: { select: { code: true, name: true } },
      },
    });
    if (!doc) return { ok: false, error: "Документ не найден" };
    if (doc.status === "closed") return { ok: false, error: "Документ закрыт" };

    const templateCode = doc.template?.code ?? "";
    const isStaffJournal = (
      STAFF_JOURNAL_TEMPLATE_CODES as readonly string[]
    ).includes(templateCode);
    if (input.values.kind === "status" && templateCode !== "hygiene") {
      return {
        ok: false,
        error: "Статусы «Здоров/Выходной…» есть только в гигиеническом журнале",
      };
    }
    if (input.values.kind === "auto" && !isStaffJournal) {
      return {
        ok: false,
        error:
          "Автозаполнение доступно только для гигиенического журнала и журнала здоровья. Значения других журналов вносятся явно",
      };
    }

    if (
      templateCode &&
      !(await canWriteJournal(
        { id: ctx.actor.id, role: ctx.actor.role, isRoot: ctx.actor.isRoot },
        templateCode
      ))
    ) {
      return { ok: false, error: "Нет доступа к этому журналу" };
    }

    const fromKey = toDateKey(doc.dateFrom);
    const toKey = toDateKey(doc.dateTo);
    const badDate = input.dates.find((d) => d < fromKey || d > toKey);
    if (badDate) {
      return {
        ok: false,
        error: `Дата ${badDate} вне периода документа (${fromKey} — ${toKey})`,
      };
    }

    const employees = await db.user.findMany({
      where: { id: { in: input.employeeIds }, organizationId: ctx.orgId },
      select: { id: true, name: true },
    });
    if (employees.length !== new Set(input.employeeIds).size) {
      return { ok: false, error: "Сотрудник не найден" };
    }

    const valueLabel =
      input.values.kind === "status"
        ? `«${statusLabel(input.values.status)}»`
        : input.values.kind === "auto"
          ? "типовое заполнение по правилам журнала"
          : Object.entries(input.values.data)
              .map(([k, v]) => `${k}: ${String(v)}`)
              .join(", ");

    const action: ProposedAction = {
      kind: "fill_journal_cells",
      input,
    };
    const cellCount = input.employeeIds.length * input.dates.length;
    const sortedDates = [...input.dates].sort();
    return {
      ok: true,
      preview: {
        token: signAction(action, ctx.orgId, ctx.actor.id),
        kind: "fill_journal_cells",
        title: "Заполнить журнал",
        details: [
          `${doc.template?.name ?? "Журнал"} — «${doc.title}»`,
          `Сотрудники: ${employees.map((e) => e.name).join(", ")}`,
          `Дни: ${sortedDates[0]}${sortedDates.length > 1 ? ` — ${sortedDates[sortedDates.length - 1]}` : ""} (ячеек: ${cellCount})`,
          `Значение: ${valueLabel}`,
        ],
        expiresAt: Date.now() + ACTION_TTL_MS,
      },
    };
  }

  return { ok: false, error: "Неизвестное действие" };
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
): { ok: true; action: ProposedAction } | { ok: false; error: string } {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return { ok: false, error: "Некорректный токен действия" };
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = hmac(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: "Некорректный токен действия" };
  }
  let parsed: TokenPayload;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, error: "Некорректный токен действия" };
  }
  if (parsed.exp < Date.now()) {
    return { ok: false, error: "Действие устарело — попросите помощника ещё раз" };
  }
  // Подтверждает тот же человек и та же организация, что получили превью.
  if (parsed.orgId !== ctx.orgId || parsed.userId !== ctx.userId) {
    return { ok: false, error: "Токен действия не подходит этой сессии" };
  }
  return { ok: true, action: parsed.action };
}

// ---------------------------------------------------------------------------
// Исполнение

export type ExecuteResult =
  | { ok: true; summary: string }
  | { ok: false; error: string };

export async function verifyAndExecuteAction(
  token: string,
  ctx: { orgId: string; actor: ActionActor }
): Promise<ExecuteResult> {
  const verified = verifyActionToken(token, {
    orgId: ctx.orgId,
    userId: ctx.actor.id,
  });
  if (!verified.ok) return { ok: false, error: verified.error };

  const result =
    verified.action.kind === "add_staff"
      ? await executeAddStaff(verified.action.input, ctx)
      : await executeFillCells(verified.action.input, ctx);

  if (result.ok) {
    await db.auditLog
      .create({
        data: {
          organizationId: ctx.orgId,
          userId: ctx.actor.id,
          userName: ctx.actor.name,
          action: "ai_assistant.action",
          entity: verified.action.kind,
          entityId:
            verified.action.kind === "fill_journal_cells"
              ? verified.action.input.documentId
              : null,
          details: {
            kind: verified.action.kind,
            input: JSON.parse(JSON.stringify(verified.action.input)),
            summary: result.summary,
          },
        },
      })
      .catch((err) => console.error("[ai-actions] audit log failed", err));
  }
  return result;
}

async function executeAddStaff(
  input: z.infer<typeof addStaffSchema>,
  ctx: { orgId: string; actor: ActionActor }
): Promise<ExecuteResult> {
  if (!isManagementRole(ctx.actor.role) && !ctx.actor.isRoot) {
    return { ok: false, error: "Добавлять сотрудников может только менеджер" };
  }
  const result = await createStaffMember(ctx.orgId, input);
  if (!result.ok) return { ok: false, error: result.error };
  return {
    ok: true,
    summary: `Добавлен сотрудник: ${result.user.name} — ${result.positionName}`,
  };
}

async function executeFillCells(
  input: z.infer<typeof fillCellsSchema>,
  ctx: { orgId: string; actor: ActionActor }
): Promise<ExecuteResult> {
  // Полный боевой набор guard'ов — тот же, что у bulk-маршрута покраски.
  // Между превью и подтверждением могло измениться что угодно (документ
  // закрыли, день заперся) — проверяем всё заново.
  const doc = await db.journalDocument.findUnique({
    where: { id: input.documentId },
    include: { template: { select: { code: true } } },
  });
  if (!doc || doc.organizationId !== ctx.orgId) {
    return { ok: false, error: "Документ не найден" };
  }
  if (doc.status === "closed") {
    return { ok: false, error: "Документ закрыт" };
  }

  const templateCode = doc.template?.code ?? "";
  if (
    templateCode &&
    !(await canWriteJournal(
      { id: ctx.actor.id, role: ctx.actor.role, isRoot: ctx.actor.isRoot },
      templateCode
    ))
  ) {
    return { ok: false, error: "Нет доступа к этому журналу" };
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
      if (!scope.allowed) return { ok: false, error: scope.error };
    }
  }

  const employees = await db.user.findMany({
    where: { id: { in: input.employeeIds }, organizationId: ctx.orgId },
    include: { jobPosition: { select: { name: true } } },
  });
  if (employees.length !== new Set(input.employeeIds).size) {
    return { ok: false, error: "Сотрудник не найден" };
  }
  const employeeById = new Map(employees.map((e) => [e.id, e]));

  const docFrom = toDateKey(doc.dateFrom);
  const docTo = toDateKey(doc.dateTo);
  const badDate = input.dates.find((d) => d < docFrom || d > docTo);
  if (badDate) {
    return { ok: false, error: `Дата ${badDate} вне периода документа` };
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
        scheduleMap?.get(staffScheduleKey(employeeId, dateKey))
      );
    }
    return input.values.data;
  }

  const writeCtx = await loadEntryWriteContext(doc);
  const accepted: Array<{ employeeId: string; date: Date; data: unknown }> = [];
  const overrideDates: Date[] = [];
  let skipped = 0;

  for (const dateKey of input.dates) {
    const dateObj = toEntryDayUtc(dateKey);
    if (!dateObj) return { ok: false, error: "Некорректная дата" };

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
      error: "Все выбранные дни закрыты для редактирования",
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
      `Заполнено ячеек: ${accepted.length}` +
      (skipped > 0 ? `, пропущено (день закрыт): ${skipped}` : ""),
  };
}
