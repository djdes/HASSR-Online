import type { Session } from "next-auth";
import { recordAuditLog } from "@/lib/audit-log";
import { db } from "@/lib/db";
import { BUILDING_OUT_OF_SCOPE_ERROR, buildingInScope, staffInScope } from "@/lib/point-scope";
import { computePointScope } from "@/lib/point-scope.server";
import { bumpSessionVersion } from "@/lib/session-version";
import { isManagementRole } from "@/lib/user-roles";
import {
  PLAN_ASSIGNMENT_ERRORS,
  assignmentEndsAt,
  assignmentSurvivesEdit,
  dateKeyInTimeZone,
  planAssignment,
  restoreBuildingIds,
  type PointAssignmentMode,
} from "@/lib/point-assignments";

/**
 * Временная работа на другой точке — запись в БД (логика —
 * `point-assignments.ts`). Назначение меняет `User.buildingIds` сразу, а
 * возврат делает `expirePointAssignments`: из крона
 * `/api/cron/deviation-escalations` (каждые 5 минут, строка в crontab уже
 * есть), своего `/api/cron/point-assignments` и лениво при открытии
 * «Сотрудников», страницы точки и QR точки.
 */

type AuditSession = Parameters<typeof recordAuditLog>[0]["session"];

export const TRANSFER_FOREIGN_ERROR =
  "Перевести сотрудника с другой точки может офис — выберите «Добавить эту точку»";

type ScopeUser = { id: string; organizationId: string; role: string; canManageSettings: boolean };

/**
 * Руководитель точки в токене держит свои точки (proxy по ним закрывает
 * общие разделы). Поменялись точки руководителя так, что поменялся его
 * круг, — закрываем его сессии, как при правке точек в карточке.
 */
async function bumpIfPointScopeChanged(user: ScopeUser, before: readonly string[], after: readonly string[]) {
  if (!isManagementRole(user.role) && !user.canManageSettings) return;
  const [was, now] = await Promise.all([
    computePointScope({ organizationId: user.organizationId, buildingIds: before }),
    computePointScope({ organizationId: user.organizationId, buildingIds: after }),
  ]);
  if (JSON.stringify(was) !== JSON.stringify(now)) await bumpSessionVersion(user.id).catch(() => null);
}

export type CreateAssignmentResult =
  | { ok: true; assignmentId: string; endsAt: Date; returnKey: string }
  | { ok: false; status: number; error: string; code?: string };

export async function createPointAssignment(input: {
  session: Session;
  organizationId: string;
  userId: string;
  buildingId: string;
  mode: PointAssignmentMode;
  days: number;
  now?: Date;
}): Promise<CreateAssignmentResult> {
  const now = input.now ?? new Date();
  const { organizationId } = input;
  if (!buildingInScope(input.session.user, input.buildingId)) {
    return { ok: false, status: 403, error: BUILDING_OUT_OF_SCOPE_ERROR };
  }
  // Просроченное назначение этого человека сначала закрываем — иначе оно
  // мешало бы новому («уже есть временная точка»).
  await expirePointAssignments({ organizationId, now });

  const [org, user, buildings] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }),
    db.user.findFirst({
      where: { id: input.userId, organizationId, archivedAt: null, isRoot: false },
      select: { id: true, name: true, organizationId: true, role: true, canManageSettings: true, buildingIds: true },
    }),
    db.building.findMany({ where: { organizationId }, select: { id: true, kind: true, name: true } }),
  ]);
  if (!user) return { ok: false, status: 404, error: "Сотрудник не найден" };
  // Руководитель точки берёт людей на замену к себе, но переводить чужого
  // сотрудника (снимать его с его точки) — решение офиса.
  if (input.mode === "transfer" && !staffInScope(input.session.user, user.buildingIds)) {
    return { ok: false, status: 403, error: TRANSFER_FOREIGN_ERROR };
  }
  const timeZone = org?.timezone || "Europe/Moscow";
  const { endsAt, returnKey } = assignmentEndsAt(now, input.days, timeZone);

  const result = await db.$transaction(async (tx) => {
    const fresh = await tx.user.findUnique({ where: { id: user.id }, select: { buildingIds: true } });
    const active = await tx.userPointAssignment.findFirst({
      where: { userId: user.id, endedAt: null },
      select: { id: true },
    });
    const planned = planAssignment({
      userBuildingIds: fresh?.buildingIds ?? [],
      buildings,
      targetBuildingId: input.buildingId,
      mode: input.mode,
      days: input.days,
      hasActiveAssignment: Boolean(active),
    });
    if (!planned.ok) return planned;
    const assignment = await tx.userPointAssignment.create({
      data: {
        organizationId,
        userId: user.id,
        buildingId: input.buildingId,
        mode: input.mode,
        startsAt: now,
        endsAt,
        removedBuildingIds: planned.plan.removedBuildingIds,
        addedBuilding: planned.plan.addedBuilding,
        createdById: input.session.user.id ?? null,
      },
      select: { id: true },
    });
    await tx.user.update({ where: { id: user.id }, data: { buildingIds: planned.plan.nextBuildingIds } });
    return { ok: true as const, assignmentId: assignment.id, before: fresh?.buildingIds ?? [], plan: planned.plan };
  });
  if (!result.ok) {
    return {
      ok: false,
      status: result.error === "unknown_building" ? 404 : 400,
      error: PLAN_ASSIGNMENT_ERRORS[result.error],
      code: result.error,
    };
  }

  const nameOf = (id: string) => buildings.find((building) => building.id === id)?.name ?? null;
  await recordAuditLog({
    session: input.session as AuditSession,
    organizationId,
    action: "staff.point_assignment.create",
    entity: "user",
    entityId: user.id,
    details: {
      assignmentId: result.assignmentId,
      userName: user.name,
      buildingId: input.buildingId,
      buildingName: nameOf(input.buildingId),
      mode: input.mode,
      days: input.days,
      endsAt: endsAt.toISOString(),
      removedBuildingIds: result.plan.removedBuildingIds,
      removedBuildingNames: result.plan.removedBuildingIds.map(nameOf).filter(Boolean),
    },
  });
  await bumpIfPointScopeChanged(user, result.before, result.plan.nextBuildingIds);
  return { ok: true, assignmentId: result.assignmentId, endsAt, returnKey };
}

/**
 * Завершить назначение и вернуть точки (`restoreBuildingIds`). Уже
 * завершённое — null (повтор и гонка с кроном безопасны).
 */
export async function endPointAssignment(input: {
  organizationId: string;
  assignmentId: string;
  reason: "manual" | "expire" | "building_deleted";
  session?: Session | null;
  now?: Date;
}): Promise<{ userId: string; buildingIds: string[] } | null> {
  const now = input.now ?? new Date();
  const done = await db.$transaction(async (tx) => {
    const assignment = await tx.userPointAssignment.findFirst({
      where: { id: input.assignmentId, organizationId: input.organizationId, endedAt: null },
    });
    if (!assignment) return null;
    const claimed = await tx.userPointAssignment.updateMany({
      where: { id: assignment.id, endedAt: null },
      data: { endedAt: now },
    });
    if (claimed.count === 0) return null;
    const user = await tx.user.findUnique({
      where: { id: assignment.userId },
      select: { id: true, name: true, organizationId: true, role: true, canManageSettings: true, buildingIds: true },
    });
    if (!user) return null;
    const next = restoreBuildingIds(user.buildingIds, assignment);
    await tx.user.update({ where: { id: user.id }, data: { buildingIds: next } });
    return { assignment, user, next };
  });
  if (!done) return null;

  await recordAuditLog({
    session: (input.session ?? null) as AuditSession,
    organizationId: input.organizationId,
    action: input.reason === "expire" ? "staff.point_assignment.expire" : "staff.point_assignment.end",
    entity: "user",
    entityId: done.user.id,
    details: {
      assignmentId: done.assignment.id,
      userName: done.user.name,
      buildingId: done.assignment.buildingId,
      mode: done.assignment.mode,
      reason: input.reason,
      buildingIdsBefore: done.user.buildingIds,
      buildingIdsAfter: done.next,
    },
  });
  await bumpIfPointScopeChanged(done.user, done.user.buildingIds, done.next);
  return { userId: done.user.id, buildingIds: done.next };
}

/**
 * Автовозврат: все назначения, чей срок вышел. Без `organizationId` — по
 * всей платформе (крон), с ним — только организация (ленивый вызов со
 * страниц). Один индексный запрос, если возвращать некого.
 */
export async function expirePointAssignments(options: { now?: Date; organizationId?: string } = {}): Promise<{ expired: number }> {
  const now = options.now ?? new Date();
  const due = await db.userPointAssignment.findMany({
    where: {
      endedAt: null,
      endsAt: { lte: now },
      ...(options.organizationId ? { organizationId: options.organizationId } : {}),
    },
    orderBy: { endsAt: "asc" },
    take: 500,
    select: { id: true, organizationId: true },
  });
  let expired = 0;
  for (const row of due) {
    try {
      const done = await endPointAssignment({ organizationId: row.organizationId, assignmentId: row.id, reason: "expire", now });
      if (done) expired += 1;
    } catch (error) {
      console.error("[point-assignments] expire failed", row.id, error);
    }
  }
  return { expired };
}

/** Ленивый автовозврат со страниц: ошибка не должна ронять страницу. */
export async function expireOrgPointAssignments(organizationId: string): Promise<void> {
  await expirePointAssignments({ organizationId }).catch((error) => {
    console.error("[point-assignments] lazy expire failed", error);
  });
}

/**
 * Правка точек целиком уже записана (`nextBuildingIds`): назначения, чью
 * точку сняли, завершаются без возврата — правка и есть новое «как надо».
 * Возвращает действующие назначения, которые пережили правку.
 */
export async function reconcileAssignmentsAfterEdit(input: {
  organizationId: string;
  userId: string;
  nextBuildingIds: readonly string[];
  session?: Session | null;
  now?: Date;
}): Promise<Array<{ id: string; buildingId: string; removedBuildingIds: string[] }>> {
  const now = input.now ?? new Date();
  const active = await db.userPointAssignment.findMany({
    where: { organizationId: input.organizationId, userId: input.userId, endedAt: null },
    select: { id: true, buildingId: true, mode: true, removedBuildingIds: true },
  });
  const kept: Array<{ id: string; buildingId: string; removedBuildingIds: string[] }> = [];
  for (const assignment of active) {
    if (assignmentSurvivesEdit(input.nextBuildingIds, assignment)) {
      kept.push(assignment);
      continue;
    }
    const claimed = await db.userPointAssignment.updateMany({
      where: { id: assignment.id, endedAt: null },
      data: { endedAt: now },
    });
    if (claimed.count === 0) continue;
    await recordAuditLog({
      session: (input.session ?? null) as AuditSession,
      organizationId: input.organizationId,
      action: "staff.point_assignment.end",
      entity: "user",
      entityId: input.userId,
      details: {
        assignmentId: assignment.id,
        buildingId: assignment.buildingId,
        mode: assignment.mode,
        reason: "edited",
        buildingIdsAfter: [...input.nextBuildingIds],
      },
    });
  }
  return kept;
}

/** Перед удалением точки: назначения на неё завершаем с возвратом. */
export async function endAssignmentsAtBuilding(organizationId: string, buildingId: string, session?: Session | null) {
  const active = await db.userPointAssignment.findMany({
    where: { organizationId, buildingId, endedAt: null },
    select: { id: true },
  });
  for (const row of active) {
    await endPointAssignment({ organizationId, assignmentId: row.id, reason: "building_deleted", session });
  }
}

export type ActiveAssignmentView = {
  id: string;
  userId: string;
  buildingId: string;
  buildingName: string;
  mode: PointAssignmentMode;
  /** День возврата `YYYY-MM-DD` по часам организации. */
  returnKey: string;
  /** Куда вернётся (снятые переводом точки) — названия. */
  returnBuildingNames: string[];
};

/** Действующие назначения организации для подписей «Замена до 05.11». */
export async function loadActiveAssignments(
  organizationId: string,
  filter: { userIds?: string[]; buildingId?: string } = {},
): Promise<Map<string, ActiveAssignmentView>> {
  const [org, rows] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }),
    db.userPointAssignment.findMany({
      where: {
        organizationId,
        endedAt: null,
        endsAt: { gt: new Date() },
        ...(filter.userIds ? { userId: { in: filter.userIds } } : {}),
        ...(filter.buildingId ? { buildingId: filter.buildingId } : {}),
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        userId: true,
        buildingId: true,
        mode: true,
        endsAt: true,
        removedBuildingIds: true,
        building: { select: { name: true } },
      },
    }),
  ]);
  const timeZone = org?.timezone || "Europe/Moscow";
  const removedIds = [...new Set(rows.flatMap((row) => row.removedBuildingIds))];
  const removed =
    removedIds.length > 0
      ? await db.building.findMany({ where: { id: { in: removedIds } }, select: { id: true, name: true } })
      : [];
  const nameOf = new Map(removed.map((building) => [building.id, building.name]));
  const out = new Map<string, ActiveAssignmentView>();
  for (const row of rows) {
    out.set(row.userId, {
      id: row.id,
      userId: row.userId,
      buildingId: row.buildingId,
      buildingName: row.building.name,
      mode: row.mode === "transfer" ? "transfer" : "extra",
      returnKey: dateKeyInTimeZone(row.endsAt, timeZone),
      returnBuildingNames: row.removedBuildingIds.map((id) => nameOf.get(id)).filter((name): name is string => Boolean(name)),
    });
  }
  return out;
}

/** «Сегодня» по часам организации — для подписи «Вернётся 05.11» в окне. */
export async function organizationTodayKey(organizationId: string): Promise<string> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
  return dateKeyInTimeZone(new Date(), org?.timezone || "Europe/Moscow");
}
