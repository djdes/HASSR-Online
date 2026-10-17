import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { parsePpkRecords } from "@/lib/ppk/records";
import { PpkBlockHeader } from "@/components/production-control/ppk-block-header";
import { PpkCreateButton } from "@/components/production-control/ppk-ui";
import { DiagramList } from "@/components/production-control/diagram-list";

export const dynamic = "force-dynamic";

/** ХАССП, блок-схемы техпроцесса: список схем с мини-превью, создание и удаление. */
export default async function Page() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/journals");
  const organizationId = getActiveOrgId(session);

  const [rows, t] = await Promise.all([
    db.ppkRecord.findMany({
      where: { organizationId, block: "flowchart" },
      select: { id: true, data: true, sortOrder: true, updatedAt: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    getTranslations("productionControl.flowcharts"),
  ]);

  const initial = parsePpkRecords("flowchart", rows).map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));

  const header = (
    <PpkBlockHeader
      blockKey="flowcharts"
      lead={t("lead")}
      actions={<PpkCreateButton label={t("new")} />}
    />
  );

  return <DiagramList kind="flowchart" basePath="/production-control/haccp/flowcharts" initial={initial} header={header} />;
}
