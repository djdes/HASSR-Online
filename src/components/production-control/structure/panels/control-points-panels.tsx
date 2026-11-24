import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ListChecks, Printer } from "lucide-react";
import { db } from "@/lib/db";
import { loadPpkStaff } from "@/lib/ppk/staff.server";
import { loadEnabledJournals } from "@/lib/ppk/journals.server";
import { parsePpkRecords } from "@/lib/ppk/records";
import type { CcpJournalEntry } from "@/lib/ppk/ccp-monitoring";
import { ppkWhere } from "@/lib/ppk/scope";
import { ppkItemHref } from "@/lib/ppk/structure";
import { PPK_BUTTON_OUTLINE_CLASS } from "@/components/production-control/ppk-ui";
import { ControlPointsClient } from "@/app/(dashboard)/production-control/haccp/control-points/control-points-client";
import type { PpkPanelProps } from "../item-panel";
import { PanelEmpty, PanelNote, PanelSection, SourceLink } from "./panel-ui";

const WORKSHEETS = "/production-control/haccp/control-points/worksheets";

/** 2.10 «Определение ККТ и точек применения ППОПМ» — редактор ККТ + рабочие листы. */
export async function ControlPointsPanel({ scope }: PpkPanelProps) {
  const select = { id: true, data: true, sortOrder: true, updatedAt: true } as const;
  const orderBy = [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }];
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [hazards, points, staff, journals, journalEntries, t] = await Promise.all([
    db.ppkRecord.findMany({ where: { ...ppkWhere(scope), block: "hazards" }, select, orderBy }),
    db.ppkRecord.findMany({ where: { ...ppkWhere(scope), block: "control-points" }, select, orderBy }),
    loadPpkStaff(scope),
    loadEnabledJournals(scope.organizationId, scope.buildingId),
    // Измерения журнала «Мониторинг ККТ» за 30 дней — как на странице блока.
    db.journalEntry.findMany({
      where: { organizationId: scope.organizationId, template: { code: "ccp_monitoring" }, createdAt: { gte: since } },
      select: { id: true, createdAt: true, data: true, filledBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    getTranslations("productionControl.structure.worksheets"),
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

  return (
    <div className="space-y-8">
      <ControlPointsClient
        initial={parsePpkRecords("control-points", points).map(toRow)}
        hazards={parsePpkRecords("hazards", hazards).map(toRow)}
        staff={staff}
        journals={journals}
        ccpEntries={ccpEntries}
        nowIso={now.toISOString()}
        focusHazardId={null}
        header={<PanelNote>{t("methodHint")} <SourceLink href={ppkItemHref("2-9")}>{t("toMethod")}</SourceLink></PanelNote>}
      />
      <PanelSection
        title={t("title")}
        hint={t("hint")}
        actions={
          <Link href={WORKSHEETS} className={PPK_BUTTON_OUTLINE_CLASS}>
            <ListChecks className="size-4 text-[#5566f6]" aria-hidden />
            {t("all")}
          </Link>
        }
      >
        <WorksheetList scope={scope} />
      </PanelSection>
    </div>
  );
}

/** Приложение № 2 «Рабочие листы плана управления опасностями»: по листу на ККТ/ОПП. */
export async function WorksheetsPanel({ scope }: PpkPanelProps) {
  const t = await getTranslations("productionControl.structure.worksheets");
  return (
    <PanelSection
      title={t("title")}
      hint={t("hint")}
      actions={
        <Link href={WORKSHEETS} className={PPK_BUTTON_OUTLINE_CLASS}>
          <ListChecks className="size-4 text-[#5566f6]" aria-hidden />
          {t("all")}
        </Link>
      }
    >
      <WorksheetList scope={scope} />
    </PanelSection>
  );
}

async function WorksheetList({ scope }: { scope: PpkPanelProps["scope"] }) {
  const select = { id: true, data: true, sortOrder: true, updatedAt: true } as const;
  const [points, hazards, staff, t] = await Promise.all([
    db.ppkRecord.findMany({
      where: { ...ppkWhere(scope), block: "control-points" },
      select,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    db.ppkRecord.findMany({ where: { ...ppkWhere(scope), block: "hazards" }, select }),
    loadPpkStaff(scope),
    getTranslations("productionControl.structure.worksheets"),
  ]);
  const hazardById = new Map(parsePpkRecords("hazards", hazards).map((row) => [row.id, row.data]));
  const people = new Map(staff.map((person) => [person.id, person.name]));
  const sheets = parsePpkRecords("control-points", points).filter(
    (row) => row.data.kind === "ccp" || row.data.kind === "oprp",
  );
  if (sheets.length === 0) {
    return (
      <PanelEmpty
        title={t("empty")}
        hint={t("emptyHint")}
        action={<SourceLink href={ppkItemHref("2-10")}>{t("toCcp")}</SourceLink>}
      />
    );
  }
  return (
    <ul className="space-y-2">
      {sheets.map((row) => {
        const hazard = row.data.hazardId ? hazardById.get(row.data.hazardId) : undefined;
        return (
          <li key={row.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-[var(--app-veil)] px-4 py-3">
            <span className="shrink-0 rounded-lg bg-white px-2 py-0.5 text-[13px] font-semibold tabular-nums text-[#3848c7]">
              {row.data.number || "—"}
            </span>
            <span className="min-w-0 flex-1 text-[14px] text-[#0b1024]">
              {hazard ? `${hazard.step} — ${hazard.hazard}` : t("noHazard")}
              <span className="block text-[12.5px] text-[#6f7282]">
                {row.data.responsibleId ? (people.get(row.data.responsibleId) ?? t("noResponsible")) : t("noResponsible")}
              </span>
            </span>
            <Link
              href={`${WORKSHEETS}?id=${row.id}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-[13.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:bg-[var(--app-veil-hover)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
            >
              <Printer className="size-4" aria-hidden />
              {t("print")}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
