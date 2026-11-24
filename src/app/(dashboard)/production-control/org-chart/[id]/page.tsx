import { forbidden } from "next/navigation";
import { requireAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { loadDiagramRecord } from "@/lib/ppk/diagram.server";
import { DiagramPage } from "@/components/production-control/diagram-page";
import { ppkPageScope } from "@/lib/ppk/access.server";

export const dynamic = "force-dynamic";

/** Оргструктура (пункт 1.2 структуры ППК): тот же конструктор, что блок-схема, блоки — должности. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const scope = await ppkPageScope(session);
  const record = await loadDiagramRecord(scope, "org-chart", id);
  return (
    <DiagramPage
      id={record.id}
      kind="flowchart"
      variant="org-chart"
      basePath="/production-control/org-chart"
      initial={record.data}
      areas={[]}
      controlNumbers={[]}
    />
  );
}
