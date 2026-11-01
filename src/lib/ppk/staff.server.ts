import type { Prisma } from "@prisma/client";
import { staffAtBuildingWhere } from "@/lib/building-settings";
import { db } from "@/lib/db";
import { ORG_ROSTER_WHERE } from "@/lib/journal-roster";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { getUserDisplayTitle } from "@/lib/user-roles";
import { ppkWhere, type PpkScope } from "./scope";

/** Сотрудник для выбора в блоках ППК (группа ХАССП, ответственные за ККТ). */
export type PpkStaffOption = { id: string; name: string; title: string; isManager: boolean };

/** Блоки ППК, где записаны люди (группа, политика, ККТ, версии документов, совещания). */
const USER_REF_BLOCKS = ["team", "policy", "control-points", "doc-versions", "team-meetings"];

/** Люди, на которых уже ссылаются записи ППК этой точки (скопированная группа и т.п.). */
async function ppkReferencedUserIds(scope: PpkScope): Promise<string[]> {
  const rows = await db.ppkRecord.findMany({
    where: { ...ppkWhere(scope), block: { in: USER_REF_BLOCKS } },
    select: { data: true },
  });
  const ids = new Set<string>();
  for (const row of rows) {
    const data = row.data as Record<string, unknown> | null;
    for (const key of ["userId", "approvedById", "responsibleId"]) {
      const value = data?.[key];
      if (typeof value === "string") ids.add(value);
    }
    if (Array.isArray(data?.attendeeIds)) {
      for (const value of data.attendeeIds) if (typeof value === "string") ids.add(value);
    }
  }
  return [...ids];
}

/**
 * Люди ППК области (2026-11-01, «ППК на точку»): у точки — её сотрудники и
 * люди без точек, плюс те, кто уже записан в её ППК (скопированная из
 * организации группа не теряет имён); человека другой точки заново не
 * выбрать. Уровень организации — все, как раньше.
 */
export async function ppkStaffWhere(scope: PpkScope): Promise<Prisma.UserWhereInput> {
  if (!scope.buildingId) return {};
  const atPoint = staffAtBuildingWhere(scope.buildingId);
  const referenced = await ppkReferencedUserIds(scope);
  return referenced.length ? { OR: [atPoint, { id: { in: referenced } }] } : atPoint;
}

/**
 * Живые сотрудники организации (тот же ростер, что в журналах) с должностью и
 * признаком руководства. Руководство — категория должности «management» или
 * полный доступ к кабинету по роли. ППК точки — люди точки (`ppkStaffWhere`).
 */
export async function loadPpkStaff(scope: PpkScope): Promise<PpkStaffOption[]> {
  const users = await db.user.findMany({
    // ORG_ROSTER_WHERE сам занимает `AND` — условие точки кладём рядом.
    where: { AND: [{ organizationId: scope.organizationId, ...ORG_ROSTER_WHERE }, await ppkStaffWhere(scope)] },
    select: {
      id: true,
      name: true,
      role: true,
      positionTitle: true,
      jobPosition: { select: { name: true, categoryKey: true } },
    },
  });
  return users
    .map((user) => ({
      id: user.id,
      name: user.name,
      title: getUserDisplayTitle(user),
      isManager:
        user.jobPosition?.categoryKey === "management" || hasFullWorkspaceAccess({ role: user.role }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}
