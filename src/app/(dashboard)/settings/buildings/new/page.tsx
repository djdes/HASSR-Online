import { forbidden, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { SectionPageHeader } from "@/components/layout/section-page-header";
import { PointWizard } from "@/components/settings/point-wizard-client";

export const dynamic = "force-dynamic";

/**
 * Мастер «+ Добавить точку» (скан 82, лист 5; 2026-10-18): название и адрес →
 * помещения (типовой набор или «как в другой точке») → оборудование → итог.
 * Права — как у «Точек» (`/settings/buildings`).
 */
export default async function NewPointPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  // Консультант уровня «просмотр» точки не заводит.
  if (session.user.partnerAccess?.level === "view") redirect("/settings/buildings");
  const orgId = getActiveOrgId(session);

  const [buildings, equipment] = await Promise.all([
    db.building.findMany({
      where: { organizationId: orgId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        sortOrder: true,
        rooms: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { name: true, kind: true } },
      },
    }),
    db.equipment.findMany({ where: { area: { organizationId: orgId } }, select: { name: true } }),
  ]);
  const t = await getTranslations("settingsManagement.points.wizard");

  return (
    <DomainMessagesBoundary namespaces={["settingsManagement"]}>
      <div className="space-y-5">
        <SectionPageHeader description={t("description")} />
        <div className="max-w-[860px]">
        <PointWizard
          takenNames={buildings.map((building) => building.name)}
          // Новая точка — последней в меню и переключателе (порядок — sortOrder, затем имя).
          sortOrder={buildings.reduce((max, building) => Math.max(max, building.sortOrder + 1), 0)}
          donors={buildings
            .filter((building) => building.rooms.length > 0)
            .map((building) => ({ id: building.id, name: building.name, rooms: building.rooms }))}
          equipmentNames={equipment.map((item) => item.name)}
        />
        </div>
      </div>
    </DomainMessagesBoundary>
  );
}
