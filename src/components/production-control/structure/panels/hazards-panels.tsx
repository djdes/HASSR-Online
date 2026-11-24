import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { PPK_SIGNIFICANCE_THRESHOLD, hazardRisk, isSignificantHazard } from "@/lib/ppk/haccp";
import { flowchartStepLabels } from "@/lib/ppk/diagram";
import { parsePpkRecords, type DiagramData } from "@/lib/ppk/records";
import { ppkWhere, type PpkScope } from "@/lib/ppk/scope";
import { ppkItemHref } from "@/lib/ppk/structure";
import { cn } from "@/lib/utils";
import { PpkCreateButton } from "@/components/production-control/ppk-ui";
import { HazardsClient } from "@/app/(dashboard)/production-control/haccp/hazards/hazards-client";
import type { PpkPanelProps } from "../item-panel";
import { PanelEmpty, PanelNote, PanelSection, PanelTable, SourceLink } from "./panel-ui";

const LEVELS = [1, 2, 3, 4] as const;

async function loadHazards(scope: PpkScope) {
  const rows = await db.ppkRecord.findMany({
    where: { ...ppkWhere(scope), block: "hazards" },
    select: { id: true, data: true, sortOrder: true, updatedAt: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return parsePpkRecords("hazards", rows);
}

/** 2.6 «Анализ опасностей и идентификация опасных факторов» — редактор блока. */
export async function HazardsPanel({ scope }: PpkPanelProps) {
  const [rows, flowcharts, t] = await Promise.all([
    db.ppkRecord.findMany({
      where: { ...ppkWhere(scope), block: "hazards" },
      select: { id: true, data: true, sortOrder: true, updatedAt: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    db.ppkRecord.findMany({
      where: { ...ppkWhere(scope), block: "flowchart" },
      select: { data: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    getTranslations("productionControl.hazards"),
  ]);
  const initial = parsePpkRecords("hazards", rows).map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));
  const flowSteps = flowchartStepLabels(flowcharts.map((row) => row.data as unknown as DiagramData));
  return (
    <HazardsClient
      initial={initial}
      flowSteps={flowSteps}
      header={
        <div className="mb-4 space-y-3">
          <p className="text-[13.5px] text-[#6f7282]">{t("lead", { threshold: String(PPK_SIGNIFICANCE_THRESHOLD) })}</p>
          <PpkCreateButton label={t("add")} />
        </div>
      }
    />
  );
}

/** 2.7 «Идентификация значимых опасных факторов»: значимые из анализа опасностей. */
export async function SignificantPanel({ scope }: PpkPanelProps) {
  const [hazards, t, th] = await Promise.all([
    loadHazards(scope),
    getTranslations("productionControl.structure.hazardViews"),
    getTranslations("productionControl.hazards"),
  ]);
  const significant = hazards.filter((row) => isSignificantHazard(row.data.probability, row.data.severity));
  if (hazards.length === 0) {
    return (
      <PanelEmpty
        title={t("noHazards")}
        hint={t("noHazardsHint")}
        action={<SourceLink href={ppkItemHref("2-6")}>{t("toAnalysis")}</SourceLink>}
      />
    );
  }
  return (
    <div className="space-y-5">
      <PanelNote>{t("significantRule", { threshold: String(PPK_SIGNIFICANCE_THRESHOLD) })}</PanelNote>
      <PanelSection
        title={t("significantCount", { count: String(significant.length), total: String(hazards.length) })}
        actions={
          <>
            <SourceLink href={ppkItemHref("2-6")}>{t("toAnalysis")}</SourceLink>
            <SourceLink href={ppkItemHref("2-10")}>{t("toCcp")}</SourceLink>
          </>
        }
      >
        <PanelTable
          heads={[th("step"), th("hazard"), th("type"), th("probability"), th("severity"), th("risk"), th("measures")]}
          rows={significant.map((row) => [
            row.data.step,
            row.data.hazard,
            th(`types.${row.data.type}`),
            String(row.data.probability),
            String(row.data.severity),
            <span key="risk" className="font-semibold text-[#a13a32]">
              {hazardRisk(row.data.probability, row.data.severity)}
            </span>,
            row.data.measures || "—",
          ])}
          empty={t("noSignificant")}
        />
      </PanelSection>
    </div>
  );
}

/** 2.8 «Вероятность реализации опасного фактора»: шкалы баллов и матрица 4×4. */
export async function ProbabilityPanel({ scope }: PpkPanelProps) {
  const [hazards, t, th] = await Promise.all([
    loadHazards(scope),
    getTranslations("productionControl.structure.hazardViews"),
    getTranslations("productionControl.hazards"),
  ]);
  const counts = new Map<string, number>();
  for (const row of hazards) {
    const key = `${row.data.probability}-${row.data.severity}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <PanelSection title={t("probabilityScale")}>
          <ol className="space-y-1 text-[13.5px] text-[#0b1024]">
            {LEVELS.map((level) => (
              <li key={level} className="flex gap-2">
                <span className="w-5 shrink-0 font-semibold tabular-nums text-[#5566f6]">{level}</span>
                {th(`probabilityLevels.${level}`)}
              </li>
            ))}
          </ol>
        </PanelSection>
        <PanelSection title={t("severityScale")}>
          <ol className="space-y-1 text-[13.5px] text-[#0b1024]">
            {LEVELS.map((level) => (
              <li key={level} className="flex gap-2">
                <span className="w-5 shrink-0 font-semibold tabular-nums text-[#5566f6]">{level}</span>
                {th(`severityLevels.${level}`)}
              </li>
            ))}
          </ol>
        </PanelSection>
      </div>

      <PanelSection title={th("matrix")} hint={t("matrixHint", { threshold: String(PPK_SIGNIFICANCE_THRESHOLD) })}>
        <div className="overflow-x-auto">
          <div role="table" aria-label={th("matrix")} className="inline-grid grid-cols-[auto_repeat(4,3rem)] gap-1.5">
            {[4, 3, 2, 1].map((probability) => (
              <div key={`row-${probability}`} role="row" className="contents">
                <div role="rowheader" className="flex items-center pr-2 text-[12px] text-[#6f7282]">
                  {probability}
                </div>
                {LEVELS.map((severity) => {
                  const count = counts.get(`${probability}-${severity}`) ?? 0;
                  const significant = hazardRisk(probability, severity) >= PPK_SIGNIFICANCE_THRESHOLD;
                  return (
                    <div
                      key={`${probability}-${severity}`}
                      role="cell"
                      title={`${th("probability")} ${probability} × ${th("severity")} ${severity} = ${hazardRisk(probability, severity)}`}
                      className={cn(
                        "grid size-12 place-items-center rounded-xl text-[13px] font-semibold tabular-nums",
                        significant ? "bg-[#fff4f2] text-[#a13a32]" : "bg-[#eef1ff] text-[#3848c7]",
                      )}
                    >
                      {count > 0 ? count : ""}
                    </div>
                  );
                })}
              </div>
            ))}
            <div />
            {LEVELS.map((severity) => (
              <div key={`col-${severity}`} className="pt-1 text-center text-[12px] text-[#6f7282]">
                {severity}
              </div>
            ))}
          </div>
          <p className="mt-2 text-[12px] text-[#6f7282]">{t("axes")}</p>
        </div>
      </PanelSection>

      {hazards.length === 0 ? (
        <PanelEmpty
          title={t("noHazards")}
          hint={t("noHazardsHint")}
          action={<SourceLink href={ppkItemHref("2-6")}>{t("toAnalysis")}</SourceLink>}
        />
      ) : (
        <PanelSection title={t("byHazard")} actions={<SourceLink href={ppkItemHref("2-6")}>{t("toAnalysis")}</SourceLink>}>
          <PanelTable
            heads={[th("step"), th("hazard"), th("probability"), th("severity"), th("risk")]}
            rows={hazards.map((row) => [
              row.data.step,
              row.data.hazard,
              `${row.data.probability} — ${th(`probabilityLevels.${row.data.probability}`)}`,
              `${row.data.severity} — ${th(`severityLevels.${row.data.severity}`)}`,
              <span
                key="risk"
                className={isSignificantHazard(row.data.probability, row.data.severity) ? "font-semibold text-[#a13a32]" : "text-[#3c4053]"}
              >
                {hazardRisk(row.data.probability, row.data.severity)}
              </span>,
            ])}
          />
        </PanelSection>
      )}
    </div>
  );
}
