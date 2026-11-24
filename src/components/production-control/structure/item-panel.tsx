import type { Session } from "next-auth";
import type { PpkScope } from "@/lib/ppk/scope";
import type { PpkStructureItem } from "@/lib/ppk/structure";
import { OrgInfoPanel } from "./panels/org-info-panel";
import { DiagramsPanel } from "./panels/diagrams-panel";
import { ContractsPanel } from "./panels/contracts-panel";
import { ProductionInfoPanel } from "./panels/production-info-panel";
import { ProductsPanel } from "./panels/products-panel";
import { NormsPanel } from "./panels/norms-panel";
import { TextPanel } from "./panels/text-panel";
import { PolicyPanel } from "./panels/policy-panel";
import { TeamOrderPanel } from "./panels/team-order-panel";
import { HazardsPanel, ProbabilityPanel, SignificantPanel } from "./panels/hazards-panels";
import { ControlPointsPanel, WorksheetsPanel } from "./panels/control-points-panels";
import { PrpTablePanel } from "./panels/prp-table-panel";
import { StaffPanel } from "./panels/staff-panel";
import { LabPanel } from "./panels/lab-panel";
import { AcquaintancePanel } from "./panels/acquaintance-panel";
import { EquipmentPanel, InstructionsPanel, JournalsPanel, ProceduresPanel } from "./panels/source-panels";

export type PpkPanelProps = {
  item: PpkStructureItem;
  scope: PpkScope;
  session: Session;
};

/**
 * Содержимое пункта структуры ППК — одно и то же в окне поверх обзора и на
 * странице пункта. Данные читаются на сервере теми же загрузчиками, что
 * страницы блоков; правка — их же клиентскими редакторами.
 */
export async function PpkItemPanel(props: PpkPanelProps) {
  switch (props.item.panel) {
    case "org-info":
      return <OrgInfoPanel {...props} />;
    case "org-chart":
      return <DiagramsPanel {...props} kind="org-chart" />;
    case "floor-plans":
      return <DiagramsPanel {...props} kind="floor-plan" />;
    case "flowcharts":
      return <DiagramsPanel {...props} kind="flowchart" />;
    case "contracts":
      return <ContractsPanel {...props} />;
    case "production-info":
      return <ProductionInfoPanel {...props} />;
    case "products":
      return <ProductsPanel {...props} />;
    case "norms":
      return <NormsPanel {...props} />;
    case "text":
      return <TextPanel {...props} />;
    case "policy":
      return <PolicyPanel {...props} />;
    case "team-order":
      return <TeamOrderPanel {...props} />;
    case "hazards":
      return <HazardsPanel {...props} />;
    case "significant":
      return <SignificantPanel {...props} />;
    case "probability":
      return <ProbabilityPanel {...props} />;
    case "control-points":
      return <ControlPointsPanel {...props} />;
    case "worksheets":
      return <WorksheetsPanel {...props} />;
    case "prp-table":
      return <PrpTablePanel {...props} />;
    case "staff":
      return <StaffPanel {...props} />;
    case "lab":
      return <LabPanel {...props} />;
    case "acquaintance":
      return <AcquaintancePanel {...props} />;
    case "equipment":
      return <EquipmentPanel {...props} />;
    case "journals":
      return <JournalsPanel {...props} />;
    case "procedures":
      return <ProceduresPanel {...props} />;
    case "instructions":
      return <InstructionsPanel {...props} />;
  }
}
