import { db } from "@/lib/db";
import { ByteLru } from "@/lib/byte-lru";
import { generateJournalDocumentPdf } from "@/lib/document-pdf";
import { inspectorControlCode } from "@/lib/inspector-qr";
import { orderScansVersion } from "@/lib/journal-order-scans-db";
import { countPdfPages, renderPdfPageToPng } from "@/lib/journal-preview/render-pages";

/**
 * Листы журнала для проверяющего: PDF той же печатной формы
 * (`generateJournalDocumentPdf`) и его страницы в PNG.
 *
 * Кэш в памяти процесса, ключ — версия содержимого документа: id +
 * `updatedAt` документа + последняя правка записей + их число. Сам
 * `updatedAt` документа при записи в ячейку не меняется — без записей
 * в ключе проверяющий видел бы вчерашние листы. Лимит — по объёму.
 */
const CACHE_BYTES = 128 * 1024 * 1024;

type CachedDoc = {
  pdf: Uint8Array;
  fileName: string;
  pageCount: number;
  pages: Map<number, Buffer>;
};

const cache = new ByteLru<CachedDoc>(CACHE_BYTES);
const inflight = new Map<string, Promise<CachedDoc>>();

function sizeOf(entry: CachedDoc): number {
  let size = entry.pdf.byteLength;
  for (const png of entry.pages.values()) size += png.byteLength;
  return size;
}

export type DocVersion = { key: string; controlCode: string; lastChangeAt: Date };

export async function inspectorDocVersion(doc: { id: string; updatedAt: Date }): Promise<DocVersion> {
  const [agg, owner] = await Promise.all([
    db.journalDocumentEntry.aggregate({
      where: { documentId: doc.id },
      _max: { updatedAt: true },
      _count: { _all: true },
    }),
    db.journalDocument.findUnique({
      where: { id: doc.id },
      select: { organizationId: true, template: { select: { code: true } } },
    }),
  ]);
  const lastEntry = agg._max.updatedAt;
  const parts = [doc.id, doc.updatedAt.toISOString(), lastEntry?.toISOString() ?? "-", String(agg._count._all)];
  // Сканы приказов к журналу печатаются листами после журнала — их правка
  // тоже новая версия. Без приказов ключ (и контрольный код) прежний.
  const scans = owner ? await orderScansVersion(owner.organizationId, owner.template.code) : "-";
  if (scans !== "-" && !scans.startsWith("0:")) parts.push(`orders:${scans}`);
  const lastChangeAt = lastEntry && lastEntry > doc.updatedAt ? lastEntry : doc.updatedAt;
  return { key: parts.join("|"), controlCode: inspectorControlCode(parts), lastChangeAt };
}

async function loadDoc(documentId: string, organizationId: string, version: DocVersion): Promise<CachedDoc> {
  const hit = cache.get(version.key);
  if (hit) return hit;
  const pending = inflight.get(version.key);
  if (pending) return pending;
  const job = (async () => {
    const { buffer, fileName } = await generateJournalDocumentPdf({ documentId, organizationId });
    const pdf = new Uint8Array(buffer);
    const entry: CachedDoc = { pdf, fileName, pageCount: await countPdfPages(pdf), pages: new Map() };
    cache.set(version.key, entry, sizeOf(entry));
    return entry;
  })();
  inflight.set(version.key, job);
  try {
    return await job;
  } finally {
    inflight.delete(version.key);
  }
}

export async function getInspectorDocPdf(
  documentId: string,
  organizationId: string,
  version: DocVersion
): Promise<{ pdf: Uint8Array; fileName: string; pageCount: number }> {
  const entry = await loadDoc(documentId, organizationId, version);
  return { pdf: entry.pdf, fileName: entry.fileName, pageCount: entry.pageCount };
}

/** Лист n (с 1) или null, если такого листа нет. */
export async function getInspectorDocPage(
  documentId: string,
  organizationId: string,
  version: DocVersion,
  pageNumber: number
): Promise<Buffer | null> {
  const entry = await loadDoc(documentId, organizationId, version);
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > entry.pageCount) return null;
  const ready = entry.pages.get(pageNumber);
  if (ready) return ready;
  const sheet = await renderPdfPageToPng(entry.pdf, pageNumber);
  entry.pages.set(pageNumber, sheet.png);
  cache.resize(version.key, sizeOf(entry));
  return sheet.png;
}
