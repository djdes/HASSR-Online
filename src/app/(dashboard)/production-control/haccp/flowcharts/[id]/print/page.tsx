import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { loadDiagramRecord } from "@/lib/ppk/diagram.server";
import { diagramBounds } from "@/lib/ppk/diagram";
import { PpkPrintSheet, loadPpkPrintOrg } from "@/components/production-control/ppk-print-sheet";
import { DiagramSvg } from "@/components/production-control/diagram-svg";

export const dynamic = "force-dynamic";

/** Печать схемы: альбомный лист A4, схема на всю ширину без сетки. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const organizationId = getActiveOrgId(session);

  const [record, org, t] = await Promise.all([
    loadDiagramRecord(organizationId, "flowchart", id),
    loadPpkPrintOrg(organizationId),
    getTranslations("productionControl.diagram"),
  ]);
  const { data } = record;
  const box = diagramBounds(data);
  const viewBox = `${box.x} ${box.y} ${box.w} ${box.h}`;
  const title = data.title || t("unnamed");

  return (
    <>
      <style>{"@page { size: A4 landscape; margin: 10mm; }"}</style>
      <PpkPrintSheet org={org} title={title}>
        <DiagramSvg data={data} kind="flowchart" idPrefix="print" viewBox={viewBox} className="h-auto w-full" />
      </PpkPrintSheet>
    </>
  );
}
