import { db } from "@/lib/db";
import { loadDocumentOrgBlock } from "@/lib/document-org-block.server";
import { sphereLabel } from "@/lib/org-profile";
import { ackStats, ppkAckAvailable } from "./acknowledge.server";
import type { PpkFolderKey } from "./folders";
import { loadEnabledJournals } from "./journals.server";
import { PRP_TABLE_BLOCKS } from "./prp-tables";
import {
  PPK_RECORD_SCHEMAS,
  PPK_TEXT_BLOCKS,
  type DiagramData,
  type PpkRecordBlock,
  type ProductionInfoData,
} from "./records";
import type { PpkBlockKey } from "./registry";
import { ppkWhere, type PpkScope } from "./scope";
import { loadPpkStaff } from "./staff.server";
import type { PpkStatus } from "./status";
import { missingOrgInfo, missingProductionInfo, requiredOrgInfo, type ProductionPulled } from "./structure-fields";
import type { PpkItemFacts } from "./structure-status";

/** Папки, которые считают пункты структуры (сканы, договоры, прежние загрузки группы). */
const ITEM_FOLDERS: PpkFolderKey[] = [
  "contracts",
  "lab-contract",
  "pest-contract",
  "policy-scan",
  "team-regulation-scan",
  "team-leader-scan",
  "team-order-scan",
  "flow-schedule",
  "team-signed",
];

/** Новые блоки структуры: их записи разбираются здесь (остальные — в `facts.server.ts`). */
const ITEM_BLOCKS: PpkRecordBlock[] = ["org-chart", "contracts", "production-info", ...PPK_TEXT_BLOCKS, ...PRP_TABLE_BLOCKS];

/**
 * Что 1.4 подтягивает из сведений об объекте: у ППК точки — точка (наименование
 * для документов, адрес), у ППК организации — организация; вид деятельности —
 * сфера организации («Другое» не подсказывает ничего).
 */
export async function loadProductionPulled(scope: PpkScope): Promise<ProductionPulled> {
  const [org, point] = await Promise.all([
    db.organization.findUnique({
      where: { id: scope.organizationId },
      select: { name: true, journalShortName: true, address: true, legalAddress: true, type: true },
    }),
    scope.buildingId
      ? db.building.findFirst({
          where: { id: scope.buildingId, organizationId: scope.organizationId },
          select: { name: true, journalName: true, address: true },
        })
      : Promise.resolve(null),
  ]);
  const activity = org ? sphereLabel(org.type) : null;
  return {
    objectName: point ? point.journalName || point.name : (org?.journalShortName || org?.name || null),
    objectAddress: point ? point.address || null : (org?.address || org?.legalAddress || null),
    activity: activity && activity !== "Другое" ? activity : null,
  };
}

/** Оборудование объекта: у точки — цеха точки и цеха без точки, у организации — всё. */
export function ppkEquipmentWhere(scope: PpkScope) {
  return {
    area: {
      organizationId: scope.organizationId,
      ...(scope.buildingId ? { OR: [{ buildingId: scope.buildingId }, { buildingId: null }] } : {}),
    },
  };
}

/**
 * Факты пунктов структуры ППК. `blocks` — уже посчитанные статусы блоков
 * раздела (обзор читает их и для шапки).
 */
export async function loadPpkItemFacts(
  scope: PpkScope,
  blocks: Record<PpkBlockKey, PpkStatus>,
): Promise<PpkItemFacts> {
  const { organizationId } = scope;
  const [orgBlock, rows, folderRows, hazards, teamOrders, staff, ackReady, equipment, journals, pulled] = await Promise.all([
    loadDocumentOrgBlock(organizationId, { buildingId: scope.buildingId }),
    db.ppkRecord.findMany({
      where: { ...ppkWhere(scope), block: { in: ITEM_BLOCKS } },
      select: { block: true, data: true },
    }),
    db.knowledgeDocument.groupBy({
      by: ["folder"],
      where: { ...ppkWhere(scope), folder: { in: ITEM_FOLDERS } },
      _count: { _all: true },
    }),
    db.ppkRecord.count({ where: { ...ppkWhere(scope), block: "hazards" } }),
    db.companyOrder.count({ where: { organizationId, templateCode: "haccp-team" } }),
    loadPpkStaff(scope),
    ppkAckAvailable(scope),
    db.equipment.count({ where: ppkEquipmentWhere(scope) }),
    loadEnabledJournals(organizationId, scope.buildingId),
    loadProductionPulled(scope),
  ]);

  const valid = (block: PpkRecordBlock) =>
    rows.flatMap((row) => {
      if (row.block !== block) return [];
      const parsed = PPK_RECORD_SCHEMAS[block].safeParse(row.data);
      return parsed.success ? [parsed.data] : [];
    });

  const folders: Partial<Record<PpkFolderKey, number>> = {};
  for (const row of folderRows) {
    if (row.folder) folders[row.folder as PpkFolderKey] = row._count._all;
  }

  const charts = valid("org-chart") as DiagramData[];
  const production = (valid("production-info")[0] as ProductionInfoData | undefined) ?? null;
  const texts: PpkItemFacts["texts"] = {};
  for (const block of PPK_TEXT_BLOCKS) {
    const data = valid(block)[0] as { text: string } | undefined;
    texts[block] = Boolean(data?.text.trim());
  }
  const prp: PpkItemFacts["prp"] = {};
  for (const block of PRP_TABLE_BLOCKS) prp[block] = valid(block).length;

  const acknowledged = ackReady ? await ackStats(scope, "ppk") : null;

  return {
    blocks,
    orgInfo: orgBlock
      ? { required: requiredOrgInfo(orgBlock.org).length, missing: missingOrgInfo(orgBlock.org).length }
      : { required: 1, missing: 1 },
    orgCharts: { count: charts.length, maxNodes: Math.max(0, ...charts.map((chart) => chart.nodes.length)) },
    contracts: {
      records: valid("contracts").length,
      files: (folders.contracts ?? 0) + (folders["lab-contract"] ?? 0) + (folders["pest-contract"] ?? 0),
    },
    productionInfo: {
      exists: production !== null,
      missing: missingProductionInfo(production, pulled).length,
    },
    texts,
    folders,
    hazards,
    teamOrder: teamOrders > 0,
    prp,
    staff: staff.length,
    acquaintance: {
      available: ackReady,
      acknowledged: acknowledged?.acknowledged.length ?? 0,
      total: (acknowledged?.acknowledged.length ?? 0) + (acknowledged?.pending.length ?? 0),
    },
    equipment,
    journals: journals.length,
  };
}
