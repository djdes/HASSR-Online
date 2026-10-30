import { forbidden } from "next/navigation";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { loadDiagramRecord } from "@/lib/ppk/diagram.server";
import { DiagramPage } from "@/components/production-control/diagram-page";

export const dynamic = "force-dynamic";

/** План помещений: название, автосохранение и редактор. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const organizationId = getActiveOrgId(session);

  const record = await loadDiagramRecord(organizationId, "floor-plan", id);
  const areas = await db.area.findMany({
    where: { organizationId },
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
