import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ListChecks } from "lucide-react";
import Link from "next/link";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { loadPpkStaff } from "@/lib/ppk/staff.server";
import { loadEnabledJournals } from "@/lib/ppk/journals.server";
import { parsePpkRecords } from "@/lib/ppk/records";
import { PpkBlockHeader } from "@/components/production-control/ppk-block-header";
import { PPK_BUTTON_OUTLINE_CLASS } from "@/components/production-control/ppk-ui";
import { ControlPointsClient } from "./control-points-client";

export const dynamic = "force-dynamic";

/** ХАССП, шаг 6 — ККТ: дерево решений для значимых опасностей и список контрольных точек. */
export default async function ControlPointsPage({
  searchParams,
}: {
  searchParams: Promise<{ hazard?: string | string[] }>;
}) {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/journals");
  const organizationId = getActiveOrgId(session);
  const { hazard } = await searchParams;
  const focusHazardId = typeof hazard === "string" ? hazard.slice(0, 64) : null;

  const select = { id: true, data: true, sortOrder: true, updatedAt: true } as const;
  const orderBy = [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }];
  const [hazards, points, staff, journals, t] = await Promise.all([
    db.ppkRecord.findMany({ where: { organizationId, block: "hazards" }, select, orderBy }),
    db.ppkRecord.findMany({ where: { organizationId, block: "control-points" }, select, orderBy }),
    loadPpkStaff(organizationId),
    loadEnabledJournals(organizationId),
    getTranslations("productionControl.controlPoints"),
  ]);

  const toRow = <R extends { updatedAt: Date }>(row: R) => ({ ...row, updatedAt: row.updatedAt.toISOString() });

  const header = (
    <PpkBlockHeader
      blockKey="control-points"
      lead={t("lead")}
      actions={
        <Link href="/production-control/haccp/control-points/worksheets" className={PPK_BUTTON_OUTLINE_CLASS}>
          <ListChecks className="size-4 text-[#5566f6]" />
          {t("allWorksheets")}
        </Link>
      }
    />
  );

  return (
    <ControlPointsClient
      initial={parsePpkRecords("control-points", points).map(toRow)}
      hazards={parsePpkRecords("hazards", hazards).map(toRow)}
      staff={staff}
      journals={journals}
      focusHazardId={focusHazardId}
      header={header}
    />
  );
}
