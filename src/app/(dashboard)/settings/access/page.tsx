import { redirect } from "next/navigation";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { CHECKLIST_CODE } from "@/lib/custom-checklists";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { ALL_PRESETS, hasCapability, presetCapabilitiesFor } from "@/lib/permission-presets";
import { sessionHasPermission } from "@/lib/permissions-server";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { positionCategoryOf } from "@/lib/staffing";
import {
  ACCESS_SECTIONS,
  personPreset,
  personSections,
  presetHolders,
  presetSections,
  typicalPresetGroup,
} from "@/lib/staff-access-overview";
import { isManagementRole } from "@/lib/user-roles";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { AccessPageClient } from "@/components/staff/access-page-client";
import { pointScopeForUser } from "@/lib/building-scope";

export const dynamic = "force-dynamic";

/**
 * «Доступ и права» — одна страница вместо четырёх (скан 82, лист 4): наборы
 * прав и кто их получает, набор у каждого сотрудника, какие разделы меню он
 * видит, сводка по журналам и видимости коллег. Подробные редакторы —
 * прежние страницы (`/settings/journal-access`, `/settings/journals-by-position`,
 * `/settings/role-presets`, `/settings/permissions`): ссылки на них — с теми
 * же правами, что у самих страниц.
 */
export default async function AccessPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/journals");
  const organizationId = getActiveOrgId(session);
  // Набор человеку и «Настроить наборы» — администратору (как API и /settings/role-presets).
  const canChangePresets = hasCapability(session.user, "admin.full");
  // «Права доступа» пускают по праву из БД — блок с ссылкой показываем так же.
  const showPermissions = await sessionHasPermission(session, "settings.permissions");

  const activeCodes = ACTIVE_JOURNAL_CATALOG.map((journal) => journal.code);
  const [organization, positions, users, journalGrants, checklistRows] = await Promise.all([
    db.organization.findUnique({
      where: { id: organizationId },
      select: {
        presetCapabilitiesJson: true,
        // Руководитель точки (фаза 2 «Офис и точки») видит меньше разделов.
        perLocationJournals: true,
        buildings: { select: { id: true, kind: true } },
      },
    }),
    db.jobPosition.findMany({
      where: { organizationId },
      orderBy: [{ categoryKey: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        categoryKey: true,
        visibleUserIds: true,
        _count: { select: { users: { where: { isActive: true, archivedAt: null } } } },
      },
    }),
    db.user.findMany({
      where: { organizationId, isActive: true, archivedAt: null, isRoot: false },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        role: true,
        permissionPreset: true,
        positionTitle: true,
        journalAccessMigrated: true,
        permissionsJson: true,
        buildingIds: true,
        jobPosition: { select: { name: true, categoryKey: true, permissionsJson: true } },
      },
    }),
    // Как на «Должность × журнал»: считаются только журналы из каталога.
    db.jobPositionJournalAccess.findMany({
      where: { organizationId, template: { code: { in: activeCodes } } },
      select: { jobPositionId: true },
    }),
    db.userJournalAccess.findMany({
      where: { user: { organizationId }, templateCode: CHECKLIST_CODE },
      select: { userId: true, templateCode: true, canRead: true, canWrite: true, canFinalize: true },
    }),
  ]);

  const overrides =
    organization?.presetCapabilitiesJson &&
    typeof organization.presetCapabilitiesJson === "object" &&
    !Array.isArray(organization.presetCapabilitiesJson)
      ? (organization.presetCapabilitiesJson as Record<string, string[]>)
      : null;

  const positionName = (user: (typeof users)[number]) =>
    user.jobPosition?.name?.trim() || user.positionTitle?.trim() || null;
  const holders = presetHolders(
    users.map((user) => ({ role: user.role, permissionPreset: user.permissionPreset, positionName: positionName(user) }))
  );
  const checklistByUser = new Map(checklistRows.map((row) => [row.userId, row]));

  const people = users.map((user) => {
    const preset = personPreset(user);
    return {
      id: user.id,
      name: user.name,
      position: positionName(user),
      isManager:
        positionCategoryOf(user.jobPosition?.categoryKey) === "management" || isManagementRole(user.role),
      effective: preset.effective,
      byPosition: preset.byPosition,
      manual: preset.manual,
      isSelf: user.id === session.user.id,
      sections: personSections(
        {
          id: user.id,
          role: user.role,
          permissionPreset: user.permissionPreset,
          checklistAcl: { migrated: user.journalAccessMigrated, row: checklistByUser.get(user.id) },
          permissionActor: {
            userPermissionsJson: user.permissionsJson,
            positionPermissionsJson: user.jobPosition?.permissionsJson ?? null,
            positionCategoryKey: user.jobPosition?.categoryKey ?? null,
            fallbackCategoryKey: isManagementRole(user.role) ? "management" : "staff",
          },
          pointScope: pointScopeForUser({
            enabled: organization?.perLocationJournals === true,
            buildings: organization?.buildings ?? [],
            userBuildingIds: user.buildingIds,
          }),
        },
        overrides
      ),
    };
  });

  const grantsByPosition = new Map<string, number>();
  for (const grant of journalGrants) {
    grantsByPosition.set(grant.jobPositionId, (grantsByPosition.get(grant.jobPositionId) ?? 0) + 1);
  }

  return (
    <DomainMessagesBoundary namespaces={["staffPages", "staffManagement", "productionControl"]}>
      <AccessPageClient
        canChangePresets={canChangePresets}
        showPermissions={showPermissions}
        sections={[...ACCESS_SECTIONS]}
        presets={ALL_PRESETS.map((preset) => {
          const group = typicalPresetGroup(preset);
          return {
            value: preset,
            capabilities: presetCapabilitiesFor(preset, overrides),
            holders: holders[preset],
            group,
            sections: presetSections(preset, group, overrides),
          };
        })}
        people={people}
        journals={{
          total: activeCodes.length,
          // Сотрудники с личным списком журналов (руководство видит все журналы).
          personal: users.filter((user) => user.journalAccessMigrated && !isManagementRole(user.role)).length,
          positions: positions.map((position) => ({
            id: position.id,
            name: position.name,
            categoryKey: positionCategoryOf(position.categoryKey),
            people: position._count.users,
            journals: grantsByPosition.get(position.id) ?? 0,
          })),
        }}
        visibility={{
          total: positions.length,
          configured: positions
            .filter((position) => position.visibleUserIds.length > 0)
            .map((position) => ({ id: position.id, name: position.name, sees: position.visibleUserIds.length })),
        }}
      />
    </DomainMessagesBoundary>
  );
}
