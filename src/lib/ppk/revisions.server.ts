/**
 * Реестр редакций документов ППК: текущее содержимое документа, его отпечаток,
 * статус и утверждение новой редакции со следующим номером организации.
 * Правила — `revisions.ts`, решение владельца — spec `ppk-print-revisions-2026-11-24`.
 */
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { parsePpkRecords } from "./records";
import { ppkWhere, type PpkScope } from "./scope";
import { PPK_STRUCTURE_ITEMS, type PpkItemId } from "./structure";
import { ppkItemTitleRu } from "./structure-titles";
import type { PpkFolderKey } from "./folders";
import {
  nextRevisionNumber,
  normalizeRevisionText,
  parseRevisionDocKey,
  revisionCode,
  revisionDocKey,
  revisionStatus,
  type RevisionDocRef,
  type RevisionInfo,
  type RevisionState,
  type RevisionTextBlock,
} from "./revisions";

/** Пункт структуры текста: название документа и папка скана. */
const TEXT_ITEM: Record<RevisionTextBlock, PpkItemId> = {
  "text-haccp-principles": "1-8",
  "text-terms": "1-9",
  "text-team-regulation": "2-2",
  "text-team-leader": "2-3",
  "text-ccp-method": "2-9",
  "text-flow-schedule": "app-3",
};

/** Папки, документы которых ведут свои редакции (приложение № 5). */
export const REVISION_FOLDERS = ["procedures"] as const satisfies readonly PpkFolderKey[];

export type RevisionDoc = {
  /** Канонический ключ (с точкой области для текстов). */
  docKey: string;
  title: string;
  /** sha256 содержимого и названия. */
  hash: string;
  /** Нечего утверждать: текст не сохранён и скана нет. */
  empty: boolean;
  /** Документ базы знаний (папки нет) — утверждают те, кто управляет базой знаний (spec, Р5). */
  knowledgeBase: boolean;
};

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function itemOf(ref: RevisionDocRef): PpkItemId | null {
  if (ref.kind === "policy") return "2-1";
  if (ref.kind === "text") return TEXT_ITEM[ref.block];
  return null;
}

type FileRow = { id: string; title: string; mimeType: string; h: string };
type FileMeta = { id: string; title: string; mimeType: string; sizeBytes: number; updatedAt: Date };

/**
 * Отпечатки содержимого по (id, время изменения, размер) (R2-5): Postgres
 * хеширует файл один раз, а не на каждый просмотр плашек. Документ текстом —
 * sha256 текста без лишних пробелов. Изменение файла меняет `updatedAt`.
 */
const FINGERPRINTS = new Map<string, string>();
const FINGERPRINTS_MAX = 5000;

function fingerprintKey(row: Pick<FileMeta, "id" | "updatedAt" | "sizeBytes">): string {
  return `${row.id}:${row.updatedAt.getTime()}:${row.sizeBytes}`;
}

async function fingerprints(rows: FileMeta[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const missingFiles: string[] = [];
  const missingTexts: string[] = [];
  for (const row of rows) {
    const cached = FINGERPRINTS.get(fingerprintKey(row));
    if (cached) out.set(row.id, cached);
    else if (row.mimeType.startsWith("text/plain")) missingTexts.push(row.id);
    else missingFiles.push(row.id);
  }
  const [files, texts] = await Promise.all([
    missingFiles.length
      ? db.$queryRaw<{ id: string; h: string }[]>`
          SELECT id, encode(sha256(content), 'hex') AS h FROM "KnowledgeDocument" WHERE id IN (${Prisma.join(missingFiles)})`
      : Promise.resolve([]),
    missingTexts.length
      ? db.knowledgeDocument.findMany({ where: { id: { in: missingTexts } }, select: { id: true, content: true } })
      : Promise.resolve([]),
  ]);
  const fresh = new Map<string, string>([
    ...files.map((row) => [row.id, row.h] as const),
    ...texts.map((row) => [row.id, sha256(normalizeRevisionText(Buffer.from(row.content).toString("utf8")))] as const),
  ]);
  for (const row of rows) {
    const value = fresh.get(row.id);
    if (!value) continue;
    out.set(row.id, value);
    if (FINGERPRINTS.size >= FINGERPRINTS_MAX) FINGERPRINTS.delete(FINGERPRINTS.keys().next().value as string);
    FINGERPRINTS.set(fingerprintKey(row), value);
  }
  return out;
}

/** Файлы папки области с отпечатками. */
async function folderFiles(scope: PpkScope, folder: PpkFolderKey): Promise<FileRow[]> {
  const rows = await db.knowledgeDocument.findMany({
    where: { organizationId: scope.organizationId, folder, buildingId: scope.buildingId },
    select: { id: true, title: true, mimeType: true, sizeBytes: true, updatedAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const prints = await fingerprints(rows);
  return rows.flatMap((row) => {
    const h = prints.get(row.id);
    return h ? [{ id: row.id, title: row.title, mimeType: row.mimeType, h }] : [];
  });
}

/** Текст или скан пункта структуры: скан заменяет текст (правило документа владельца). */
async function structureDoc(scope: PpkScope, ref: Exclude<RevisionDocRef, { kind: "knowledge" }>): Promise<RevisionDoc> {
  const itemId = itemOf(ref)!;
  const item = PPK_STRUCTURE_ITEMS.find((entry) => entry.id === itemId)!;
  const block = ref.kind === "policy" ? "policy" : ref.block;
  const [row, scans] = await Promise.all([
    db.ppkRecord.findFirst({
      where: { ...ppkWhere(scope), block },
      select: { id: true, data: true, sortOrder: true, updatedAt: true },
    }),
    item.scanFolder ? folderFiles(scope, item.scanFolder) : Promise.resolve<FileRow[]>([]),
  ]);
  const title = ppkItemTitleRu(itemId);
  const docKey = revisionDocKey(ref, scope.buildingId);
  if (scans.length > 0) {
    const print = scans.map((file) => `${file.title}\n${file.h}`).join("\n");
    return { docKey, title, hash: sha256(`scan\n${title}\n${print}`), empty: false, knowledgeBase: false };
  }
  const text = row
    ? ref.kind === "policy"
      ? (parsePpkRecords("policy", [row])[0]?.data.text ?? "")
      : (parsePpkRecords(ref.block, [row])[0]?.data.text ?? "")
    : "";
  const normalized = normalizeRevisionText(text);
  return { docKey, title, hash: sha256(`text\n${title}\n${normalized}`), empty: normalized.length === 0, knowledgeBase: false };
}

/** Документы базы знаний и папок с редакциями. Чужие и не те — пропускаются. */
async function knowledgeDocs(scope: PpkScope, ids: string[]): Promise<Map<string, RevisionDoc>> {
  const out = new Map<string, RevisionDoc>();
  if (ids.length === 0) return out;
  const rows = await db.knowledgeDocument.findMany({
    where: { organizationId: scope.organizationId, kind: null, id: { in: ids } },
    select: { id: true, title: true, mimeType: true, folder: true, buildingId: true, sizeBytes: true, updatedAt: true },
  });
  const allowed = rows.filter((row) => {
    const inBase = row.folder === null;
    const inFolder = (REVISION_FOLDERS as readonly string[]).includes(row.folder ?? "") && row.buildingId === scope.buildingId;
    return inBase || inFolder;
  });
  const prints = await fingerprints(allowed);
  for (const row of allowed) {
    const h = prints.get(row.id);
    if (!h) continue;
    const text = row.mimeType.startsWith("text/plain");
    out.set(row.id, {
      docKey: revisionDocKey({ kind: "knowledge", id: row.id }, null),
      title: row.title,
      hash: sha256(`${text ? "text" : "file"}\n${row.title.trim()}\n${h}`),
      // Пустой документ текстом не создать (API требует текст) — пустых здесь нет.
      empty: false,
      knowledgeBase: row.folder === null,
    });
  }
  return out;
}

/**
 * Документы по ключам. Ключ текста чужой точки, чужой документ базы знаний,
 * битый ключ — нет в ответе (для API это «не найден»).
 */
export async function resolveRevisionDocs(scope: PpkScope, docKeys: readonly string[]): Promise<Map<string, RevisionDoc>> {
  const out = new Map<string, RevisionDoc>();
  const knowledge: { key: string; id: string }[] = [];
  const structure: { key: string; ref: Exclude<RevisionDocRef, { kind: "knowledge" }> }[] = [];
  for (const key of new Set(docKeys)) {
    const parsed = parseRevisionDocKey(key);
    if (!parsed) continue;
    if (parsed.ref.kind === "knowledge") knowledge.push({ key, id: parsed.ref.id });
    else if (parsed.buildingId === scope.buildingId) structure.push({ key, ref: parsed.ref });
  }
  const [docs, structureDocs] = await Promise.all([
    knowledgeDocs(scope, knowledge.map((entry) => entry.id)),
    Promise.all(structure.map(async (entry) => [entry.key, await structureDoc(scope, entry.ref)] as const)),
  ]);
  for (const entry of knowledge) {
    const doc = docs.get(entry.id);
    if (doc) out.set(entry.key, doc);
  }
  for (const [key, doc] of structureDocs) out.set(key, doc);
  return out;
}

function info(row: { number: number; approvedAt: Date; approvedByName: string }): RevisionInfo {
  return { number: row.number, code: revisionCode(row.number), approvedAt: row.approvedAt.toISOString(), approvedByName: row.approvedByName };
}

async function maxNumber(organizationId: string): Promise<number | null> {
  const agg = await db.ppkRevision.aggregate({ where: { organizationId }, _max: { number: true } });
  return agg._max.number ?? null;
}

/** Последние редакции документов: docKey → строка с наибольшим номером. */
async function latestRevisions(organizationId: string, docKeys: string[]) {
  if (docKeys.length === 0) return new Map<string, { number: number; contentHash: string; approvedAt: Date; approvedByName: string }>();
  const rows = await db.ppkRevision.findMany({
    where: { organizationId, docKey: { in: docKeys } },
    orderBy: { number: "desc" },
    select: { docKey: true, number: true, contentHash: true, approvedAt: true, approvedByName: true },
  });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!latest.has(row.docKey)) latest.set(row.docKey, row);
  return latest;
}

/** Состояния документов для плашек: статус, последняя редакция, следующий номер. */
export async function loadRevisionStates(scope: PpkScope, docKeys: readonly string[]): Promise<Map<string, RevisionState & { doc: RevisionDoc }>> {
  const docs = await resolveRevisionDocs(scope, docKeys.slice(0, 500));
  const keys = [...new Set([...docs.values()].map((doc) => doc.docKey))];
  const [latest, max] = await Promise.all([latestRevisions(scope.organizationId, keys), maxNumber(scope.organizationId)]);
  const out = new Map<string, RevisionState & { doc: RevisionDoc }>();
  for (const [requested, doc] of docs) {
    const last = latest.get(doc.docKey) ?? null;
    out.set(requested, {
      docKey: doc.docKey,
      status: revisionStatus(last?.contentHash, doc.hash),
      latest: last ? info(last) : null,
      nextNumber: nextRevisionNumber(max),
      doc,
    });
  }
  return out;
}

export type ApproveResult =
  | { ok: true; created: boolean; revision: RevisionInfo; docKey: string; title: string }
  | { ok: false; status: number; error: string };

/**
 * Утвердить текущую редакцию документа. Без изменений с прошлой — та же
 * редакция (`created: false`). Номер — максимум организации + 1; если его
 * успел занять параллельный запрос (уникальный индекс), берём следующий.
 */
export async function approveRevision(
  scope: PpkScope,
  actor: { id: string; name: string },
  docKey: string,
): Promise<ApproveResult> {
  const doc = (await resolveRevisionDocs(scope, [docKey])).get(docKey);
  if (!doc) return { ok: false, status: 404, error: "Документ не найден" };
  if (doc.empty) return { ok: false, status: 400, error: "Документ пуст: сохраните текст или загрузите скан" };
  // Утверждения одной организации — по очереди (блокировка транзакции): два
  // одновременных нажатия не дадут одной редакции два номера и не займут один номер дважды.
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ppk-revision:${scope.organizationId}`}))`;
    const last = await tx.ppkRevision.findFirst({
      where: { organizationId: scope.organizationId, docKey: doc.docKey },
      orderBy: { number: "desc" },
      select: { number: true, contentHash: true, approvedAt: true, approvedByName: true },
    });
    if (last && last.contentHash === doc.hash) {
      return { ok: true as const, created: false, revision: info(last), docKey: doc.docKey, title: doc.title };
    }
    const max = await tx.ppkRevision.aggregate({ where: { organizationId: scope.organizationId }, _max: { number: true } });
    const row = await tx.ppkRevision.create({
      data: {
        organizationId: scope.organizationId,
        docKey: doc.docKey,
        title: doc.title.slice(0, 300),
        number: nextRevisionNumber(max._max.number),
        contentHash: doc.hash,
        approvedById: actor.id,
        approvedByName: actor.name.slice(0, 200),
      },
      select: { number: true, approvedAt: true, approvedByName: true },
    });
    return { ok: true as const, created: true, revision: info(row), docKey: doc.docKey, title: doc.title };
  });
}

export type RegisterRow = RevisionInfo & { docKey: string; title: string; supersededBy: string | null };

/**
 * Реестр редакций: новые сверху; у прежних — чем заменены. `pointId` —
 * руководитель одной точки: документы других точек (их тексты и процедуры)
 * ему не показываются; общие документы (база знаний, ППК организации) — да.
 */
export async function loadRevisionRegister(organizationId: string, pointId: string | null = null): Promise<RegisterRow[]> {
  const rows = await db.ppkRevision.findMany({
    where: { organizationId },
    orderBy: { number: "desc" },
    take: 1000,
    select: { docKey: true, title: true, number: true, approvedAt: true, approvedByName: true },
  });
  const newer = new Map<string, number>();
  const all = rows.map((row) => {
    const supersededBy = newer.get(row.docKey) ?? null;
    newer.set(row.docKey, row.number);
    return { ...info(row), docKey: row.docKey, title: row.title, supersededBy: supersededBy ? revisionCode(supersededBy) : null };
  });
  if (!pointId) return all;
  const knowledgeIds = [...new Set(all.flatMap((row) => (row.docKey.startsWith("knowledge:") ? [row.docKey.slice("knowledge:".length)] : [])))];
  const folders = knowledgeIds.length
    ? await db.knowledgeDocument.findMany({ where: { organizationId, id: { in: knowledgeIds } }, select: { id: true, folder: true, buildingId: true } })
    : [];
  // Свои и общие документы; удалённый документ (точку уже не узнать) руководителю точки не показываем (R2-8).
  const visibleDocs = new Set(folders.filter((doc) => doc.folder === null || doc.buildingId === pointId).map((doc) => `knowledge:${doc.id}`));
  return all.filter((row) => {
    if (row.docKey.startsWith("knowledge:")) return visibleDocs.has(row.docKey);
    const at = row.docKey.indexOf("@");
    return at < 0 || row.docKey.slice(at + 1) === pointId;
  });
}

/** Состояние для клиента: без отпечатка содержимого. */
export function clientRevisionState(
  state: RevisionState & { doc: RevisionDoc },
): RevisionState & { title: string; empty: boolean } {
  const { doc, ...rest } = state;
  return { ...rest, title: doc.title, empty: doc.empty };
}
