/**
 * Редакции документов ППК (2026-11-24, владелец): «нажал «Утвердить редакцию» —
 * документу присваивается порядковый номер по ХАССП; если хоть одно слово
 * меняется — новая редакция и новый номер». Чистый модуль: ключи документов,
 * код «ППК 001», нормализация текста и статус. БД — `revisions.server.ts`.
 */
import type { PpkTextBlock } from "./records";

/** Тексты структуры ППК с редакциями: 1.8, 1.9, 2.2, 2.3, 2.9 и приложение № 3. */
export const REVISION_TEXT_BLOCKS = [
  "text-haccp-principles",
  "text-terms",
  "text-team-regulation",
  "text-team-leader",
  "text-ccp-method",
  "text-flow-schedule",
] as const satisfies readonly PpkTextBlock[];
export type RevisionTextBlock = (typeof REVISION_TEXT_BLOCKS)[number];

export type RevisionDocRef =
  | { kind: "text"; block: RevisionTextBlock }
  | { kind: "policy" }
  | { kind: "knowledge"; id: string };

/** Что показывает плашка документа: нет редакции, утверждена, изменён после утверждения. */
export type RevisionStatus = "none" | "approved" | "changed";

export type RevisionInfo = { number: number; code: string; approvedAt: string; approvedByName: string };

export type RevisionState = {
  docKey: string;
  status: RevisionStatus;
  /** Последняя утверждённая редакция документа или null. */
  latest: RevisionInfo | null;
  /** Номер, который получит следующая утверждённая редакция (подсказка в вопросе). */
  nextNumber: number;
};

const KNOWLEDGE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const BUILDING_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** «ППК 001»; после 999 — «ППК 1000». */
export function revisionCode(number: number): string {
  return `ППК ${String(Math.max(0, Math.trunc(number))).padStart(3, "0")}`;
}

/** Следующий номер реестра: максимум организации + 1 (пустой реестр — 1). */
export function nextRevisionNumber(max: number | null | undefined): number {
  return (max ?? 0) + 1;
}

/**
 * Текст для отпечатка: пробелы, табуляции и переносы строк — не слова, их
 * количество не меняет редакцию. Любое слово или знак — изменение.
 */
export function normalizeRevisionText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Статус по отпечатку последней редакции и текущему отпечатку. */
export function revisionStatus(latestHash: string | null | undefined, currentHash: string): RevisionStatus {
  if (!latestHash) return "none";
  return latestHash === currentHash ? "approved" : "changed";
}

/**
 * Ключ документа в реестре. Тексты и политика ведутся на точке (ППК точки) —
 * к ключу добавляется `@<точка>`; документы базы знаний — общие для организации.
 */
export function revisionDocKey(ref: RevisionDocRef, buildingId: string | null): string {
  if (ref.kind === "knowledge") return `knowledge:${ref.id}`;
  const base = ref.kind === "policy" ? "policy" : `text:${ref.block}`;
  return buildingId ? `${base}@${buildingId}` : base;
}

/** Разбор ключа; чужой или битый ключ — null. */
export function parseRevisionDocKey(key: string): { ref: RevisionDocRef; buildingId: string | null } | null {
  if (typeof key !== "string" || key.length > 200) return null;
  if (key.startsWith("knowledge:")) {
    const id = key.slice("knowledge:".length);
    return KNOWLEDGE_ID_RE.test(id) ? { ref: { kind: "knowledge", id }, buildingId: null } : null;
  }
  const [base, buildingId = null, ...rest] = key.split("@");
  if (rest.length > 0 || (buildingId !== null && !BUILDING_ID_RE.test(buildingId))) return null;
  if (base === "policy") return { ref: { kind: "policy" }, buildingId };
  if (base.startsWith("text:")) {
    const block = base.slice("text:".length);
    return (REVISION_TEXT_BLOCKS as readonly string[]).includes(block)
      ? { ref: { kind: "text", block: block as RevisionTextBlock }, buildingId }
      : null;
  }
  return null;
}

/** «ППК 003 от 24.11.2026» — для колонтитула и плашки. */
export function revisionLabel(info: Pick<RevisionInfo, "code" | "approvedAt">, timeZone = "Europe/Moscow"): string {
  let date: string;
  try {
    date = new Intl.DateTimeFormat("ru-RU", { timeZone, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(info.approvedAt));
  } catch {
    date = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(info.approvedAt));
  }
  return `${info.code} от ${date}`;
}

/** Сторона сравнения: утверждённая редакция или текущий текст документа. */
export type RevisionCompareSide = { kind: "revision"; number: number } | { kind: "current" };

/**
 * Какие стороны сравнить (2026-11-25). `rows` — редакции документа от новой к
 * старой (хотя бы одна). Без `from`/`to`: документ изменён после утверждения —
 * последняя редакция ↔ текущий текст, иначе предыдущая ↔ последняя.
 */
export function pickCompareSides(
  rows: ReadonlyArray<{ number: number; contentHash: string }>,
  requested: { from?: number | null; to?: number | "current" | null },
  current: { available: boolean; hash: string | null },
): { ok: true; from: number; to: RevisionCompareSide } | { ok: false; code: "revision_not_found" | "no_current_text" } {
  const latest = rows[0];
  let from = requested.from ?? null;
  let to: RevisionCompareSide | null =
    requested.to === "current" ? { kind: "current" } : typeof requested.to === "number" ? { kind: "revision", number: requested.to } : null;
  if (from === null && to === null) {
    const changed = current.hash !== null && current.hash !== latest.contentHash;
    if (changed || rows.length === 1) {
      from = latest.number;
      to = current.available ? { kind: "current" } : { kind: "revision", number: latest.number };
    } else {
      from = rows[1].number;
      to = { kind: "revision", number: latest.number };
    }
  }
  if (from === null) from = latest.number;
  if (to === null) to = current.available ? { kind: "current" } : { kind: "revision", number: latest.number };
  const numbers = new Set(rows.map((row) => row.number));
  if (!numbers.has(from)) return { ok: false, code: "revision_not_found" };
  if (to.kind === "revision" && !numbers.has(to.number)) return { ok: false, code: "revision_not_found" };
  if (to.kind === "current" && !current.available) return { ok: false, code: "no_current_text" };
  return { ok: true, from, to };
}

/**
 * Текст редакции при утверждении: один повтор, потом `log` и `null` —
 * утверждение проходит без текста (как раньше), но не молча.
 */
export async function readSnapshotWithRetry<T>(read: () => Promise<T>, log: (error: unknown) => void): Promise<T | null> {
  try {
    return await read();
  } catch {
    // Второй раз — сбои чтения файла или базы бывают разовыми.
  }
  try {
    return await read();
  } catch (error) {
    log(error);
    return null;
  }
}
