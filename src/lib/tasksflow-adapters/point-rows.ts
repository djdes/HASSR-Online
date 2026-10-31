import { buildingTargets } from "@/lib/building-targets";
import { db } from "@/lib/db";
import { makeDocumentPointFilter } from "@/lib/worker-point-scope";

import type { AdapterDocument, AdapterRow, JournalAdapter } from "./types";

/**
 * Строки адаптеров TasksFlow у документа точки — только сотрудники этой
 * точки (аудит 2026-10-31: «Отправить всем» слало «Гигиена · Точка 2» всем
 * сотрудникам организации). Адаптеры собирают строки по всем сотрудникам;
 * фильтр стоит в реестре, поэтому действует для всех потребителей: рассылка,
 * каталог журналов TF, привязка строки, строки QR и Max.
 *
 * Строки без исполнителя остаются. Общий документ (без точки) и выключенные
 * точки — без изменений. Правило «работает на точке» — `worksAtBuilding`.
 */
export function rowsForDocumentPoint(
  rows: ReadonlyArray<AdapterRow>,
  atPoint: (userId: string) => boolean,
): AdapterRow[] {
  return rows.filter((row) => !row.responsibleUserId || atPoint(row.responsibleUserId));
}

export async function scopeAdapterDocumentsToPoints(
  organizationId: string,
  documents: AdapterDocument[],
): Promise<AdapterDocument[]> {
  if (documents.length === 0) return documents;
  const targets = await buildingTargets(organizationId);
  if (!targets.some(Boolean)) return documents;
  const userIds = [
    ...new Set(documents.flatMap((doc) => doc.rows.map((row) => row.responsibleUserId).filter((id): id is string => Boolean(id)))),
  ];
  if (userIds.length === 0) return documents;
  const [docPoints, users] = await Promise.all([
    db.journalDocument.findMany({
      where: { id: { in: documents.map((doc) => doc.documentId) } },
      select: { id: true, buildingId: true },
    }),
    db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, buildingIds: true } }),
  ]);
  const pointByDoc = new Map(docPoints.map((doc) => [doc.id, doc.buildingId]));
  const buildingIdsByUser = new Map(users.map((user) => [user.id, user.buildingIds]));
  return documents.map((doc) => {
    const atPoint = makeDocumentPointFilter({ targets, documentBuildingId: pointByDoc.get(doc.documentId), buildingIdsByUser });
    const rows = rowsForDocumentPoint(doc.rows, atPoint);
    return rows.length === doc.rows.length ? doc : { ...doc, rows };
  });
}

const scoped = new WeakMap<JournalAdapter, JournalAdapter>();

/** Адаптер, у которого `listDocumentsForOrg` отдаёт строки точки документа. */
export function withPointRows(adapter: JournalAdapter): JournalAdapter {
  const cached = scoped.get(adapter);
  if (cached) return cached;
  const wrapped: JournalAdapter = {
    ...adapter,
    async listDocumentsForOrg(organizationId) {
      return scopeAdapterDocumentsToPoints(organizationId, await adapter.listDocumentsForOrg(organizationId));
    },
  };
  scoped.set(adapter, wrapped);
  return wrapped;
}
