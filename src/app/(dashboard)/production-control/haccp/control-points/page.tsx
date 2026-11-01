import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ListChecks } from "lucide-react";
import Link from "next/link";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { loadPpkStaff } from "@/lib/ppk/staff.server";
import { loadEnabledJournals } from "@/lib/ppk/journals.server";
import { parsePpkRecords } from "@/lib/ppk/records";
import type { CcpJournalEntry } from "@/lib/ppk/ccp-monitoring";
import { PpkBlockHeader } from "@/components/production-control/ppk-block-header";
import { PPK_BUTTON_OUTLINE_CLASS } from "@/components/production-control/ppk-ui";
import { ControlPointsClient } from "./control-points-client";
import { ppkPageScope } from "@/lib/ppk/access.server";
import { ppkWhere } from "@/lib/ppk/scope";

export const dynamic = "force-dynamic";

/** Текущее время вынесено из компонента: страница всегда рендерится на сервере по запросу. */
const currentTime = () => new Date();

/** ХАССП, шаг 6 — ККТ: дерево решений для значимых опасностей и список контрольных точек. */
export default async function ControlPointsPage({
  searchParams,
}: {
  searchParams: Promise<{ hazard?: string | string[] }>;
}) {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const organizationId = getActiveOrgId(session);
  // ППК на точку (2026-11-01): ППК точки из шапки или организации.
  const scope = await ppkPageScope(session);
  const { hazard } = await searchParams;
  const focusHazardId = typeof hazard === "string" ? hazard.slice(0, 64) : null;

  const select = { id: true, data: true, sortOrder: true, updatedAt: true } as const;
  const orderBy = [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }];
  const now = currentTime();
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [hazards, points, staff, journals, journalEntries, t] = await Promise.all([
    db.ppkRecord.findMany({ where: { ...ppkWhere(scope), block: "hazards" }, select, orderBy }),
    db.ppkRecord.findMany({ where: { ...ppkWhere(scope), block: "control-points" }, select, orderBy }),
    loadPpkStaff(scope),
    loadEnabledJournals(organizationId, scope.buildingId),
    // Измерения из журнала «Мониторинг ККТ» за 30 дней — для сверки с пределами точек.
    db.journalEntry.findMany({
      where: { organizationId, template: { code: "ccp_monitoring" }, createdAt: { gte: since } },
      select: { id: true, createdAt: true, data: true, filledBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    getTranslations("productionControl.controlPoints"),
  ]);

  const toRow = <R extends { updatedAt: Date }>(row: R) => ({ ...row, updatedAt: row.updatedAt.toISOString() });

  const text = (value: unknown) => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");
  const ccpEntries: CcpJournalEntry[] = journalEntries.map((row) => {
    const data = (row.data ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      filledByName: row.filledBy?.name ?? null,
      ccpName: text(data.ccpName),
      actualValue: text(data.actualValue),
      withinLimit: typeof data.withinLimit === "boolean" ? data.withinLimit : null,
      correctiveAction: text(data.correctiveAction),
    };
  });

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
      ccpEntries={ccpEntries}
      nowIso={now.toISOString()}
      focusHazardId={focusHazardId}
      header={header}
    />
  );
}
