/**
 * Реестр редакций документов ППК: текущее содержимое документа, его отпечаток,
 * статус и утверждение новой редакции со следующим номером организации.
 * Правила — `revisions.ts`, решение владельца — spec `ppk-print-revisions-2026-11-24`.
 */
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { docxPlainText } from "@/lib/office-text";
import { diffTexts, type DiffResult } from "../../../../../../src/lib/ppk/revision-diff";
import { parsePpkRecords } from "../../../../../../src/lib/ppk/records";
import { ppkWhere, type PpkScope } from "../../../../../../src/lib/ppk/scope";
import { PPK_STRUCTURE_ITEMS, type PpkItemId } from "../../../../../../src/lib/ppk/structure";
import { ppkItemTitleRu } from "../../../../../../src/lib/ppk/structure-titles";
import type { PpkFolderKey } from "../../../../../../src/lib/ppk/folders";
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
} from "../../../../../../src/lib/ppk/revisions";

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

/** Предел сохранённого содержимого редакции. */
export const REVISION_CONTENT_MAX = 200_000;

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Строка файла без текста: название, размер и начало отпечатка — замена файла видна в сравнении. */
function fileLine(title: string, sizeBytes: number, hash: string): string {
  return `Файл: ${title.trim()} · ${Math.max(1, Math.round(sizeBytes / 1024))} КБ · отпечаток ${hash.slice(0, 8)}`;
}

/** Текст файла для сравнения: документ текстом — текст, DOCX — извлечённый текст, остальное — строка файла. */
async function fileContent(row: { id: string; title: string; mimeType: string; sizeBytes: number }, hash: string): Promise<string> {
  const textual = row.mimeType.startsWith("text/plain");
  const docx = row.mimeType === DOCX_MIME || row.title.toLowerCase().endsWith(".docx");
  if (!textual && !docx) return fileLine(row.title, row.sizeBytes, hash);
  const file = await db.knowledgeDocument.findUnique({ where: { id: row.id }, select: { content: true } });
  if (!file) return fileLine(row.title, row.sizeBytes, hash);
  if (textual) return Buffer.from(file.content).toString("utf8").trim();
  return docxPlainText(file.content)?.trim() || fileLine(row.title, row.sizeBytes, hash);
}

/**
 * Содержимое документа для сравнения редакций (2026-11-25): то, что видит
 * человек, — текст пункта или политики, текст документа базы знаний (у файла —
 * название в первой строке), у скана — строки файлов. Документ вне области — null.
 */
export async function revisionContent(scope: PpkScope, docKey: string): Promise<{ docKey: string; title: string; content: string } | null> {
  const doc = (await resolveRevisionDocs(scope, [docKey])).get(docKey);
  const parsed = parseRevisionDocKey(docKey);
  if (!doc || !parsed) return null;
  let content: string;
  if (parsed.ref.kind === "knowledge") {
    const row = await db.knowledgeDocument.findFirst({
      where: { id: parsed.ref.id, organizationId: scope.organizationId },
      select: { id: true, title: true, mimeType: true, sizeBytes: true, updatedAt: true },
    });
    if (!row) return null;
    const hash = (await fingerprints([row])).get(row.id) ?? "";
    content = `${row.title.trim()}\n\n${await fileContent(row, hash)}`;
  } else {
    const itemId = itemOf(parsed.ref)!;
    const item = PPK_STRUCTURE_ITEMS.find((entry) => entry.id === itemId)!;
    const scans = item.scanFolder
      ? await db.knowledgeDocument.findMany({
          where: { organizationId: scope.organizationId, folder: item.scanFolder, buildingId: scope.buildingId },
          select: { id: true, title: true, mimeType: true, sizeBytes: true, updatedAt: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        })
      : [];
    if (scans.length > 0) {
      const prints = await fingerprints(scans);
      content = (await Promise.all(scans.map((row) => fileContent(row, prints.get(row.id) ?? "")))).join("\n\n");
    } else {
      const block = parsed.ref.kind === "policy" ? "policy" : parsed.ref.block;
      const row = await db.ppkRecord.findFirst({
        where: { ...ppkWhere(scope), block },
        select: { id: true, data: true, sortOrder: true, updatedAt: true },
      });
      content = row
        ? parsed.ref.kind === "policy"
          ? (parsePpkRecords("policy", [row])[0]?.data.text ?? "")
          : (parsePpkRecords(parsed.ref.block, [row])[0]?.data.text ?? "")
        : "";
    }
  }
  return { docKey: doc.docKey, title: doc.title, content: content.trim().slice(0, REVISION_CONTENT_MAX) };
}

/**
 * Утвердить текущую редакцию документа. Без изменений с прошлой — та же
 * редакция (`created: false`). Номер — максимум организации + 1; если его
 * успел занять параллельный запрос (уникальный индекс), берём следующий.
 * Содержимое сохраняется вместе с редакцией — для сравнения (2026-11-25).
 */
export async function approveRevision(
  scope: PpkScope,
  actor: { id: string; name: string },
  docKey: string,
): Promise<ApproveResult> {
  const doc = (await resolveRevisionDocs(scope, [docKey])).get(docKey);
  if (!doc) return { ok: false, status: 404, error: "Документ не найден" };
  if (doc.empty) return { ok: false, status: 400, error: "Документ пуст: сохраните текст или загрузите скан" };
  // Содержимое — до транзакции: чтение файла не держит блокировку утверждений.
  const snapshot = await revisionContent(scope, docKey).catch(() => null);
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
        content: snapshot?.content ?? null,
        approvedById: actor.id,
        approvedByName: actor.name.slice(0, 200),
      },
      select: { number: true, approvedAt: true, approvedByName: true },
    });
    return { ok: true as const, created: true, revision: info(row), docKey: doc.docKey, title: doc.title };
  });
}

export type RegisterRow = RevisionInfo & {
  docKey: string;
  title: string;
  supersededBy: string | null;
  /** Предыдущая редакция того же документа — для «Сравнить с ППК NNN». */
  previous: { number: number; code: string } | null;
};

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
  // Предыдущая (более старая) редакция документа: строки — новые сверху.
  const older = new Map<number, number>();
  const lastSeen = new Map<string, number>();
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    const before = lastSeen.get(row.docKey);
    if (before !== undefined) older.set(row.number, before);
    lastSeen.set(row.docKey, row.number);
  }
  const all = rows.map((row) => {
    const supersededBy = newer.get(row.docKey) ?? null;
    newer.set(row.docKey, row.number);
    const previous = older.get(row.number) ?? null;
    return {
      ...info(row),
      docKey: row.docKey,
      title: row.title,
      supersededBy: supersededBy ? revisionCode(supersededBy) : null,
      previous: previous ? { number: previous, code: revisionCode(previous) } : null,
    };
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

export type RevisionHistoryItem = RevisionInfo & { hasContent: boolean };
export type CompareSide = { kind: "revision"; number: number } | { kind: "current" };
export type CompareResult =
  | {
      ok: true;
      docKey: string;
      title: string;
      history: RevisionHistoryItem[];
      /** Текущий текст есть в области (документ не удалён, своя точка). */
      currentAvailable: boolean;
      from: CompareSide;
      to: CompareSide;
      /** Сторона без сохранённого текста: редакция утверждена до сравнения. */
      unavailable: "from" | "to" | null;
      diff: DiffResult | null;
    }
  | { ok: false; status: number; error: string };

/**
 * Документ виден в сравнении так же, как в реестре: руководителю точки — свои
 * и общие документы, остальным — все документы организации.
 */
async function revisionDocVisible(organizationId: string, docKey: string, pointId: string | null): Promise<boolean> {
  if (!pointId) return true;
  if (docKey.startsWith("knowledge:")) {
    const doc = await db.knowledgeDocument.findFirst({
      where: { organizationId, id: docKey.slice("knowledge:".length) },
      select: { folder: true, buildingId: true },
    });
    return Boolean(doc && (doc.folder === null || doc.buildingId === pointId));
  }
  const at = docKey.indexOf("@");
  return at < 0 || docKey.slice(at + 1) === pointId;
}

/**
 * Сравнение редакций документа (2026-11-25): «было» — редакция, «стало» —
 * редакция или текущий текст. Без `from`/`to` — изменён после утверждения:
 * последняя редакция ↔ текущий текст, иначе предыдущая ↔ последняя.
 */
export async function compareRevisions(
  scope: PpkScope,
  docKey: string,
  pointId: string | null,
  requested: { from?: number | null; to?: number | "current" | null },
): Promise<CompareResult> {
  const parsed = parseRevisionDocKey(docKey);
  if (!parsed) return { ok: false, status: 404, error: "Документ не найден" };
  const canonical = parsed.ref.kind === "knowledge" ? docKey : revisionDocKey(parsed.ref, parsed.buildingId);
  if (!(await revisionDocVisible(scope.organizationId, canonical, pointId))) {
    return { ok: false, status: 404, error: "Документ не найден" };
  }
  const rows = await db.ppkRevision.findMany({
    where: { organizationId: scope.organizationId, docKey: canonical },
    orderBy: { number: "desc" },
    select: { number: true, title: true, contentHash: true, content: true, approvedAt: true, approvedByName: true },
  });
  if (rows.length === 0) return { ok: false, status: 404, error: "У документа нет утверждённых редакций" };
  const current = await revisionContent(scope, canonical);
  const currentDoc = current ? (await resolveRevisionDocs(scope, [canonical])).get(canonical) ?? null : null;
  const history = rows.map((row) => ({ ...info(row), hasContent: row.content !== null }));

  const byNumber = new Map(rows.map((row) => [row.number, row]));
  let fromNumber = requested.from ?? null;
  let to: CompareSide | null =
    requested.to === "current" ? { kind: "current" } : typeof requested.to === "number" ? { kind: "revision", number: requested.to } : null;
  if (fromNumber === null && to === null) {
    const latest = rows[0];
    const changed = currentDoc !== null && currentDoc.hash !== latest.contentHash;
    if (changed || rows.length === 1) {
      fromNumber = latest.number;
      to = current ? { kind: "current" } : { kind: "revision", number: latest.number };
    } else {
      fromNumber = rows[1].number;
      to = { kind: "revision", number: latest.number };
    }
  }
  if (fromNumber === null) fromNumber = rows[0].number;
  if (to === null) to = current ? { kind: "current" } : { kind: "revision", number: rows[0].number };
  const fromRow = byNumber.get(fromNumber);
  if (!fromRow) return { ok: false, status: 404, error: "Редакция не найдена" };
  if (to.kind === "revision" && !byNumber.has(to.number)) return { ok: false, status: 404, error: "Редакция не найдена" };
  if (to.kind === "current" && !current) return { ok: false, status: 404, error: "Текущего текста документа нет" };

  const before = fromRow.content;
  const after = to.kind === "current" ? current!.content : byNumber.get(to.number)!.content;
  const unavailable = before === null ? "from" : after === null ? "to" : null;
  return {
    ok: true,
    docKey: canonical,
    title: current?.title ?? rows[0].title,
    history,
    currentAvailable: current !== null,
    from: { kind: "revision", number: fromRow.number },
    to,
    unavailable,
    diff: unavailable ? null : diffTexts(before!, after!),
  };
}
