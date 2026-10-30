import { forbidden } from "next/navigation";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { isManagementRole } from "@/lib/user-roles";
import { computeStaffing, positionCategoryOf } from "@/lib/staffing";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { PositionsPageClient } from "@/components/staff/positions-page-client";

export const dynamic = "force-dynamic";

/**
 * «Должности» — штатное расписание организации (скан 82, лист 4,
 * «Справочники»): должности по категориям, штатная численность и «занято N
 * из M». Данные — те же, что отдаёт `GET /api/positions` (`computeStaffing`);
 * правки — через `/api/positions*`.
 */
export default async function PositionsPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const organizationId = getActiveOrgId(session);
  // Создать, переименовать, удалить и переставить разрешает API `/api/positions*` —
  // то же правило; остальным страница только показывает.
  const canManage = isManagementRole(session.user.role) || session.user.isRoot === true;

  const [positions, members] = await Promise.all([
    db.jobPosition.findMany({
      where: { organizationId },
      orderBy: [{ categoryKey: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, categoryKey: true, sortOrder: true, plannedHeadcount: true },
    }),
    db.user.findMany({
      where: { organizationId, archivedAt: null, isActive: true, jobPositionId: { not: null } },
      select: { jobPositionId: true, isActive: true, archivedAt: true },
    }),
  ]);
  const staffing = computeStaffing(positions, members);

  return (
    <DomainMessagesBoundary namespaces={["staffPages", "staffManagement"]}>
      <PositionsPageClient
        canManage={canManage}
        totals={staffing.totals}
        positions={staffing.positions.map((position) => ({
          id: position.id,
          name: position.name,
          categoryKey: positionCategoryOf(position.categoryKey),
          sortOrder: position.sortOrder,
          plannedHeadcount: position.plannedHeadcount,
          occupied: position.occupied,
          vacancies: position.vacancies,
          overstaffed: position.overstaffed,
        }))}
      />
    </DomainMessagesBoundary>
  );
}
