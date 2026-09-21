import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

/**
 * Прочитать и переписать конфиг документа журнала под блокировкой строки
 * (`SELECT … FOR UPDATE`). Все серверные «прочитал → поменял → записал»
 * бракеражных журналов идут через него: QR-добавление, подписи комиссии,
 * сохранение с сайта. Без блокировки два одновременных QR-сохранения
 * теряли одно из них.
 *
 * Запись — `update`, а не `updateMany`: хуки `db.ts` (перенос полей шапки,
 * живые события) срабатывают только на нём.
 */
export type LockedDocument = {
  id: string;
  organizationId: string;
  config: Prisma.JsonValue;
  status: string;
  verifierUserId: string | null;
  responsibleUserId: string | null;
  templateCode: string;
};

export async function withDocumentConfigLock<T>(
  documentId: string,
  mutate: (
    doc: LockedDocument,
    tx: Prisma.TransactionClient
  ) => Promise<{ config?: Prisma.InputJsonValue; data?: Prisma.JournalDocumentUpdateInput; result: T } | null>
): Promise<T | null> {
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "JournalDocument" WHERE id = ${documentId} FOR UPDATE`;
      const doc = await tx.journalDocument.findUnique({
        where: { id: documentId },
        select: {
          id: true,
          organizationId: true,
          config: true,
          status: true,
          verifierUserId: true,
          responsibleUserId: true,
          template: { select: { code: true } },
        },
      });
      if (!doc) return null;
      const out = await mutate(
        {
          id: doc.id,
          organizationId: doc.organizationId,
          config: doc.config,
          status: doc.status,
          verifierUserId: doc.verifierUserId,
          responsibleUserId: doc.responsibleUserId,
          templateCode: doc.template.code,
        },
        tx
      );
      if (!out) return null;
      if (out.config !== undefined || out.data) {
        await tx.journalDocument.update({
          where: { id: documentId },
          data: { ...(out.data ?? {}), ...(out.config !== undefined ? { config: out.config } : {}) },
        });
      }
      return out.result;
    },
    { timeout: 15_000 }
  );
}
