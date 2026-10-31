/**
 * Загрузка входящих УПД из Диадока и СБИС — без БД: что есть и куда
 * сохранить, передаёт вызывающий (`sync.server.ts`). Так обход страниц,
 * пропуск уже загруженных и отношение к битым файлам проверяются тестами
 * на подменённых клиентах.
 *
 * Битый или не-УПД файл не останавливает загрузку остальных: он считается
 * в `failed`, а ошибка входа или сети — прерывает (её покажут в настройках).
 */
import type { DiadocClient } from "./diadoc";
import { isUpdDocument } from "./diadoc";
import type { SabyIncomingApi } from "./saby-incoming";
import { pickUpdAttachment } from "./saby-incoming";
import { parseUpd, UpdParseError, type ParsedUpd } from "./upd";

/** Больше страниц за один заход не листаем: остальное — в следующий раз. */
export const MAX_SYNC_PAGES = 10;

export type SyncCounters = { created: number; skipped: number; failed: number };

export type SyncSink = {
  /** Уже загружен ли документ с таким внешним id. */
  exists(externalId: string): Promise<boolean>;
  save(input: { externalId: string; parsed: ParsedUpd; fileName: string | null }): Promise<{ created: boolean }>;
};

async function store(
  sink: SyncSink,
  counters: SyncCounters,
  externalId: string,
  fileName: string | null,
  download: () => Promise<Uint8Array>,
): Promise<void> {
  if (await sink.exists(externalId)) {
    counters.skipped += 1;
    return;
  }
  let parsed: ParsedUpd;
  try {
    parsed = parseUpd(await download());
  } catch (error) {
    if (error instanceof UpdParseError) {
      counters.failed += 1;
      return;
    }
    throw error;
  }
  const saved = await sink.save({ externalId, parsed, fileName });
  if (saved.created) counters.created += 1;
  else counters.skipped += 1;
}

/** Диадок: входящие ящика с `fromDate`, только УПД. Внешний id — `messageId:entityId`. */
export async function syncDiadocDocuments(input: {
  client: Pick<DiadocClient, "listIncoming" | "downloadContent">;
  boxId: string;
  fromDate: string;
  sink: SyncSink;
}): Promise<SyncCounters> {
  const counters: SyncCounters = { created: 0, skipped: 0, failed: 0 };
  let after: string | null = null;
  for (let page = 0; page < MAX_SYNC_PAGES; page += 1) {
    const { documents, nextIndexKey } = await input.client.listIncoming(input.boxId, input.fromDate, after);
    for (const doc of documents.filter(isUpdDocument)) {
      await store(input.sink, counters, `${doc.messageId}:${doc.entityId}`, doc.fileName, () =>
        input.client.downloadContent(input.boxId, doc),
      );
    }
    if (!nextIndexKey) break;
    after = nextIndexKey;
  }
  return counters;
}

/** СБИС: входящие документы реализации за период. Внешний id — идентификатор документа. */
export async function syncSabyDocuments(input: {
  api: SabyIncomingApi;
  download: (url: string) => Promise<Uint8Array>;
  fromDate: string;
  toDate: string;
  sink: SyncSink;
}): Promise<SyncCounters> {
  const counters: SyncCounters = { created: 0, skipped: 0, failed: 0 };
  for (let page = 0; page < MAX_SYNC_PAGES; page += 1) {
    const { documents, hasMore } = await input.api.listIncoming(input.fromDate, input.toDate, page);
    for (const doc of documents) {
      if (await input.sink.exists(doc.id)) {
        counters.skipped += 1;
        continue;
      }
      const full = doc.attachments.length > 0 ? doc : await input.api.readDocument(doc.id);
      const attachment = full ? pickUpdAttachment(full.attachments) : null;
      if (!attachment?.url) {
        // Входящий документ реализации без УПД (акт, счёт) — не накладная.
        counters.skipped += 1;
        continue;
      }
      const url = attachment.url;
      await store(input.sink, counters, doc.id, attachment.name, () => input.download(url));
    }
    if (!hasMore) break;
  }
  return counters;
}
