import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { PPK_SIGNIFICANCE_THRESHOLD } from "@/lib/ppk/haccp";
import { flowchartStepLabels } from "@/lib/ppk/diagram";
import type { DiagramData, HazardData } from "@/lib/ppk/records";
import { PpkBlockHeader } from "@/components/production-control/ppk-block-header";
import { PpkCreateButton } from "@/components/production-control/ppk-ui";
import { HazardsClient } from "./hazards-client";

export const dynamic = "force-dynamic";

/** ХАССП, шаг 5 — анализ опасностей: опасности по этапам с риском и матрицей 4×4. */
export default async function HazardsPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const organizationId = getActiveOrgId(session);

  const [rows, flowcharts, t] = await Promise.all([
    db.ppkRecord.findMany({
      where: { organizationId, block: "hazards" },
      select: { id: true, data: true, sortOrder: true, updatedAt: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    db.ppkRecord.findMany({
      where: { organizationId, block: "flowchart" },
      select: { data: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    getTranslations("productionControl.hazards"),
  ]);

  const initial = rows.map((row) => ({
    id: row.id,
    data: row.data as unknown as HazardData,
    sortOrder: row.sortOrder,
    updatedAt: row.updatedAt.toISOString(),
  }));

  // Этапы из блок-схем организации — подсказки для поля «Этап».
  const flowSteps = flowchartStepLabels(flowcharts.map((row) => row.data as unknown as DiagramData));

  const header = (
    <PpkBlockHeader
      blockKey="hazards"
      lead={t("lead", { threshold: String(PPK_SIGNIFICANCE_THRESHOLD) })}
      actions={<PpkCreateButton label={t("add")} />}
    />
  );

  return <HazardsClient initial={initial} flowSteps={flowSteps} header={header} />;
}
