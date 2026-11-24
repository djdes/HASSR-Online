/**
 * Данные печатной Программы производственного контроля по структуре документа
 * владельца (вариант «б», spec `ppk-print-revisions-2026-11-24`): всё, что
 * показывают окна 32 пунктов, плюс сканы, номера редакций и подписи листа 3.7.
 */
import { db } from "@/lib/db";
import ru from "@/i18n/messages/ru.json";
import { loadPpkBundle, type PpkBundle } from "./assemble.server";
import { ppkGeneralInfoRows } from "./print-org";
import { loadDocumentOrgBlock } from "@/lib/document-org-block.server";
import { parsePpkRecords, type DiagramData, type PpkTextBlock } from "./records";
import { ppkWhere, type PpkScope } from "./scope";
import { PRODUCTION_INFO_FIELDS } from "./structure-fields";
import { loadProductionPulled, ppkEquipmentWhere } from "./structure-facts.server";
import { loadPpkStaff } from "./staff.server";
import { PRP_TEMPLATES, ppkTextTemplate, type RegulationMember } from "./structure-templates";
import { PPK_STRUCTURE_ITEMS, type PpkItemId } from "./structure";
import { PRP_TABLE_BLOCKS, PRP_TABLES, type PrpRow, type PrpTableBlock } from "./prp-tables";
import { ackStats, ppkAckVersion } from "./acknowledge.server";
import { staffAtBuildingWhere } from "@/lib/building-settings";
import type { AckMethod } from "./signature";
import { isTextDoc } from "./text-docs";
import { loadRevisionStates } from "./revisions.server";
import { revisionDocKey, revisionLabel, type RevisionTextBlock } from "./revisions";
import { journalResponsibles } from "./officials";
import { loadEnabledJournals } from "./journals.server";
import type { PpkFolderKey } from "./folders";
import { SCAN_MAX_BYTES } from "./structure-pdf";

const STRUCTURE = ru.productionControl.structure;

/**
 * Файл документа для печати. Байты читаются только в пределах объёма сканов
 * программы (`SCAN_MAX_BYTES`); сверх — пустые, файл печатается строкой.
 */
export type PrintFile = { id: string; title: string; fileName: string; mimeType: string; sizeBytes: number; bytes: Uint8Array };

/**
 * Документ с шапкой: текст или файлы (скан заменяет текст). `revision` —
 * «ППК 003 от 24.11.2026», если текущая редакция утверждена и не менялась;
 * иначе null — в колонтитуле «Редакция не утверждена».
 */
export type PrintDoc = { title: string; revision: string | null; text: string | null; files: PrintFile[] };

export type PrintAck = { name: string; title: string; at: string; method: AckMethod; signature: Uint8Array | null };

export type PpkPrintData = {
  bundle: PpkBundle;
  timeZone: string;
  orgName: string;
  generalInfo: string[][];
  orgCharts: DiagramData[];
  contracts: { title: string; counterparty: string; number: string; date: string | null; validUntil: string | null }[];
  production: string[][];
  floorPlans: DiagramData[];
  /** Тексты пунктов 1.8, 1.9, 2.1, 2.2, 2.3, 2.9, прил. 3. */
  docs: Partial<Record<PpkItemId, PrintDoc>>;
  teamOrders: { number: string; date: string }[];
  teamOrderScans: PrintFile[];
  prp: Record<PrpTableBlock, { heads: string[]; rows: string[][] }>;
  staffByPosition: { title: string; names: string[] }[];
  officials: string[][];
  /** null — программа не утверждена версией и не загружена файлом: лист пустой. */
  acks: PrintAck[] | null;
  pendingNames: { name: string; title: string }[];
  equipment: string[][];
  labFiles: string[];
  procedures: PrintDoc[];
  instructions: PrintDoc[];
};

const PRP_COLUMN_LABELS = STRUCTURE.prp.columns as Record<PrpTableBlock, Record<string, string>>;

const META = { id: true, title: true, fileName: true, mimeType: true, sizeBytes: true } as const;
const EMPTY = new Uint8Array();

async function folderFiles(scope: PpkScope, folder: PpkFolderKey): Promise<PrintFile[]> {
  const rows = await db.knowledgeDocument.findMany({
    where: { ...ppkWhere(scope), folder },
    select: META,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 100,
  });
  return rows.map((row) => ({ ...row, bytes: EMPTY }));
}

/** Байты файлов по порядку программы, пока не набран объём сканов; остальные — пустые. */
async function attachBytes(files: PrintFile[]): Promise<void> {
  let budget = SCAN_MAX_BYTES;
  const wanted: string[] = [];
  for (const file of files) {
    if (wanted.includes(file.id)) continue;
    if (file.sizeBytes <= budget) {
      wanted.push(file.id);
      budget -= file.sizeBytes;
    }
  }
  if (wanted.length === 0) return;
  const rows = await db.knowledgeDocument.findMany({ where: { id: { in: wanted } }, select: { id: true, content: true } });
  const bytes = new Map(rows.map((row) => [row.id, new Uint8Array(row.content)]));
  for (const file of files) file.bytes = bytes.get(file.id) ?? EMPTY;
}

function docTimeZoneLabel(state: { status: string; latest: { code: string; approvedAt: string } | null } | undefined, timeZone: string): string | null {
  return state && state.status === "approved" && state.latest ? revisionLabel(state.latest, timeZone) : null;
}

export async function loadPpkPrintData(scope: PpkScope): Promise<PpkPrintData> {
  const [bundle, org, rows, staff, orgBlock, pulled, journals, version] = await Promise.all([
    loadPpkBundle(scope),
    db.organization.findUnique({ where: { id: scope.organizationId }, select: { name: true, timezone: true, journalResponsibleUsersJson: true } }),
    db.ppkRecord.findMany({
      where: {
        ...ppkWhere(scope),
        block: { in: ["org-chart", "contracts", "production-info", "floor-plan", ...PRP_TABLE_BLOCKS, ...PPK_TEXT_BLOCKS_FOR_PRINT] },
      },
      select: { id: true, block: true, data: true, sortOrder: true, updatedAt: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    loadPpkStaff(scope),
    loadDocumentOrgBlock(scope.organizationId, { buildingId: scope.buildingId }),
    loadProductionPulled(scope),
    loadEnabledJournals(scope.organizationId, scope.buildingId),
    ppkAckVersion(scope),
  ]);
  const timeZone = org?.timezone || "Europe/Moscow";
  const orgName = orgBlock?.org.shortName || orgBlock?.org.fullName || org?.name || "";
  const of = <B extends Parameters<typeof parsePpkRecords>[0]>(block: B) =>
    parsePpkRecords(block, rows.filter((row) => row.block === block));

  // 1.1 и 1.4
  const leader = bundle.team.find((member) => member.role === "leader");
  const generalInfo = ppkGeneralInfoRows(bundle.org, leader).map((row) => row.map((cell) => String(cell ?? "")));
  const productionRow = of("production-info")[0]?.data ?? null;
  const productionLabels = STRUCTURE.production.fields as Record<string, string>;
  const production: string[][] = [
    [productionLabels.objectName, pulled.objectName || "—"],
    [productionLabels.objectAddress, pulled.objectAddress || "—"],
    [productionLabels.staffCount, String(staff.length)],
    ...PRODUCTION_INFO_FIELDS.filter((field) => field.key !== "extra" || (productionRow?.extra ?? "").trim()).map((field) => [
      productionLabels[field.key] ?? field.key,
      (field.key === "activity" ? productionRow?.activity || pulled.activity : productionRow?.[field.key]) || "—",
    ]),
  ];

  // Тексты пунктов: свой текст, иначе шаблон пункта; скан заменяет текст.
  const members: RegulationMember[] = bundle.team.map((member) => ({ name: member.name, title: member.title, role: member.role }));
  const textItems = PPK_STRUCTURE_ITEMS.filter((item) => item.text || item.id === "2-1");
  const revisionKeys = textItems.map((item) =>
    item.id === "2-1" ? revisionDocKey({ kind: "policy" }, scope.buildingId) : revisionDocKey({ kind: "text", block: item.text!.block as RevisionTextBlock }, scope.buildingId),
  );
  const [scanLists, teamOrderScans, procedureFiles, instructionFiles, labFiles, teamOrders] = await Promise.all([
    Promise.all(textItems.map((item) => (item.scanFolder ? folderFiles(scope, item.scanFolder) : Promise.resolve<PrintFile[]>([])))),
    folderFiles(scope, "team-order-scan"),
    folderFiles(scope, "procedures"),
    db.knowledgeDocument
      .findMany({
        where: { organizationId: scope.organizationId, kind: null, folder: null },
        select: META,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 200,
      })
      .then((list) => list.map((row) => ({ ...row, bytes: EMPTY }))),
    db.knowledgeDocument.findMany({
      where: { ...ppkWhere(scope), folder: { in: ["lab-contract", "lab-protocols", "lab-acts"] } },
      select: { title: true },
      orderBy: { createdAt: "asc" },
      take: 100,
    }),
    db.companyOrder.findMany({
      where: { organizationId: scope.organizationId, templateCode: "haccp-team" },
      orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }],
      select: { number: true, issuedAt: true },
      take: 3,
    }),
  ]);
  // Байты — в порядке программы (тексты пунктов, приказ, процедуры, инструкции) до предела объёма.
  await attachBytes([...scanLists.flat(), ...teamOrderScans, ...procedureFiles, ...instructionFiles]);
  const knowledgeKeys = [...procedureFiles, ...instructionFiles].map((file) => `knowledge:${file.id}`);
  const states = await loadRevisionStates(scope, [...revisionKeys, ...knowledgeKeys]);

  const docs: Partial<Record<PpkItemId, PrintDoc>> = {};
  textItems.forEach((item, index) => {
    const files = scanLists[index];
    let text: string | null = null;
    if (item.id === "2-1") text = bundle.policy?.text ?? null;
    else {
      const block = item.text!.block as PpkTextBlock;
      const own = parsePpkRecords(block, rows.filter((row) => row.block === block))[0]?.data.text ?? "";
      text = own.trim() ? own : ppkTextTemplate(item.text!.template, orgName, members) || null;
    }
    docs[item.id] = {
      title: (STRUCTURE.items as Record<string, { title: string }>)[item.id]?.title ?? item.id,
      revision: docTimeZoneLabel(states.get(revisionKeys[index]), timeZone),
      text,
      files,
    };
  });

  const asDoc = (file: PrintFile): PrintDoc => ({
    title: file.title,
    revision: docTimeZoneLabel(states.get(`knowledge:${file.id}`), timeZone),
    text: isTextDoc(file.mimeType) ? Buffer.from(file.bytes).toString("utf8") : null,
    files: isTextDoc(file.mimeType) ? [] : [file],
  });

  // 3.1–3.4: свои строки, иначе типовые (как в окне пункта).
  const prp = Object.fromEntries(
    PRP_TABLE_BLOCKS.map((block) => {
      const columns = PRP_TABLES[block];
      const own = of(block).map((row) => row.data as PrpRow);
      const source = own.length > 0 ? own : PRP_TEMPLATES[block];
      return [
        block,
        {
          heads: columns.map((column) => PRP_COLUMN_LABELS[block]?.[column.key] ?? column.key),
          rows: source.map((row) => columns.map((column) => row[column.key] || "—")),
        },
      ];
    }),
  ) as PpkPrintData["prp"];

  // 3.5: должности и люди.
  const byTitle = new Map<string, string[]>();
  for (const person of staff) {
    const title = person.title || STRUCTURE.staff.noPosition;
    byTitle.set(title, [...(byTitle.get(title) ?? []), person.name]);
  }

  // 3.7: должностные лица и лист ознакомления с подписями.
  const people = new Map(staff.map((person) => [person.id, person]));
  const responsibles = journalResponsibles(journals, org?.journalResponsibleUsersJson, people);
  const roleLabels = STRUCTURE.acquaintance.roles as Record<string, string>;
  const officials = [
    ...bundle.team.map((member) => [member.name, member.title || "—", roleLabels[member.role] ?? member.role]),
    ...responsibles.map((person) => [person.name, person.title || "—", STRUCTURE.acquaintance.journalsDuty.replace("{journals}", person.journals.join(", "))]),
  ];
  // Те же люди и отметки, что в окне 3.7 (сотрудники точки); подписи — только у отмеченных.
  let acks: PrintAck[] | null = null;
  let pendingNames: { name: string; title: string }[] = [];
  const stats = version ? await ackStats(scope, "ppk", staffAtBuildingWhere(scope.buildingId)) : null;
  if (stats) {
    const signed = await db.ppkAcknowledgement.findMany({
      where: {
        organizationId: scope.organizationId,
        docKey: "ppk",
        version: stats.version,
        userId: { in: stats.acknowledged.map((row) => row.userId) },
        signature: { not: null },
      },
      select: { userId: true, signature: true },
    });
    const signatures = new Map(signed.map((row) => [row.userId, row.signature ? new Uint8Array(row.signature) : null]));
    acks = stats.acknowledged.map((row) => ({
      name: row.name,
      title: people.get(row.userId)?.title ?? "",
      at: row.at,
      method: row.method,
      signature: signatures.get(row.userId) ?? null,
    }));
    pendingNames = stats.pending.map((row) => ({ name: row.name, title: people.get(row.userId)?.title ?? "" }));
  }

  // Приложение № 1: оборудование объекта.
  const equipment = await db.equipment.findMany({
    where: ppkEquipmentWhere(scope),
    select: { name: true, type: true, serialNumber: true, tempMin: true, tempMax: true, area: { select: { name: true } } },
    orderBy: [{ area: { name: "asc" } }, { name: "asc" }],
    take: 1000,
  });
  const range = (min: number | null, max: number | null) => (min === null && max === null ? "—" : `${min ?? "…"} … ${max ?? "…"} °C`);

  return {
    bundle,
    timeZone,
    orgName,
    generalInfo,
    orgCharts: of("org-chart").map((row) => row.data),
    contracts: of("contracts").map((row) => ({
      title: row.data.title,
      counterparty: row.data.counterparty,
      number: row.data.number,
      date: row.data.date ?? null,
      validUntil: row.data.validUntil ?? null,
    })),
    production,
    floorPlans: of("floor-plan").map((row) => row.data),
    docs,
    teamOrders: teamOrders.map((order) => ({
      number: order.number,
      date: new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" }).format(order.issuedAt),
    })),
    teamOrderScans,
    prp,
    staffByPosition: [...byTitle.entries()].sort((a, b) => a[0].localeCompare(b[0], "ru")).map(([title, names]) => ({ title, names })),
    officials,
    acks,
    pendingNames,
    equipment: equipment.map((item, index) => [
      String(index + 1),
      item.name,
      item.type || "—",
      item.area?.name ?? "—",
      item.serialNumber || "—",
      range(item.tempMin, item.tempMax),
    ]),
    labFiles: labFiles.map((file) => file.title),
    procedures: procedureFiles.map(asDoc),
    instructions: instructionFiles.map(asDoc),
  };
}

const PPK_TEXT_BLOCKS_FOR_PRINT = [
  "text-haccp-principles",
  "text-terms",
  "text-team-regulation",
  "text-team-leader",
  "text-ccp-method",
  "text-flow-schedule",
] as const;

