import { db } from "@/lib/db";
import { NOT_AUTO_SEEDED } from "@/lib/journal-entry-filters";

import { REVIEW_STATS_ACTIVE_DAYS, type ReviewStats } from "./review-stats";

const DAY_MS = 86_400_000;
/** Главная и /pricing открываются часто — считаем не чаще раза в 10 минут. */
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; stats: ReviewStats }>();

/**
 * Цифры для карточек отзывов (только организации, чей автор разрешил).
 * Записи — `JournalEntry` и `JournalDocumentEntry` без пустых
 * автосозданных строк; журналы в работе — шаблоны с записями за 30 дней.
 */
export async function loadReviewStats(organizationIds: string[], now: Date = new Date()): Promise<Map<string, ReviewStats>> {
  const result = new Map<string, ReviewStats>();
  const missing: string[] = [];
  for (const id of new Set(organizationIds)) {
    const hit = cache.get(id);
    if (hit && now.getTime() - hit.at < CACHE_MS) result.set(id, hit.stats);
    else missing.push(id);
  }
  if (missing.length === 0) return result;

  const activeFrom = new Date(now.getTime() - REVIEW_STATS_ACTIVE_DAYS * DAY_MS);
  const [orgs, entryCounts, entryTemplates, documents] = await Promise.all([
    db.organization.findMany({ where: { id: { in: missing } }, select: { id: true, createdAt: true } }),
    db.journalEntry.groupBy({ by: ["organizationId"], _count: { _all: true }, where: { organizationId: { in: missing } } }),
    db.journalEntry.groupBy({
      by: ["organizationId", "templateId"],
      where: { organizationId: { in: missing }, createdAt: { gte: activeFrom } },
    }),
    db.journalDocument.findMany({ where: { organizationId: { in: missing } }, select: { id: true, organizationId: true, templateId: true } }),
  ]);
  const documentIds = documents.map((document) => document.id);
  const [documentEntryCounts, activeDocuments] = documentIds.length
    ? await Promise.all([
        db.journalDocumentEntry.groupBy({ by: ["documentId"], _count: { _all: true }, where: { ...NOT_AUTO_SEEDED, documentId: { in: documentIds } } }),
        db.journalDocumentEntry.groupBy({ by: ["documentId"], where: { ...NOT_AUTO_SEEDED, documentId: { in: documentIds }, createdAt: { gte: activeFrom } } }),
      ])
    : [[], []];

  const records = new Map<string, number>();
  const templates = new Map<string, Set<string>>();
  const addTemplate = (organizationId: string, templateId: string) => {
    const set = templates.get(organizationId) ?? new Set<string>();
    set.add(templateId);
    templates.set(organizationId, set);
  };
  for (const row of entryCounts) records.set(row.organizationId, (records.get(row.organizationId) ?? 0) + row._count._all);
  for (const row of entryTemplates) addTemplate(row.organizationId, row.templateId);
  const documentById = new Map(documents.map((document) => [document.id, document]));
  for (const row of documentEntryCounts) {
    const document = documentById.get(row.documentId);
    if (document) records.set(document.organizationId, (records.get(document.organizationId) ?? 0) + row._count._all);
  }
  for (const row of activeDocuments) {
    const document = documentById.get(row.documentId);
    if (document) addTemplate(document.organizationId, document.templateId);
  }

  for (const org of orgs) {
    const stats: ReviewStats = {
      journals: templates.get(org.id)?.size ?? 0,
      records: records.get(org.id) ?? 0,
      since: org.createdAt.toISOString(),
    };
    cache.set(org.id, { at: now.getTime(), stats });
    result.set(org.id, stats);
  }
  return result;
}
