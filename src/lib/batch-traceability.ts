/**
 * Прослеживаемость партии (спека mercury-iiko-acceptance-2026-11-21, Р3):
 * кроме записей журналов — приёмка по ВСД из Меркурия. Чистые функции:
 * страница только читает базу и рисует то, что вернули они.
 */

export type TraceVsdSource = {
  id: string;
  uuid: string;
  number: string | null;
  productName: string | null;
  volume: number | null;
  unit: string | null;
  consignorName: string | null;
  deliveryDate: Date | null;
  processedAt: Date | null;
  firstSeenAt: Date;
  journalDocumentId: string | null;
};

export type TraceVsdRow = {
  id: string;
  /** Номер ВСД, а без номера — начало UUID, как на «Входящих ВСД». */
  number: string;
  product: string | null;
  volume: number | null;
  unit: string | null;
  supplier: string | null;
  date: Date;
  /** Документ журнала приёмки, куда легла строка; null — ссылки нет. */
  journalHref: string | null;
};

/**
 * Ссылка на документ журнала — по коду его шаблона: строка ВСД ложится в
 * тот журнал приёмки, что ведёт организация, и код в адресе должен быть его.
 */
export function acceptanceJournalHref(
  templateCode: string | null | undefined,
  journalDocumentId: string | null | undefined,
): string | null {
  if (!templateCode || !journalDocumentId) return null;
  return `/journals/${encodeURIComponent(templateCode)}/documents/${encodeURIComponent(journalDocumentId)}`;
}

/**
 * Строки «Приёмка по ВСД» в хронологическом порядке. `templateCodeByDocId` —
 * документы журналов своей организации: документ, которого в карте нет
 * (удалён или чужой), ссылки не получает.
 */
export function traceVsdRows(
  vsds: readonly TraceVsdSource[],
  templateCodeByDocId: ReadonlyMap<string, string>,
): TraceVsdRow[] {
  return vsds
    .map((vsd) => ({
      id: vsd.id,
      number: vsd.number?.trim() || vsd.uuid.slice(0, 8),
      product: vsd.productName?.trim() || null,
      volume: vsd.volume,
      unit: vsd.unit?.trim() || null,
      supplier: vsd.consignorName?.trim() || null,
      date: vsd.deliveryDate ?? vsd.processedAt ?? vsd.firstSeenAt,
      journalHref: vsd.journalDocumentId
        ? acceptanceJournalHref(templateCodeByDocId.get(vsd.journalDocumentId), vsd.journalDocumentId)
        : null,
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * Подзаголовок страницы: записи журналов и приёмки по ВСД считаются вместе;
 * одна карточка партии без записей — свой текст, а не «найдено 0 записей».
 */
export function traceSummary(parts: { entries: number; vsd: number; batch: boolean }):
  | { kind: "found"; count: number }
  | { kind: "batchOnly" }
  | { kind: "empty" } {
  const count = parts.entries + parts.vsd;
  if (count > 0) return { kind: "found", count };
  return parts.batch ? { kind: "batchOnly" } : { kind: "empty" };
}
