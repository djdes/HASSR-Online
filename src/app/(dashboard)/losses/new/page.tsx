import { getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { visibleObjectBuildingIds } from "@/lib/point-objects.server";
import { LossForm } from "@/components/losses/loss-form";

export default async function NewLossPage() {
  const session = await requireAuth();
  const t = await getTranslations("productionLosses");
  // Цеха точки в шапке и общие; без точки в шапке — точек человека в пределах
  // руководителя точки, как /api/areas (2026-11-01, «точка видит только своё»).
  const visibleIds = await visibleObjectBuildingIds(session);
  const areas = await db.area.findMany({
    where: {
      organizationId: getActiveOrgId(session),
      ...(visibleIds ? { OR: [{ buildingId: { in: visibleIds } }, { buildingId: null }] } : {}),
    },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-5">
      <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold">{t("newTitle")}</h1>
      <LossForm areas={areas} />
    </div>
  );
}
