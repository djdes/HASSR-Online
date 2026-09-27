import { db } from "@/lib/db";
import { NOT_AUTO_SEEDED } from "@/lib/journal-entry-filters";
import { sortJournalsByName } from "@/lib/journal-sort";
import { periodBounds } from "@/lib/inspector-qr";
import type { InspectorAccess } from "@/lib/inspector-access";

/**
 * Сводка журналов для проверяющего за период: включённые журналы
 * организации, сгруппированные «СанПиН / ХАССП / прочие», у каждого —
 * число документов, пересекающихся с периодом, и записей за период.
 *
 * Считаются только реально заполненные строки: `_autoSeeded`-заглушки
 * (пустая сетка сотрудник × день) записями не являются.
 */
export type InspectorJournalRow = {
  id: string;
  code: string;
  name: string;
  isMandatorySanpin: boolean;
  isMandatoryHaccp: boolean;
  docCount: number;
  entryCount: number;
};

export type InspectorJournalGroup = {
  key: "sanpin" | "haccp" | "other";
  label: string;
  rows: InspectorJournalRow[];
};

export async function loadInspectorJournals(
  access: InspectorAccess,
  from: string,
  to: string
): Promise<InspectorJournalGroup[]> {
  const bounds = periodBounds(from, to);
  const orgId = access.token.organizationId;

  const [templatesAll, documents, legacy] = await Promise.all([
    db.journalTemplate.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, code: true, name: true, isMandatorySanpin: true, isMandatoryHaccp: true },
    }),
    db.journalDocument.findMany({
      where: {
        organizationId: orgId,
        dateFrom: { lte: bounds.lte },
        dateTo: { gte: bounds.gte },
      },
      select: { id: true, templateId: true },
    }),
    db.journalEntry.groupBy({
      by: ["templateId"],
      where: { organizationId: orgId, createdAt: bounds },
      _count: { _all: true },
    }),
  ]);

  const entryCounts = documents.length
    ? await db.journalDocumentEntry.groupBy({
        by: ["documentId"],
        where: {
          documentId: { in: documents.map((d) => d.id) },
          date: bounds,
          ...NOT_AUTO_SEEDED,
        },
        _count: { _all: true },
      })
    : [];
  const entriesByDoc = new Map(entryCounts.map((r) => [r.documentId, r._count._all]));

  const docCount = new Map<string, number>();
  const entryCount = new Map<string, number>();
  for (const d of documents) {
    docCount.set(d.templateId, (docCount.get(d.templateId) ?? 0) + 1);
    entryCount.set(d.templateId, (entryCount.get(d.templateId) ?? 0) + (entriesByDoc.get(d.id) ?? 0));
  }
  for (const r of legacy) {
    entryCount.set(r.templateId, (entryCount.get(r.templateId) ?? 0) + r._count._all);
  }

  const groups: InspectorJournalGroup[] = [
    { key: "sanpin", label: "Обязательные по СанПиН", rows: [] },
    { key: "haccp", label: "Система ХАССП", rows: [] },
    { key: "other", label: "Прочие журналы", rows: [] },
  ];
  // Внутри каждой группы — по алфавиту (у проверяющего официальные названия).
  for (const t of sortJournalsByName(templatesAll, (tpl) => tpl.name)) {
    if (access.disabledCodes.has(t.code)) continue;
    const row: InspectorJournalRow = {
      ...t,
      docCount: docCount.get(t.id) ?? 0,
      entryCount: entryCount.get(t.id) ?? 0,
    };
    const group = t.isMandatorySanpin ? groups[0] : t.isMandatoryHaccp ? groups[1] : groups[2];
    group.rows.push(row);
  }
  return groups.filter((g) => g.rows.length > 0);
}
