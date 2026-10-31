import type { Prisma } from "@prisma/client";

import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/integration-crypto";
import { performOffboarding } from "@/lib/offboarding";
import { bumpSessionVersion } from "@/lib/session-version";
import { createStaffMember } from "@/lib/staff-create";
import { assertPublicBaseUrl, UnsafeUrlError } from "@/lib/supply/safe-url";
import { orgTodayKey } from "@/lib/timezone";

import { createZupClient, ZupError, type FetchLike } from "./odata";
import { planHrSync, summarizePlan, type HrAction, type HrEmployee, type HrPlan, type HrPlanSummary } from "./plan";

/**
 * Применение плана синхронизации 1С → WeSetup для одной организации.
 *
 * Принять — тем же `createStaffMember`, что кнопка «Добавить сотрудника»
 * (лимит тарифа, доступы к журналам по должности); уволить — тем же путём,
 * что «Уволить»: `isActive=false`, `performOffboarding` (задачи — преемнику),
 * сброс сессий. Роль по смене должности не меняется: повышение прав из
 * внешней системы — решение человека, такая строка уходит в ошибки.
 */

export type HrActor = { id: string | null; name: string | null };

export type HrRunResult = {
  mode: "preview" | "apply";
  summary: HrPlanSummary;
  /** Что сделано (apply) или будет сделано (preview) — с именами для экрана. */
  actions: Array<{ kind: HrAction["kind"]; fullName: string; detail: string | null }>;
  problems: Array<{ fullName: string; reason: string }>;
  errors: string[];
};

const ACTOR_FALLBACK = { id: "1c", name: "1С: ЗУП" };

async function loadState(organizationId: string) {
  const [links, users, positions, organization] = await Promise.all([
    db.hrEmployeeLink.findMany({ where: { organizationId }, select: { externalId: true, userId: true } }),
    db.user.findMany({
      where: { organizationId, isRoot: false },
      select: { id: true, name: true, isActive: true, archivedAt: true, jobPositionId: true },
    }),
    db.jobPosition.findMany({ where: { organizationId }, select: { id: true, name: true, categoryKey: true } }),
    db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }),
  ]);
  return {
    links,
    users: users.map((user) => ({ id: user.id, name: user.name, isActive: user.isActive, archived: user.archivedAt !== null, jobPositionId: user.jobPositionId })),
    positions,
    today: orgTodayKey(organization?.timezone || "Europe/Moscow"),
  };
}

function detailOf(action: HrAction): string | null {
  if (action.kind === "hire") return action.positionName;
  if (action.kind === "update") return [action.name, action.positionName].filter(Boolean).join(" · ") || null;
  return action.employee.position;
}

function describe(plan: HrPlan, mode: "preview" | "apply", errors: string[]): HrRunResult {
  return {
    mode,
    summary: summarizePlan(plan),
    actions: plan.actions.map((action) => ({ kind: action.kind, fullName: action.employee.fullName, detail: detailOf(action) })),
    problems: plan.problems.map((problem) => ({ fullName: problem.employee.fullName, reason: problem.reason })),
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

async function upsertLink(organizationId: string, employee: HrEmployee, userId: string) {
  await db.hrEmployeeLink.upsert({
    where: { organizationId_externalId: { organizationId, externalId: employee.externalId } },
    create: { organizationId, externalId: employee.externalId, userId, ...linkData(employee) },
    update: { userId, ...linkData(employee) },
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
  if (input.mode === "preview") return describe(plan, "preview", []);

  const actor = { id: input.actor?.id ?? ACTOR_FALLBACK.id, name: input.actor?.name ?? ACTOR_FALLBACK.name };
  const categoryOf = new Map(state.positions.map((position) => [position.id, position.categoryKey]));
  const userById = new Map(state.users.map((user) => [user.id, user]));
  const errors: string[] = [];
  const done: HrAction[] = [];

  for (const action of plan.actions) {
    try {
      if (action.kind === "hire") {
        const created = await createStaffMember(organizationId, {
          jobPositionId: action.positionId,
          fullName: action.employee.fullName,
          phone: action.employee.phone ?? undefined,
        });
        if (!created.ok) {
          errors.push(`${action.employee.fullName}: ${created.error}`);
          continue;
        }
        await upsertLink(organizationId, action.employee, created.user.id);
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

  // Остальные встреченные сотрудники — отметить, что 1С их прислала.
  const seen = input.employees.map((employee) => employee.externalId);
  if (seen.length > 0) {
    await db.hrEmployeeLink.updateMany({ where: { organizationId, externalId: { in: seen } }, data: { lastSeenAt: new Date() } });
  }
  const result = describe({ ...plan, actions: done }, "apply", errors);
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
