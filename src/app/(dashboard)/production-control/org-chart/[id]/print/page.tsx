import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { loadDiagramRecord } from "@/lib/ppk/diagram.server";
import { diagramBounds } from "@/lib/ppk/diagram";
import { PpkPrintSheet, loadPpkPrintOrg } from "@/components/production-control/ppk-print-sheet";
import { DiagramSvg } from "@/components/production-control/diagram-svg";
import { ppkPageScope } from "@/lib/ppk/access.server";

export const dynamic = "force-dynamic";

/** Печать оргструктуры: альбомный лист A4, как у блок-схем. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const scope = await ppkPageScope(session);

  const [record, org, t] = await Promise.all([
    loadDiagramRecord(scope, "org-chart", id),
    loadPpkPrintOrg(scope.organizationId, scope.buildingId),
    getTranslations("productionControl.diagram"),
  ]);
  const { data } = record;
  const box = diagramBounds(data);
  return (
    <>
      <style>{"@page { size: A4 landscape; margin: 10mm; }"}</style>
      <PpkPrintSheet org={org} title={data.title || t("unnamed")}>
        <DiagramSvg data={data} kind="flowchart" idPrefix="print" viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} className="h-auto w-full" />
      </PpkPrintSheet>
    </>
  );
}
