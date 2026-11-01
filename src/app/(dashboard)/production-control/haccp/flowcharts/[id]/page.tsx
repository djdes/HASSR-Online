import { forbidden } from "next/navigation";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { loadDiagramRecord, loadControlNumbers } from "@/lib/ppk/diagram.server";
import { DiagramPage } from "@/components/production-control/diagram-page";
import { ppkPageScope } from "@/lib/ppk/access.server";

export const dynamic = "force-dynamic";

/** Блок-схема: название, автосохранение и редактор. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const organizationId = getActiveOrgId(session);
  // ППК на точку (2026-11-01): ППК точки из шапки или организации.
  const scope = await ppkPageScope(session);

  const record = await loadDiagramRecord(scope, "flowchart", id);
  const controlNumbers = await loadControlNumbers(scope);

  return (
    <DiagramPage
      id={record.id}
      kind="flowchart"
      basePath="/production-control/haccp/flowcharts"
      initial={record.data}
      areas={[]}
      controlNumbers={controlNumbers}
    />
  );
}
