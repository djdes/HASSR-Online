import { db } from "@/lib/db";
import { ORG_ROSTER_WHERE } from "@/lib/journal-roster";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { getUserDisplayTitle } from "@/lib/user-roles";

/** Сотрудник для выбора в блоках ППК (группа ХАССП, ответственные за ККТ). */
export type PpkStaffOption = { id: string; name: string; title: string; isManager: boolean };

/**
 * Живые сотрудники организации (тот же ростер, что в журналах) с должностью и
 * признаком руководства. Руководство — категория должности «management» или
 * полный доступ к кабинету по роли.
 */
export async function loadPpkStaff(organizationId: string): Promise<PpkStaffOption[]> {
  const users = await db.user.findMany({
    where: { organizationId, ...ORG_ROSTER_WHERE },
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
