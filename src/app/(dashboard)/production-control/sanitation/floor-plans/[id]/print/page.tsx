import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { loadDiagramRecord } from "@/lib/ppk/diagram.server";
import { FLOW_KINDS, diagramBounds } from "@/lib/ppk/diagram";
import type { FlowKind } from "@/lib/ppk/records";
import { PpkPrintSheet, loadPpkPrintOrg } from "@/components/production-control/ppk-print-sheet";
import { DiagramSvg, FlowLegend } from "@/components/production-control/diagram-svg";

export const dynamic = "force-dynamic";

/** Печать схемы: альбомный лист A4, схема на всю ширину без сетки. */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const organizationId = getActiveOrgId(session);

  const [record, org, t] = await Promise.all([
    loadDiagramRecord(organizationId, "floor-plan", id),
    loadPpkPrintOrg(organizationId),
    getTranslations("productionControl.diagram"),
  ]);
  const { data } = record;
  const box = diagramBounds(data);
  const viewBox = `${box.x} ${box.y} ${box.w} ${box.h}`;
  const title = data.title || t("unnamed");
  const labels = Object.fromEntries(FLOW_KINDS.map((k) => [k, t(`flows.${k}`)])) as Record<FlowKind, string>;
  const present = FLOW_KINDS.filter((k) => data.edges.some((e) => e.flow === k));
  const byFlow = query.by === "flow";

  return (
    <>
      <style>{"@page { size: A4 landscape; margin: 10mm; }"}</style>
      <PpkPrintSheet org={org} title={title}>
        {byFlow ? (
          present.length === 0 ? (
            <p className="text-center text-[#6f7282]">{t("noFlowsOnPlan")}</p>
          ) : (
            present.map((k, index) => (
              <section key={k} className={index < present.length - 1 ? "print:break-after-page" : undefined}>
                <h2 className="mb-3 mt-6 text-center text-[16px] font-semibold first:mt-0">
                  {title}: {labels[k]}
                </h2>
                <DiagramSvg data={data} kind="floor-plan" idPrefix={`print-${k}`} viewBox={viewBox} onlyFlow={k} className="h-auto w-full" />
                <FlowLegend className="mt-4" title={t("legend")} labels={labels} kinds={[k]} />
              </section>
            ))
          )
        ) : (
          <>
            <DiagramSvg data={data} kind="floor-plan" idPrefix="print" viewBox={viewBox} className="h-auto w-full" />
            {present.length > 0 ? (
              <FlowLegend className="mt-4" title={t("legend")} labels={labels} kinds={present} />
            ) : null}
          </>
        )}
      </PpkPrintSheet>
    </>
  );
}
