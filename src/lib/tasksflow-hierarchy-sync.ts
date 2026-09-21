/**
 * Синхронизация WeSetup-иерархии (ManagerScope) с TasksFlow.
 *
 * Сценарий: руководитель хочет видеть в TasksFlow задачи только своих
 * подчинённых, не задачи всей орги. На WeSetup иерархия редактируется
 * в /settings/staff-hierarchy (модель ManagerScope: viewMode +
 * viewJobPositionIds + viewUserIds). Но TasksFlow про эту иерархию
 * ничего не знает — его users.is_admin = boolean.
 *
 * Решение: после каждого изменения иерархии (или по «Sync now»)
 * вычисляем для каждого менеджера list-of-tasksflow-user-ids, которыми
 * он руководит, и пушим это на TF через setManagedWorkers. На стороне
 * TF фильтруется /api/tasks и /api/users по этому списку.
 *
 * Кто считается «менеджером»:
 *   • Любой User с записью в ManagerScope, у которой viewMode != "all"
 *     и не "none" (т.е. реально кого-то ограничивает).
 *   • Если viewMode = "all" — менеджер видит всех, специально пушить
 *     ничего не надо: достаточно очистить list (он будет видеть всех
 *     своих подчинённых; на стороне TF проверим на admin/no-scope).
 *
 * Для не-менеджеров (обычных воркеров, которые видят только свои
 * задачи) — на TF это default-state без managed_worker_ids, ничего
 * пушить не нужно.
 */

import { db } from "@/lib/db";
import {
  tasksflowClientFor,
  TasksFlowError,
  type TasksFlowClientType,
} from "@/lib/tasksflow-client";
import { isManagementRole } from "@/lib/user-roles";
import type { ManagerScope } from "@prisma/client";
import { NOT_COMMISSION_WHERE } from "@/lib/journal-roster";

type ScopeLike = Pick<
  ManagerScope,
  "managerId" | "viewMode" | "viewJobPositionIds" | "viewUserIds"
>;

type UserForScope = {
  id: string;
  jobPositionId: string | null;
  isActive: boolean;
  archivedAt: Date | null;
  role: string | null;
  isRoot: boolean;
};

/**
 * Считает: какие WeSetup-userId видны менеджеру согласно его scope.
 * Не делает round-trip к TF; работает целиком в WeSetup-БД.
 *
 * 2026-04-30: для viewMode="all" исключаем management-роли и ROOT —
 * раньше заведующая (head_chef) с viewMode="all" видела admin'a, owner'а
 * и других менеджеров в TasksFlow (они попадали в её managedWorkerIds
 * → её dashboard показывал их task'и). Теперь "все" в scope-е менеджера
 * означает «все НЕ-управленческие сотрудники» (cook, waiter, operator).
 * Если орг хочет включить какого-то конкретного менеджера в видимость
 * — используется viewMode="specific_users" с явным выбором.
 */
function computeVisibleWesetupUserIds(
  scope: ScopeLike,
  allUsers: ReadonlyArray<UserForScope>
): string[] {
  const active = allUsers.filter((u) => u.isActive && u.archivedAt === null);
  if (scope.viewMode === "all") {
    return active
      .filter((u) => !u.isRoot && !isManagementRole(u.role))
      .map((u) => u.id);
  }
  if (scope.viewMode === "none") {
    return [];
  }
  if (scope.viewMode === "job_positions") {
    const positions = new Set(scope.viewJobPositionIds);
    return active
      .filter((u) => u.jobPositionId !== null && positions.has(u.jobPositionId))
      .map((u) => u.id);
  }
  if (scope.viewMode === "specific_users") {
    const allowed = new Set(scope.viewUserIds);
    return active.filter((u) => allowed.has(u.id)).map((u) => u.id);
  }
  return [];
}

export type HierarchySyncReport = {
  managersUpdated: number;
  managersSkipped: number;
  errors: number;
  details: Array<{
    managerName: string;
    tfUserId: number | null;
    pushed: number;
    error?: string;
  }>;
};

/**
 * Pусh всех ManagerScope-ов организации в TasksFlow.
 * Вызывается вручную из /settings/staff-hierarchy ИЛИ автоматически
 * после сохранения scope.
 */
export async function syncHierarchyToTasksflow(
  organizationId: string
): Promise<HierarchySyncReport> {
  const report: HierarchySyncReport = {
    managersUpdated: 0,
    managersSkipped: 0,
    errors: 0,
    details: [],
  };

  const integration = await db.tasksFlowIntegration.findFirst({
    where: { organizationId, enabled: true },
  });
  if (!integration) {
    return report; // нет интеграции — нечего синкать
  }

  const [scopes, allUsers, userLinks, positions] = await Promise.all([
    db.managerScope.findMany({
      where: { organizationId },
      include: {
        manager: {
          select: { id: true, name: true },
        },
      },
    }),
    db.user.findMany({
      where: { organizationId },
      select: {
        id: true,
        jobPositionId: true,
        isActive: true,
        archivedAt: true,
        role: true,
        isRoot: true,
      },
    }),
    db.tasksFlowUserLink.findMany({
      where: {
        integrationId: integration.id,
        tasksflowUserId: { not: null },
      },
      select: { wesetupUserId: true, tasksflowUserId: true },
    }),
    db.jobPosition.findMany({
      where: { organizationId },
      select: { id: true, visibleUserIds: true },
    }),
  ]);

  const tfIdByWesetup = new Map<string, number>();
  for (const link of userLinks) {
    if (link.tasksflowUserId !== null) {
      tfIdByWesetup.set(link.wesetupUserId, link.tasksflowUserId);
    }
  }
  // Приоритетный источник иерархии: per-position visibleUserIds.
  // Если у должности задан непустой список — все пользователи этой
  // должности получат именно этот scope (перекрывает per-user
  // ManagerScope). Это новая модель из /settings/position-staff-visibility.
  const visibilityByPosition = new Map<string, string[]>();
  for (const p of positions) {
    if (p.visibleUserIds.length > 0) {
      visibilityByPosition.set(p.id, p.visibleUserIds);
    }
  }
  // userId → jobPositionId для быстрой резолюции ниже.
  const positionByUser = new Map<string, string | null>();
  for (const u of allUsers) {
    positionByUser.set(u.id, u.jobPositionId);
  }

  const client: TasksFlowClientType = tasksflowClientFor(integration);

  // Менеджеры с per-user scope. Каждого пушим через client.setManagedWorkers.
  // Если у менеджера job-position scope установлен — он перекрывает
  // ManagerScope (per-position приоритетнее, проще и автоматически
  // распространяется на новых сотрудников этой должности).
  const managerIdsHandled = new Set<string>();

  for (const scope of scopes) {
    const managerName = scope.manager.name;
    const managerTfId = tfIdByWesetup.get(scope.managerId);
    managerIdsHandled.add(scope.managerId);
    if (!managerTfId) {
      report.managersSkipped += 1;
      report.details.push({
        managerName,
        tfUserId: null,
        pushed: 0,
        error: "Не привязан к TasksFlow",
      });
      continue;
    }

    // Position-level visibility перебивает scope, если задан.
    const positionId = positionByUser.get(scope.managerId);
    const positionVisible = positionId
      ? visibilityByPosition.get(positionId)
      : undefined;
    const visibleWesetupIds = positionVisible ?? computeVisibleWesetupUserIds(scope, allUsers);

    const subordinateTfIds = visibleWesetupIds
      .filter((wesetupId) => wesetupId !== scope.managerId)
      .map((wesetupId) => tfIdByWesetup.get(wesetupId))
      .filter((tfId): tfId is number => typeof tfId === "number");

    try {
      const result = await client.setManagedWorkers(
        managerTfId,
        subordinateTfIds
      );
      report.managersUpdated += 1;
      report.details.push({
        managerName,
        tfUserId: managerTfId,
        pushed: result.count,
      });
    } catch (err) {
      report.errors += 1;
      report.details.push({
        managerName,
        tfUserId: managerTfId,
        pushed: 0,
        error:
          err instanceof TasksFlowError
            ? `${err.status}: ${err.message}`
            : err instanceof Error
              ? err.message
              : String(err),
      });
    }
  }

  // Второй проход: пользователи БЕЗ ManagerScope per-user, но
  // принадлежащие должности с visibleUserIds. До этой фичи они
  // были «обычными воркерами», теперь становятся менеджерами своей
  // должности с готовым scope. Без этого прохода новый шеф-повар,
  // у которого нет персонального ManagerScope, остался бы без
  // подчинённых после sync.
  const usersToFetch = await db.user.findMany({
    where: {
      organizationId,
      isActive: true,
      archivedAt: null,
      isRoot: false,
      ...NOT_COMMISSION_WHERE,
      jobPositionId: { not: null },
    },
    select: {
      id: true,
      name: true,
      jobPositionId: true,
    },
  });
  for (const user of usersToFetch) {
    if (managerIdsHandled.has(user.id)) continue;
    const positionVisible = user.jobPositionId
      ? visibilityByPosition.get(user.jobPositionId)
      : undefined;
    if (!positionVisible) continue;

    const userTfId = tfIdByWesetup.get(user.id);
    if (!userTfId) {
      report.managersSkipped += 1;
      report.details.push({
        managerName: user.name,
        tfUserId: null,
        pushed: 0,
        error: "Не привязан к TasksFlow (position-scope)",
      });
      continue;
    }

    const subordinateTfIds = positionVisible
      .filter((wesetupId) => wesetupId !== user.id)
      .map((wesetupId) => tfIdByWesetup.get(wesetupId))
      .filter((tfId): tfId is number => typeof tfId === "number");

    try {
      const result = await client.setManagedWorkers(userTfId, subordinateTfIds);
      report.managersUpdated += 1;
      report.details.push({
        managerName: user.name,
        tfUserId: userTfId,
        pushed: result.count,
      });
    } catch (err) {
      report.errors += 1;
      report.details.push({
        managerName: user.name,
        tfUserId: userTfId,
        pushed: 0,
        error:
          err instanceof TasksFlowError
            ? `${err.status}: ${err.message}`
            : err instanceof Error
              ? err.message
              : String(err),
      });
    }
  }

  return report;
}
