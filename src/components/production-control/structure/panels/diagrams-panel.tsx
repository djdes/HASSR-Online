import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { parsePpkRecords } from "@/lib/ppk/records";
import { ppkWhere } from "@/lib/ppk/scope";
import { DiagramList } from "@/components/production-control/diagram-list";
import { PpkCreateButton } from "@/components/production-control/ppk-ui";
import type { PpkPanelProps } from "../item-panel";
import { OrgChartFromPositions } from "./org-chart-from-positions";
import { PanelNote } from "./panel-ui";

type DiagramKind = "org-chart" | "floor-plan" | "flowchart";

const BASE_PATH: Record<DiagramKind, string> = {
  "org-chart": "/production-control/org-chart",
  "floor-plan": "/production-control/sanitation/floor-plans",
  flowchart: "/production-control/haccp/flowcharts",
};

/**
 * Пункты-конструкторы: 1.2 оргструктура, 1.6 план помещений и потоков, 2.5
 * блок-схемы. В окне — список схем с превью и создание; рисуют на странице
 * редактора: холсту нужен весь экран.
 */
export async function DiagramsPanel({ scope, kind }: PpkPanelProps & { kind: DiagramKind }) {
  const [rows, t, tFlow, tPlan] = await Promise.all([
    db.ppkRecord.findMany({
      where: { ...ppkWhere(scope), block: kind },
      select: { id: true, data: true, sortOrder: true, updatedAt: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    getTranslations("productionControl.orgCharts"),
    getTranslations("productionControl.flowcharts"),
    getTranslations("productionControl.floorPlans"),
  ]);
  const initial = parsePpkRecords(kind, rows).map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));
  const label = kind === "org-chart" ? t("new") : kind === "flowchart" ? tFlow("new") : tPlan("new");

  return (
    <div className="space-y-4">
      {kind === "org-chart" ? <PanelNote>{t("editorHint")}</PanelNote> : null}
      <DiagramList
        kind={kind}
        basePath={BASE_PATH[kind]}
        initial={initial}
        header={
          <div className="flex flex-wrap items-center gap-2">
            <PpkCreateButton label={label} />
            {kind === "org-chart" ? <OrgChartFromPositions /> : null}
          </div>
        }
      />
    </div>
  );
}
