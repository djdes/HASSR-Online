import { db } from "@/lib/db";
import { ORG_ROSTER_WHERE } from "@/lib/journal-roster";
import { PPK_FOLDERS, type PpkFolderKey } from "./folders";
import { emptyPpkFacts, computePpkStatuses, type PpkFacts, type PpkStatus } from "./status";
import type { PpkBlockKey } from "./registry";
import { isSignificantHazard } from "./haccp";
import {
  PPK_RECORD_BLOCKS,
  PPK_RECORD_SCHEMAS,
  type ControlPointData,
  type DiagramData,
  type HazardData,
  type LabPlanItem,
  type NormsData,
  type PestPlanItem,
  type PolicyData,
  type PpkRecordBlock,
  type ProductData,
  type TeamMember,
} from "./records";
import { ppkWhere, type PpkScope } from "./scope";

/** Окно «недавних» записей для блока аудита. */
const RECENT_DAYS = 365;

/** Журналы внутреннего аудита (блок «Внутренний аудит»). */
const AUDIT_JOURNAL_CODES = ["audit_plan", "audit_protocol", "audit_report"] as const;

/** Записи блока с уже проверенными данными; id нужен для ссылок (опасность ← ККТ). */
type Valid<T> = { id: string; data: T };

type ValidRecords = {
  team: Valid<TeamMember>[];
  policy: Valid<Omit<PolicyData, "token">>[];
  products: Valid<ProductData>[];
  hazards: Valid<HazardData>[];
  "control-points": Valid<ControlPointData>[];
  flowchart: Valid<DiagramData>[];
  "floor-plan": Valid<DiagramData>[];
  "pest-plan": Valid<PestPlanItem>[];
  "lab-plan": Valid<LabPlanItem>[];
  norms: Valid<NormsData>[];
  /** Версии и заседания в статус блоков не входят — только разбираются вместе с остальными. */
  "doc-versions": Valid<unknown>[];
  "team-meetings": Valid<unknown>[];
};

/**
 * Разобрать записи по блокам. Записи с битыми данными пропускаются: одна
 * испорченная строка не должна ломать весь раздел.
 */
function groupValidRecords(rows: { id: string; block: string; data: unknown }[]): ValidRecords {
  const out: ValidRecords = { team: [], policy: [], products: [], hazards: [], "control-points": [], flowchart: [], "floor-plan": [], "pest-plan": [], "lab-plan": [], norms: [], "doc-versions": [], "team-meetings": [] };
  for (const row of rows) {
    if (!(PPK_RECORD_BLOCKS as readonly string[]).includes(row.block)) continue;
    const block = row.block as PpkRecordBlock;
    const parsed = PPK_RECORD_SCHEMAS[block].safeParse(row.data);
    if (!parsed.success) continue;
    // Схема блока уже проверила данные; приводим тип по блоку.
    (out[block] as Valid<unknown>[]).push({ id: row.id, data: parsed.data });
  }
  return out;
}

/**
 * Факты раздела ППК из базы: документы и папки, приказы, записи ХАССП
 * (группа, политика, продукция, опасности, ККТ), аудит.
 */
export async function loadPpkFacts(scope: PpkScope): Promise<PpkFacts> {
  const { organizationId } = scope;
  const facts = emptyPpkFacts();
  const since = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);
  const [knowledgeDocs, folderRows, ordersTotal, ppkApprovalCount, recordRows, rosterRows, auditDocs, checklistRuns] =
    await Promise.all([
      db.knowledgeDocument.count({ where: { organizationId, kind: null, folder: null } }),
      db.knowledgeDocument.groupBy({
        by: ["folder"],
        where: { ...ppkWhere(scope), folder: { in: [...PPK_FOLDERS] } },
        _count: { _all: true },
      }),
      db.companyOrder.count({ where: { organizationId } }),
      db.companyOrder.count({ where: { organizationId, templateCode: "ppk-approval" } }),
      db.ppkRecord.findMany({
        where: { ...ppkWhere(scope), block: { in: [...PPK_RECORD_BLOCKS] } },
        select: { id: true, block: true, data: true },
      }),
      db.user.findMany({ where: { organizationId, ...ORG_ROSTER_WHERE }, select: { id: true } }),
      db.journalDocument.count({
        where: {
          organizationId,
          createdAt: { gte: since },
          template: { code: { in: [...AUDIT_JOURNAL_CODES] } },
        },
      }),
      db.checklistInspection.count({ where: { organizationId, createdAt: { gte: since } } }),
    ]);

  facts.knowledgeDocs = knowledgeDocs;
  const folders: Partial<Record<PpkFolderKey, number>> = {};
  for (const row of folderRows) {
    if (row.folder && (PPK_FOLDERS as readonly string[]).includes(row.folder)) {
      folders[row.folder as PpkFolderKey] = row._count._all;
    }
  }
  facts.folders = folders;
  facts.orders = { total: ordersTotal, ppkApproval: ppkApprovalCount > 0 };

  const records = groupValidRecords(recordRows);

  // Группа ХАССП: состав и наличие руководителя.
  // Считаем только тех, кто сейчас в штате: уволенные и архивные в группу не входят.
  const roster = new Set(rosterRows.map((row) => row.id));
  const teamInRoster = records.team.filter((row) => roster.has(row.data.userId));
  facts.team = {
    members: teamInRoster.length,
    hasLeader: teamInRoster.some((row) => row.data.role === "leader"),
  };

  // Политика: непустой текст и утверждение (кто и когда).
  const policy = records.policy[0]?.data;
  facts.policy = {
    hasText: Boolean(policy && policy.text.trim()),
    approved: Boolean(policy && policy.approvedById && policy.approvedAt),
  };

  facts.products = records.products.length;

  // Схемы: блок-схемы (самая длинная по числу этапов) и планы помещений.
  facts.flowcharts = {
    count: records.flowchart.length,
    maxSteps: Math.max(0, ...records.flowchart.map((r) => r.data.nodes.filter((n) => n.kind === "step").length)),
  };
  facts.floorPlans = {
    count: records["floor-plan"].length,
    complete: records["floor-plan"].some(
      (r) => r.data.nodes.length >= 2 && r.data.edges.some((e) => e.flow !== null),
    ),
  };

  // Опасности: значимые и те, на которые ссылается хотя бы одна ККТ/ОПП.
  const significant = records.hazards.filter((row) =>
    isSignificantHazard(row.data.probability, row.data.severity),
  );
  const referencedHazardIds = new Set(
    records["control-points"]
      .map((row) => row.data.hazardId)
      .filter((value): value is string => typeof value === "string"),
  );
  facts.hazards = {
    total: records.hazards.length,
    significant: significant.length,
    significantDecided: significant.filter((row) => referencedHazardIds.has(row.id)).length,
  };

  // Контрольные точки: ККТ/ОПП и у скольких назначен ответственный.
  const controlPoints = records["control-points"].filter(
    (row) => row.data.kind === "ccp" || row.data.kind === "oprp",
  );
  facts.controlPoints = {
    ccpOrOprp: controlPoints.length,
    withResponsible: controlPoints.filter((row) => row.data.responsibleId).length,
  };

  // Санитария: пункты плана и договор (папка с файлом договора не пуста).
  facts.pest = {
    planItems: records["pest-plan"].length,
    contract: (folders["pest-contract"] ?? 0) >= 1,
  };
  facts.lab = {
    planItems: records["lab-plan"].length,
    contract: (folders["lab-contract"] ?? 0) >= 1,
  };

  // Нормативы: выбранные из каталога и свои документы (запись блока одна).
  const norms = records.norms[0]?.data;
  facts.norms = { selected: norms ? norms.selected.length + norms.custom.length : 0 };

  facts.audit = {
    recentRecords: auditDocs,
    checklistRuns,
  };
  return facts;
}

export async function loadPpkStatuses(scope: PpkScope): Promise<Record<PpkBlockKey, PpkStatus>> {
  return computePpkStatuses(await loadPpkFacts(scope));
}
