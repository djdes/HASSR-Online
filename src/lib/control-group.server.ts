import { describeManagerScope, type ScopeSummary } from "@/lib/control-group";
import { db } from "@/lib/db";
import { JOURNAL_ACCESS_CATALOG } from "@/lib/journal-access-catalog";
import type { ManagerScope } from "@/lib/manager-scope";
import {
  defaultPresetFromRole,
  effectivePreset,
  isValidPreset,
  type PermissionPreset,
} from "@/lib/permission-presets";
import { isManagementRole } from "@/lib/user-roles";

export type ControlGroupMember = {
  id: string;
  name: string;
  position: string;
  role: string;
  /** Набор, который вернётся, если убрать из группы («по должности»). */
  defaultPreset: PermissionPreset;
  scopeId: string | null;
  scope: ScopeSummary;
};

export type ControlGroupCandidate = {
  id: string;
  name: string;
  position: string;
  permissionPreset: PermissionPreset | null;
  effectivePreset: PermissionPreset;
  /** Руководство — для групп «Руководство / Сотрудники» в выборе. */
  isManager: boolean;
};

/**
 * Участники контроль-группы и кандидаты на «Добавить» — общий источник
 * `GET /api/staff/control-group` и страницы `/settings/control-group`.
 *
 *   members[]    — сотрудники с пресетом `control_group`: должность и кратко
 *                  их «Иерархия» (`ManagerScope`);
 *   candidates[] — активные сотрудники вне контроль-группы, кроме себя (себе
 *                  набор без «Администратора» не поставить).
 */
export async function loadControlGroup(
  organizationId: string,
  viewerId: string
): Promise<{ members: ControlGroupMember[]; candidates: ControlGroupCandidate[] }> {
  const [users, positions, scopes] = await Promise.all([
    db.user.findMany({
      where: { organizationId, archivedAt: null, isActive: true, isRoot: false },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        role: true,
        permissionPreset: true,
        positionTitle: true,
        jobPositionId: true,
        jobPosition: { select: { name: true, categoryKey: true } },
      },
    }),
    db.jobPosition.findMany({ where: { organizationId }, select: { id: true, name: true } }),
    db.managerScope.findMany({ where: { organizationId } }),
  ]);

  const lookup = {
    positions: new Map(positions.map((position) => [position.id, position.name])),
    users: new Map(users.map((user) => [user.id, user.name])),
    journals: new Map<string, string>(JOURNAL_ACCESS_CATALOG.map((item) => [item.code, item.name])),
  };
  const scopeByManager = new Map(scopes.map((scope) => [scope.managerId, scope]));
  const positionOf = (user: (typeof users)[number]) =>
    user.jobPosition?.name?.trim() || user.positionTitle?.trim() || "";

  const members = users
    .filter((user) => user.permissionPreset === "control_group")
    .map((user): ControlGroupMember => {
      const row = scopeByManager.get(user.id);
      const scope: ManagerScope | null = row
        ? {
            id: row.id,
            managerId: row.managerId,
            viewMode: (["all", "job_positions", "specific_users", "none"].includes(row.viewMode)
              ? row.viewMode
              : "all") as ManagerScope["viewMode"],
            viewJobPositionIds: row.viewJobPositionIds,
            viewUserIds: row.viewUserIds,
            assignableJournalCodes: row.assignableJournalCodes,
          }
        : null;
      return {
        id: user.id,
        name: user.name,
        position: positionOf(user),
        role: user.role,
        defaultPreset: defaultPresetFromRole(user.role),
        scopeId: row?.id ?? null,
        scope: describeManagerScope(scope, lookup),
      };
    });

  const candidates = users
    .filter((user) => user.permissionPreset !== "control_group" && user.id !== viewerId)
    .map(
      (user): ControlGroupCandidate => ({
        id: user.id,
        name: user.name,
        position: positionOf(user),
        permissionPreset: user.permissionPreset && isValidPreset(user.permissionPreset) ? user.permissionPreset : null,
        effectivePreset: effectivePreset(user),
        isManager: user.jobPosition?.categoryKey === "management" || isManagementRole(user.role),
      })
    );

  return { members, candidates };
}
