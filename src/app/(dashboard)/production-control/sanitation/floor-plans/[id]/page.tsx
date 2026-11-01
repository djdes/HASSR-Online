import { forbidden } from "next/navigation";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { loadDiagramRecord } from "@/lib/ppk/diagram.server";
import { DiagramPage } from "@/components/production-control/diagram-page";
import { ppkPageScope } from "@/lib/ppk/access.server";
import { buildingWhere } from "@/lib/building-scope";

export const dynamic = "force-dynamic";

/** План помещений: название, автосохранение и редактор. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const organizationId = getActiveOrgId(session);
  // ППК на точку (2026-11-01): ППК точки из шапки или организации.
  const scope = await ppkPageScope(session);

  const record = await loadDiagramRecord(scope, "floor-plan", id);
  // Цеха точки ППК и общие (2026-11-01, «ППК на точку»).
  const areas = await db.area.findMany({
    where: { organizationId, ...buildingWhere(scope.buildingId) },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <DiagramPage
      id={record.id}
      kind="floor-plan"
      basePath="/production-control/sanitation/floor-plans"
      initial={record.data}
      areas={areas}
      controlNumbers={[]}
    />
  );
}
