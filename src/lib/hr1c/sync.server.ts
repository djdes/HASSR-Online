import type { Prisma } from "@prisma/client";

import { logAudit } from "@/lib/audit";
import { buildingTargets } from "@/lib/building-targets";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/integration-crypto";
import { performOffboarding } from "@/lib/offboarding";
import { bumpSessionVersion } from "@/lib/session-version";
import { createStaffMember } from "@/lib/staff-create";
import { assertPublicBaseUrl, UnsafeUrlError } from "@/lib/supply/safe-url";
import { orgTodayKey } from "@/lib/timezone";

import { createZupClient, ZupError, type FetchLike } from "./odata";
import { planHrSync, summarizePlan, type HrAction, type HrEmployee, type HrPlan, type HrPlanSummary } from "./plan";
import {
  collectDepartments,
  departmentKey,
  planHrPoints,
  pointsForEmployee,
  readDepartmentPointMap,
  type DepartmentPointMap,
  type HrPointUpdate,
} from "./points";

/**
 * Применение плана синхронизации 1С → WeSetup для одной организации.
 *
 * Принять — тем же `createStaffMember`, что кнопка «Добавить сотрудника»
 * (лимит тарифа, доступы к журналам по должности); уволить — тем же путём,
 * что «Уволить»: `isActive=false`, `performOffboarding` (задачи — преемнику),
 * сброс сессий. Роль по смене должности не меняется: повышение прав из
 * внешней системы — решение человека, такая строка уходит в ошибки.
 *
 * Точки (2026-10-31): при включённых точках принятый получает точки по
 * подразделению 1С, у связанных 1С обновляет только поставленные ею же
 * точки (см. src/lib/hr1c/points.ts).
 */

export type HrActor = { id: string | null; name: string | null };

export type HrRunKind = HrAction["kind"] | "points";

export type HrRunResult = {
  mode: "preview" | "apply";
  summary: HrPlanSummary & { points: number };
  /** Что сделано (apply) или будет сделано (preview) — с именами для экрана. */
  actions: Array<{ kind: HrRunKind; fullName: string; detail: string | null }>;
  problems: Array<{ fullName: string; reason: string; detail?: string | null }>;
  errors: string[];
};

const ACTOR_FALLBACK = { id: "1c", name: "1С: ЗУП" };

async function loadState(organizationId: string) {
  const [links, users, positions, organization, connection, targets] = await Promise.all([
    db.hrEmployeeLink.findMany({
      where: { organizationId },
      select: { externalId: true, userId: true, pointsFrom1c: true, pointsSetBy1c: true },
    }),
    db.user.findMany({
      where: { organizationId, isRoot: false },
      select: { id: true, name: true, isActive: true, archivedAt: true, jobPositionId: true, buildingIds: true },
    }),
    db.jobPosition.findMany({ where: { organizationId }, select: { id: true, name: true, categoryKey: true } }),
    db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }),
    db.hrConnection.findUnique({ where: { organizationId }, select: { id: true, departmentPointsJson: true } }),
    buildingTargets(organizationId),
  ]);
  const livePointIds = new Set(targets.filter((id): id is string => id !== null));
  const buildings =
    livePointIds.size > 0
      ? await db.building.findMany({ where: { id: { in: [...livePointIds] } }, select: { id: true, name: true } })
      : [];
  return {
    links,
    rawUsers: users,
    users: users.map((user) => ({ id: user.id, name: user.name, isActive: user.isActive, archived: user.archivedAt !== null, jobPositionId: user.jobPositionId })),
    positions,
    today: orgTodayKey(organization?.timezone || "Europe/Moscow"),
    hasConnection: connection !== null,
    livePointIds,
    pointNames: new Map(buildings.map((building) => [building.id, building.name])),
    map: readDepartmentPointMap(connection?.departmentPointsJson, livePointIds),
  };
}

function pointLabel(ids: readonly string[], names: ReadonlyMap<string, string>): string {
  return ids.length === 0 ? "все точки" : ids.map((id) => names.get(id) ?? id).join(", ");
}

function detailOf(action: HrAction, hirePointsLabel: string | null): string | null {
  if (action.kind === "hire") return [action.positionName, hirePointsLabel].filter(Boolean).join(" · ");
  if (action.kind === "update") return [action.name, action.positionName].filter(Boolean).join(" · ") || null;
  return action.employee.position;
}

type PointsPlan = {
  enabled: boolean;
  map: DepartmentPointMap;
  names: ReadonlyMap<string, string>;
  updates: HrPointUpdate[];
  problems: Array<{ employee: HrEmployee; departmentName: string }>;
};

/** Точки нового сотрудника; undefined — без точек (точки выключены или нет сопоставления). */
function hirePoints(points: PointsPlan, employee: HrEmployee): string[] | undefined {
  return points.enabled ? pointsForEmployee(employee, points.map) : undefined;
}

function describe(plan: HrPlan, points: PointsPlan, mode: "preview" | "apply", errors: string[], appliedUpdates?: HrPointUpdate[]): HrRunResult {
  const pointActions = (appliedUpdates ?? points.updates).filter((update) => update.changed);
  return {
    mode,
    summary: { ...summarizePlan(plan), problems: plan.problems.length + points.problems.length, points: pointActions.length },
    actions: [
      ...plan.actions.map((action) => {
        const hire = action.kind === "hire" ? hirePoints(points, action.employee) : undefined;
        return {
          kind: action.kind,
          fullName: action.employee.fullName,
          detail: detailOf(action, hire ? pointLabel(hire, points.names) : null),
        };
      }),
      ...pointActions.map((update) => ({
        kind: "points" as const,
        fullName: update.fullName ?? update.externalId,
        detail: pointLabel(update.buildingIds, points.names),
      })),
    ],
    problems: [
      ...plan.problems.map((problem) => ({ fullName: problem.employee.fullName, reason: problem.reason })),
      ...points.problems.map((problem) => ({ fullName: problem.employee.fullName, reason: "no_point_mapping", detail: problem.departmentName })),
    ],
    errors,
  };
}

function linkData(employee: HrEmployee) {
  return {
    fullName: employee.fullName,
    position: employee.position,
    hiredAt: employee.hiredAt ? new Date(`${employee.hiredAt}T00:00:00.000Z`) : null,
    dismissedAt: employee.dismissedAt ? new Date(`${employee.dismissedAt}T00:00:00.000Z`) : null,
    lastSeenAt: new Date(),
  };
}

async function upsertLink(organizationId: string, employee: HrEmployee, userId: string, points?: { buildingIds: string[] }) {
  const pointData = points ? { pointsFrom1c: points.buildingIds, pointsSetBy1c: true } : {};
  await db.hrEmployeeLink.upsert({
    where: { organizationId_externalId: { organizationId, externalId: employee.externalId } },
    create: { organizationId, externalId: employee.externalId, userId, ...linkData(employee), ...pointData },
    update: { userId, ...linkData(employee), ...pointData },
  });
}

/** Посчитать план и, если `apply`, выполнить его. */
export async function runHrSync(input: {
  organizationId: string;
  employees: HrEmployee[];
  mode: "preview" | "apply";
  defaultPositionId: string | null;
  actor?: HrActor | null;
}): Promise<HrRunResult> {
  const { organizationId } = input;
  const state = await loadState(organizationId);
  const plan = planHrSync({
    employees: input.employees,
    links: state.links,
    users: state.users,
    positions: state.positions,
    defaultPositionId: input.defaultPositionId,
    today: state.today,
  });

  // Подразделения для экрана сопоставления — при каждом прогоне.
  if (state.hasConnection) {
    await db.hrConnection.update({
      where: { organizationId },
      data: { departmentsJson: collectDepartments(input.employees, state.today) as unknown as Prisma.InputJsonValue },
    });
  }

  // Точки связанных сотрудников (и тех, кого свяжем по ФИО в этом прогоне).
  const userByExternal = new Map(state.links.map((link) => [link.externalId, link.userId]));
  for (const action of plan.actions) if (action.kind === "link") userByExternal.set(action.employee.externalId, action.userId);
  const enabled = state.livePointIds.size > 0;
  const nameOf = new Map(input.employees.map((employee) => [employee.externalId, employee.fullName]));
  const pointPlan = enabled
    ? planHrPoints({
        employees: input.employees,
        userByExternal,
        users: new Map(state.rawUsers.map((user) => [user.id, { buildingIds: user.buildingIds, working: user.isActive && user.archivedAt === null }])),
        setBy1c: new Map(state.links.filter((link) => link.pointsSetBy1c).map((link) => [link.externalId, link.pointsFrom1c])),
        map: state.map,
        livePointIds: state.livePointIds,
        today: state.today,
      })
    : { updates: [], problems: [] };
  // Принятые с подразделением без сопоставления — тоже «проблема».
  const hireProblems = enabled
    ? plan.actions.flatMap((action) =>
        action.kind === "hire" && departmentKey(action.employee) && pointsForEmployee(action.employee, state.map) === undefined
          ? [{ employee: action.employee, departmentName: action.employee.departmentName?.trim() || departmentKey(action.employee) || "" }]
          : [],
      )
    : [];
  const points: PointsPlan = {
    enabled,
    map: state.map,
    names: state.pointNames,
    updates: pointPlan.updates.map((update) => ({ ...update, fullName: nameOf.get(update.externalId) })),
    problems: [...pointPlan.problems, ...hireProblems],
  };
  if (input.mode === "preview") return describe(plan, points, "preview", []);

  const actor = { id: input.actor?.id ?? ACTOR_FALLBACK.id, name: input.actor?.name ?? ACTOR_FALLBACK.name };
  const categoryOf = new Map(state.positions.map((position) => [position.id, position.categoryKey]));
  const userById = new Map(state.users.map((user) => [user.id, user]));
  const errors: string[] = [];
  const done: HrAction[] = [];

  for (const action of plan.actions) {
    try {
      if (action.kind === "hire") {
        const buildingIds = hirePoints(points, action.employee);
        const created = await createStaffMember(organizationId, {
          jobPositionId: action.positionId,
          fullName: action.employee.fullName,
          phone: action.employee.phone ?? undefined,
          ...(buildingIds ? { buildingIds } : {}),
        });
        if (!created.ok) {
          errors.push(`${action.employee.fullName}: ${created.error}`);
          continue;
        }
        // Точки принятого ставит 1С: пока их не поменяли руками, 1С их и обновляет.
        await upsertLink(organizationId, action.employee, created.user.id, enabled ? { buildingIds: buildingIds ?? [] } : undefined);
      } else if (action.kind === "link") {
        await upsertLink(organizationId, action.employee, action.userId);
      } else if (action.kind === "update") {
        const current = userById.get(action.userId);
        const sameCategory =
          !action.positionId || !current?.jobPositionId || categoryOf.get(current.jobPositionId) === categoryOf.get(action.positionId);
        if (!sameCategory) {
          errors.push(`${action.employee.fullName}: в 1С должность «${action.positionName}» — смена категории должности и прав делается вручную`);
        }
        const data: Prisma.UserUpdateManyMutationInput = {
          ...(action.name ? { name: action.name } : {}),
          ...(action.positionId && sameCategory ? { jobPositionId: action.positionId, positionTitle: action.positionName } : {}),
        };
        if (Object.keys(data).length > 0) {
          await db.user.updateMany({ where: { id: action.userId, organizationId }, data });
        }
        await upsertLink(organizationId, action.employee, action.userId);
      } else {
        const deactivated = await db.user.updateMany({
          where: { id: action.userId, organizationId, isActive: true },
          data: { isActive: false },
        });
        if (deactivated.count > 0) {
          await performOffboarding({ userId: action.userId, organizationId, actorId: actor.id, actorName: actor.name });
          await bumpSessionVersion(action.userId).catch(() => null);
        }
        await upsertLink(organizationId, action.employee, action.userId);
      }
      done.push(action);
    } catch (error) {
      console.error(`[hr1c] ${action.kind} failed org=${organizationId}`, error instanceof Error ? error.message : error);
      errors.push(`${action.employee.fullName}: не получилось — повторим при следующем прогоне`);
    }
  }

  // Точки связанных сотрудников: меняем и запоминаем, что их ставит 1С.
  const appliedPoints: HrPointUpdate[] = [];
  for (const update of points.updates) {
    const employee = input.employees.find((item) => item.externalId === update.externalId);
    if (!employee) continue;
    try {
      if (update.changed) {
        await db.user.updateMany({ where: { id: update.userId, organizationId }, data: { buildingIds: update.buildingIds } });
        await bumpSessionVersion(update.userId).catch(() => null);
      }
      await upsertLink(organizationId, employee, update.userId, { buildingIds: update.buildingIds });
      appliedPoints.push(update);
    } catch (error) {
      console.error(`[hr1c] points failed org=${organizationId}`, error instanceof Error ? error.message : error);
      errors.push(`${employee.fullName}: точки не обновились — повторим при следующем прогоне`);
    }
  }

  // Остальные встреченные сотрудники — отметить, что 1С их прислала.
  const seen = input.employees.map((employee) => employee.externalId);
  if (seen.length > 0) {
    await db.hrEmployeeLink.updateMany({ where: { organizationId, externalId: { in: seen } }, data: { lastSeenAt: new Date() } });
  }
  const result = describe({ ...plan, actions: done }, points, "apply", errors, appliedPoints);
  await logAudit({
    organizationId,
    userId: actor.id,
    userName: actor.name,
    action: "hr1c.sync",
    entity: "HrConnection",
    details: { ...result.summary, errors: errors.length },
  });
  return result;
}

export class HrSyncError extends Error {}

/** Прогон по опубликованной базе (OData): забрать сотрудников и посчитать или применить план. */
export async function runHrConnection(
  organizationId: string,
  mode: "preview" | "apply",
  options: { actor?: HrActor | null; fetch?: FetchLike } = {},
): Promise<HrRunResult> {
  const connection = await db.hrConnection.findUnique({ where: { organizationId } });
  if (!connection?.odataUrl || !connection.credentialsEnc) {
    throw new HrSyncError("Адрес OData не указан — данные приходят из обработки 1С через API");
  }
  try {
    const creds = JSON.parse(decryptSecret(connection.credentialsEnc)) as { login: string; password: string };
    const baseUrl = await assertPublicBaseUrl(connection.odataUrl);
    const employees = await createZupClient({ baseUrl, ...creds }, { fetch: options.fetch }).employees();
    const result = await runHrSync({
      organizationId,
      employees,
      mode,
      defaultPositionId: connection.defaultPositionId,
      actor: options.actor ?? (connection.createdById ? { id: connection.createdById, name: null } : null),
    });
    await db.hrConnection.update({
      where: { organizationId },
      data: { lastSyncAt: new Date(), lastError: null, ...(mode === "apply" ? { lastResult: { ...result.summary, errors: result.errors.length } } : {}) },
    });
    return result;
  } catch (error) {
    const message =
      error instanceof ZupError || error instanceof UnsafeUrlError ? error.message : "Не удалось получить сотрудников из 1С — повторим позже";
    await db.hrConnection.update({ where: { organizationId }, data: { lastError: message } });
    throw new HrSyncError(message);
  }
}
