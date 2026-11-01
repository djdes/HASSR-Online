import type { ChecklistAssignment } from "@prisma/client";
import { db } from "@/lib/db";
import { CHECKLIST_CODE } from "@/lib/custom-checklists";
import { decideJournalAcl } from "@/lib/journal-acl";
import { effectivePreset, hasCapability } from "@/lib/permission-presets";
import {
  assignmentRecipients,
  localClock,
  periodState,
  type ChecklistAssignmentFrequency,
  type ChecklistAssignmentTarget,
  type ChecklistPeriodState,
  type ChecklistSchedule,
  type LocalClock,
  verifierNotice,
} from "@/lib/checklist-assignments";
import { assignmentInArea, checklistPointArea } from "@/lib/checklist-point-scope";

/**
 * Назначения чек-листов — работа с базой: люди организации и их доступ,
 * статусы назначений, «Назначено вам», уведомление проверяющему. Логика
 * периодов — чистые функции `checklist-assignments.ts`.
 */

export type AssignmentPerson = {
  id: string;
  name: string;
  role: string;
  isRoot: boolean;
  isActive: boolean;
  archivedAt: Date | null;
  jobPositionId: string | null;
  positionName: string | null;
  buildingIds: string[];
  telegramChatId: string | null;
  /** Может провести и завершить проверку (ACL журнала чек-листов: запись и закрытие). */
  canRun: boolean;
  /** Руководитель или заведующая — их рекомендуем проверяющими. */
  manager: boolean;
};

export type AssignmentContext = {
  timeZone: string;
  buildings: { id: string; name: string }[];
  positions: { id: string; name: string; categoryKey: string }[];
  people: AssignmentPerson[];
};

/** Люди, точки и должности организации — всё, что нужно форме и статусам. */
export async function loadAssignmentContext(organizationId: string): Promise<AssignmentContext> {
  const [organization, buildings, positions, users] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }),
    db.building.findMany({ where: { organizationId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    db.jobPosition.findMany({
      where: { organizationId },
      orderBy: [{ categoryKey: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, categoryKey: true },
    }),
    db.user.findMany({
      where: { organizationId, isActive: true, archivedAt: null, isRoot: false },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        role: true,
        isRoot: true,
        isActive: true,
        archivedAt: true,
        jobPositionId: true,
        buildingIds: true,
        telegramChatId: true,
        permissionPreset: true,
        journalAccessMigrated: true,
        jobPosition: { select: { name: true } },
      },
    }),
  ]);
  const accessRows = users.length
    ? await db.userJournalAccess.findMany({
        where: { userId: { in: users.map((user) => user.id) }, templateCode: CHECKLIST_CODE },
        select: { userId: true, templateCode: true, canRead: true, canWrite: true, canFinalize: true },
      })
    : [];
  const rowByUser = new Map(accessRows.map((row) => [row.userId, row]));
  return {
    timeZone: organization?.timezone || "Europe/Moscow",
    buildings,
    positions,
    people: users.map((user) => {
      const subject = { role: user.role, isRoot: user.isRoot, permissionPreset: user.permissionPreset ?? null };
      const acl = { migrated: user.journalAccessMigrated === true, row: rowByUser.get(user.id) };
      const preset = effectivePreset(user);
      return {
        id: user.id,
        name: user.name,
        role: user.role,
        isRoot: user.isRoot,
        isActive: user.isActive,
        archivedAt: user.archivedAt,
        jobPositionId: user.jobPositionId,
        positionName: user.jobPosition?.name ?? null,
        buildingIds: user.buildingIds,
        telegramChatId: user.telegramChatId,
        canRun: decideJournalAcl(subject, "write", acl) && decideJournalAcl(subject, "finalize", acl),
        manager: preset === "admin" || preset === "head_chef",
      };
    }),
  };
}

export function scheduleOf(assignment: Pick<ChecklistAssignment, "frequency" | "onceDate" | "weekday" | "monthDay" | "dueTime">): ChecklistSchedule {
  return {
    frequency: assignment.frequency as ChecklistAssignmentFrequency,
    onceDate: assignment.onceDate,
    weekday: assignment.weekday,
    monthDay: assignment.monthDay,
    dueTime: assignment.dueTime,
  };
}

export function recipientsOf(assignment: Pick<ChecklistAssignment, "targetKind" | "targetId">, context: AssignmentContext): AssignmentPerson[] {
  return assignmentRecipients(
    { kind: assignment.targetKind as ChecklistAssignmentTarget, id: assignment.targetId },
    context.people,
    context.buildings.map((building) => building.id),
  );
}

/** Подпись «кому»: название точки, должности или имя; пропавшая цель — `null`. */
export function targetName(kind: string, id: string, context: AssignmentContext): string | null {
  if (kind === "building") return context.buildings.find((item) => item.id === id)?.name ?? null;
  if (kind === "position") return context.positions.find((item) => item.id === id)?.name ?? null;
  return context.people.find((item) => item.id === id)?.name ?? null;
}

/**
 * Дни (по часам организации), когда завершены проверки по назначениям.
 * Нужна только свежая история; разовые назначения смотрим целиком.
 */
export async function completedDayKeysByAssignment(
  assignments: Pick<ChecklistAssignment, "id" | "frequency">[],
  timeZone: string,
  now: Date,
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (assignments.length === 0) return result;
  const onceIds = assignments.filter((item) => item.frequency === "once").map((item) => item.id);
  const since = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const rows = await db.checklistInspection.findMany({
    where: {
      assignmentId: { in: assignments.map((item) => item.id) },
      status: "completed",
      completedAt: { not: null },
      OR: [{ completedAt: { gte: since } }, ...(onceIds.length ? [{ assignmentId: { in: onceIds } }] : [])],
    },
    select: { assignmentId: true, completedAt: true },
  });
  for (const row of rows) {
    if (!row.assignmentId || !row.completedAt) continue;
    const list = result.get(row.assignmentId) ?? [];
    list.push(localClock(row.completedAt, timeZone).dayKey);
    result.set(row.assignmentId, list);
  }
  return result;
}

export function assignmentState(
  assignment: Pick<ChecklistAssignment, "frequency" | "onceDate" | "weekday" | "monthDay" | "dueTime" | "createdAt">,
  clock: LocalClock,
  completedDayKeys: readonly string[],
  timeZone: string,
): ChecklistPeriodState {
  return periodState(scheduleOf(assignment), clock, completedDayKeys, localClock(assignment.createdAt, timeZone));
}

export type AssignmentRow = {
  id: string;
  templateId: string;
  templateTitle: string;
  templateArchived: boolean;
  targetKind: ChecklistAssignmentTarget;
  targetId: string;
  targetName: string | null;
  recipients: { id: string; name: string; hasTelegram: boolean; canRun: boolean }[];
  frequency: ChecklistAssignmentFrequency;
  onceDate: string | null;
  weekday: number | null;
  monthDay: number | null;
  dueTime: string;
  verifierUserId: string | null;
  verifierName: string | null;
  remindTelegram: boolean;
  active: boolean;
  state: ChecklistPeriodState;
};

/** Назначения организации со статусом текущего периода. */
export async function listAssignmentRows(organizationId: string, now: Date, context?: AssignmentContext): Promise<AssignmentRow[]> {
  const ctx = context ?? (await loadAssignmentContext(organizationId));
  const assignments = await db.checklistAssignment.findMany({
    where: { organizationId },
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
    include: { template: { select: { title: true, archived: true } } },
    take: 500,
  });
  const clock = localClock(now, ctx.timeZone);
  const done = await completedDayKeysByAssignment(assignments, ctx.timeZone, now);
  return assignments.map((assignment) => ({
    id: assignment.id,
    templateId: assignment.templateId,
    templateTitle: assignment.template.title,
    templateArchived: assignment.template.archived,
    targetKind: assignment.targetKind as ChecklistAssignmentTarget,
    targetId: assignment.targetId,
    targetName: targetName(assignment.targetKind, assignment.targetId, ctx),
    recipients: recipientsOf(assignment, ctx).map((person) => ({ id: person.id, name: person.name, hasTelegram: !!person.telegramChatId, canRun: person.canRun })),
    frequency: assignment.frequency as ChecklistAssignmentFrequency,
    onceDate: assignment.onceDate,
    weekday: assignment.weekday,
    monthDay: assignment.monthDay,
    dueTime: assignment.dueTime,
    verifierUserId: assignment.verifierUserId,
    verifierName: assignment.verifierUserId ? (ctx.people.find((person) => person.id === assignment.verifierUserId)?.name ?? null) : null,
    remindTelegram: assignment.remindTelegram,
    active: assignment.active,
    state: assignmentState(assignment, clock, done.get(assignment.id) ?? [], ctx.timeZone),
  }));
}

export type AssignedToMe = {
  id: string;
  templateId: string;
  templateTitle: string;
  dueTime: string;
  dueDayKey: string;
  /** Срок сегодня (у разового просроченного — в прошлом). */
  dueToday: boolean;
  status: "pending" | "done" | "overdue";
  /** Незавершённая проверка этого человека по назначению — «Продолжить». */
  draftId: string | null;
};

/** «Назначено вам»: активные назначения, где человек — получатель и сегодня есть период. */
export async function assignedToUser(organizationId: string, userId: string, now: Date): Promise<AssignedToMe[]> {
  const ctx = await loadAssignmentContext(organizationId);
  const assignments = await db.checklistAssignment.findMany({
    where: { organizationId, active: true, template: { archived: false } },
    include: { template: { select: { title: true } } },
    orderBy: { dueTime: "asc" },
  });
  const mine = assignments.filter((assignment) => recipientsOf(assignment, ctx).some((person) => person.id === userId));
  if (mine.length === 0) return [];
  const clock = localClock(now, ctx.timeZone);
  const [done, drafts] = await Promise.all([
    completedDayKeysByAssignment(mine, ctx.timeZone, now),
    db.checklistInspection.findMany({
      where: { organizationId, assignmentId: { in: mine.map((item) => item.id) }, createdById: userId, status: "draft" },
      orderBy: { createdAt: "desc" },
      select: { id: true, assignmentId: true },
    }),
  ]);
  const result: AssignedToMe[] = [];
  for (const assignment of mine) {
    const state = assignmentState(assignment, clock, done.get(assignment.id) ?? [], ctx.timeZone);
    if (!state.period || state.status === "off") continue;
    result.push({
      id: assignment.id,
      templateId: assignment.templateId,
      templateTitle: assignment.template.title,
      dueTime: assignment.dueTime,
      dueDayKey: state.period.dayKey,
      dueToday: state.period.dayKey === clock.dayKey,
      status: state.status,
      draftId: drafts.find((draft) => draft.assignmentId === assignment.id)?.id ?? null,
    });
  }
  const order = { overdue: 0, pending: 1, done: 2 } as const;
  return result.sort((a, b) => order[a.status] - order[b.status] || a.dueTime.localeCompare(b.dueTime));
}

/**
 * Можно ли начать проверку по назначению: назначение живое, шаблон тот же и
 * не в архиве, сегодня есть период, а человек — получатель (или руководитель).
 */
export async function assignmentForStart(input: {
  organizationId: string;
  assignmentId: string;
  templateId: string;
  user: { id: string; role?: string | null; isRoot?: boolean | null; permissionPreset?: string | null };
  now: Date;
  /** Точки области человека (`visibleObjectBuildingIds`); null — вся организация. */
  points?: readonly string[] | null;
}): Promise<{ ok: true; id: string } | { ok: false; status: number; error: string }> {
  const assignment = await db.checklistAssignment.findFirst({
    where: { id: input.assignmentId, organizationId: input.organizationId },
    include: { template: { select: { archived: true } } },
  });
  if (!assignment || assignment.templateId !== input.templateId || assignment.template.archived) {
    return { ok: false, status: 404, error: "Назначение не найдено" };
  }
  if (!assignment.active) return { ok: false, status: 409, error: "Назначение на паузе" };
  const ctx = await loadAssignmentContext(input.organizationId);
  const isRecipient = recipientsOf(assignment, ctx).some((person) => person.id === input.user.id);
  if (!isRecipient && !hasCapability(input.user, "admin.full")) {
    return { ok: false, status: 403, error: "Это назначение не для вас" };
  }
  // Точка (2026-11-01, «точка видит только своё»): руководитель, который не
  // получатель, начинает проверку только по назначению своей точки.
  const area = checklistPointArea({ points: input.points ?? null, buildings: ctx.buildings, people: ctx.people });
  if (!isRecipient && !assignmentInArea(area, assignment)) {
    return { ok: false, status: 404, error: "Назначение не найдено" };
  }
  const done = await completedDayKeysByAssignment([assignment], ctx.timeZone, input.now);
  const state = assignmentState(assignment, localClock(input.now, ctx.timeZone), done.get(assignment.id) ?? [], ctx.timeZone);
  if (state.status === "off") return { ok: false, status: 409, error: "Сегодня по этому назначению проверки нет" };
  return { ok: true, id: assignment.id };
}

type TelegramSender = (chatId: string, text: string, opts: { userId: string; reply_markup?: unknown; delivery?: { organizationId: string; kind: string; dedupeKey: string } }) => Promise<boolean>;

type VerifierNoticeInput = Parameters<typeof verifierNotice>[0];

async function loadVerifierNoticeInput(inspectionId: string): Promise<VerifierNoticeInput | null> {
  const inspection = await db.checklistInspection.findUnique({
    where: { id: inspectionId },
    select: {
      id: true,
      organizationId: true,
      title: true,
      status: true,
      result: true,
      completedById: true,
      completedByName: true,
      assignment: { select: { verifierUserId: true } },
    },
  });
  if (!inspection) return null;
  const verifierUserId = inspection.assignment?.verifierUserId ?? null;
  const verifier = verifierUserId
    ? await db.user.findFirst({
        where: { id: verifierUserId, organizationId: inspection.organizationId, isActive: true, archivedAt: null },
        select: { id: true, telegramChatId: true },
      })
    : null;
  return { inspection, verifierUserId, verifier };
}

/**
 * Проверку по назначению завершили — сообщение проверяющему со ссылкой на
 * результат. Загрузку и отправку можно подменить (тесты): `deps.load`,
 * `deps.send`. Возвращает, кому ушло (или почему нет).
 */
export async function notifyChecklistVerifier(
  inspectionId: string,
  deps: {
    load?: (id: string) => Promise<VerifierNoticeInput | null>;
    send?: TelegramSender;
    miniAppUrl?: (path: string) => string | null;
  } = {},
): Promise<{ sent: boolean; reason?: string; chatId?: string; text?: string }> {
  const input = await (deps.load ?? loadVerifierNoticeInput)(inspectionId);
  if (!input) return { sent: false, reason: "not-found" };
  const notice = verifierNotice(input);
  if ("skip" in notice) return { sent: false, reason: notice.skip };
  const send: TelegramSender = deps.send ?? (async (chatId, body, opts) => (await import("@/lib/telegram")).sendTelegramMessage(chatId, body, opts));
  const resolveUrl = deps.miniAppUrl ?? (await defaultMiniAppUrl());
  const url = resolveUrl(notice.path);
  const sent = await send(notice.chatId, notice.text, {
    userId: notice.userId,
    ...(url ? { reply_markup: { inline_keyboard: [[{ text: "Открыть результат", web_app: { url } }]] } } : {}),
    delivery: { organizationId: notice.organizationId, kind: "checklist_review", dedupeKey: `checklist-review:${input.inspection.id}` },
  });
  return { sent, chatId: notice.chatId, text: notice.text };
}

async function defaultMiniAppUrl(): Promise<(path: string) => string | null> {
  const { buildMiniAppUrl, getMiniAppBaseUrlFromEnv } = await import("@/lib/journal-obligation-links");
  const base = getMiniAppBaseUrlFromEnv();
  return (path) => buildMiniAppUrl(base, path);
}
