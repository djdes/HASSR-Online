import { loadBillingUnit } from "@/lib/billing.server";
import { runWithConcurrency } from "@/lib/bounded-concurrency";
import { db } from "@/lib/db";
import { CONFIG_DAILY_CODES, DAILY_JOURNAL_CODES } from "@/lib/daily-journal-codes";
import { parseDisabledCodes } from "@/lib/disabled-journals";
import { NOT_AUTO_SEEDED } from "@/lib/journal-entry-filters";
import { networkOrgWhere } from "@/lib/network-access.server";
import {
  buildPeriodDays,
  networkPeriodTotals,
  periodDayKeys,
  periodOrgStats,
  periodStatus,
  type NetworkPeriodDays,
  type NetworkPeriodRow,
  type NetworkPeriodTotals,
  type PeriodOrgStats,
} from "@/lib/network-period";
import { NETWORK_CONCURRENCY, NETWORK_ORG_LIMIT } from "@/lib/network-summary";
import { orgTodayKey } from "@/lib/timezone";
import { rollupConfigDocumentForDay } from "@/lib/today-compliance";

/**
 * «Сеть» за 7 или 30 дней (серия E, Р6): по каждой рабочей организации
 * аккаунта — дни с заполненными обязательными журналами и записи журналов
 * (правило — в `network-period.ts`). Дёшево: на организацию пять запросов за
 * весь период (документы, отметки ежедневных журналов в документе, записи по
 * дням, записи старых журналов, закрытые дни), не больше `NETWORK_ORG_LIMIT`
 * организаций и `NETWORK_CONCURRENCY` одновременно. Доступ проверяет
 * вызывающий (страница «Сеть», выгрузка).
 */

export type NetworkPeriodSummary = {
  accountId: string;
  days: NetworkPeriodDays;
  rows: NetworkPeriodRow[];
  totals: NetworkPeriodTotals;
  /** Первый и последний день периода по Москве (для шапки и выгрузки). */
  range: { from: string; to: string };
  truncated: boolean;
  generatedAt: Date;
};

const DEFAULT_TZ = "Europe/Moscow";
const MANDATORY_CODES = new Set([...DAILY_JOURNAL_CODES, ...CONFIG_DAILY_CODES]);
const HOUR_MS = 3_600_000;
const dayKeyOf = (date: Date) => date.toISOString().slice(0, 10);
const utcDay = (dayKey: string) => new Date(`${dayKey}T00:00:00.000Z`);

type PeriodOrg = {
  id: string;
  name: string;
  timezone: string | null;
  createdAt: Date;
  disabledJournalCodes: unknown;
  deletionRequestedAt: Date | null;
};

/** Закрытые после своих 14 дней организации аккаунта → первый закрытый день (по Москве). */
async function lockedFromDays(anyOrganizationId: string, now: Date): Promise<Map<string, string>> {
  const unit = await loadBillingUnit(anyOrganizationId, { now }).catch((error) => {
    console.error("[network-period] billing load failed", error);
    return null;
  });
  const locked = new Map<string, string>();
  for (const entry of unit?.orgTrials ?? []) {
    if (entry.status === "locked") locked.set(entry.organizationId, orgTodayKey(DEFAULT_TZ, entry.trialEndsAt));
  }
  return locked;
}

async function orgPeriodStats(input: {
  org: PeriodOrg;
  days: number;
  now: Date;
  templates: ReadonlyArray<{ id: string; code: string }>;
  lockedFromDayKey: string | null;
}): Promise<PeriodOrgStats> {
  const { org } = input;
  const timeZone = org.timezone || DEFAULT_TZ;
  const todayKey = orgTodayKey(timeZone, input.now);
  const dayKeys = periodDayKeys(todayKey, input.days);
  if (dayKeys.length === 0) return { days: 0, filledDays: 0, keptDays: 0, records: 0 };
  const from = utcDay(dayKeys[0]);
  const to = utcDay(todayKey);
  const disabled = parseDisabledCodes(org.disabledJournalCodes);
  const codeById = new Map(input.templates.map((template) => [template.id, template.code]));
  const mandatoryTemplateIds = new Set(
    input.templates.filter((template) => MANDATORY_CODES.has(template.code) && !disabled.has(template.code)).map((template) => template.id),
  );
  const configTemplateIds = input.templates.filter((template) => CONFIG_DAILY_CODES.has(template.code)).map((template) => template.id);

  const [documents, configDocuments, entryCounts, legacyEntries, closures] = await Promise.all([
    db.journalDocument.findMany({
      where: { organizationId: org.id, dateFrom: { lt: to }, dateTo: { gte: from } },
      select: { templateId: true, dateFrom: true, dateTo: true },
    }),
    // Ежедневные журналы, которые держат отметки в самом документе (уборка, бракераж).
    configTemplateIds.length
      ? db.journalDocument.findMany({
          where: { organizationId: org.id, templateId: { in: configTemplateIds }, dateFrom: { lt: to }, dateTo: { gte: from } },
          select: { templateId: true, dateFrom: true, dateTo: true, config: true },
        })
      : Promise.resolve([]),
    db.journalDocumentEntry.groupBy({
      by: ["documentId", "date"],
      where: { document: { organizationId: org.id }, date: { gte: from, lt: to }, ...NOT_AUTO_SEEDED },
      _count: { _all: true },
    }),
    // Старые журналы: день записи — по часовому поясу организации, поэтому
    // окно с запасом в обе стороны, лишнее отсекает период.
    db.journalEntry.findMany({
      where: { organizationId: org.id, createdAt: { gte: new Date(from.getTime() - 15 * HOUR_MS), lt: new Date(to.getTime() + 15 * HOUR_MS) } },
      select: { templateId: true, createdAt: true },
    }),
    db.journalCloseEvent.findMany({
      where: { organizationId: org.id, date: { gte: from, lt: to }, reopenedAt: null },
      select: { templateId: true, date: true },
    }),
  ]);

  const documentTemplate = new Map<string, string>();
  const documentIds = [...new Set(entryCounts.map((row) => row.documentId))];
  if (documentIds.length) {
    const rows = await db.journalDocument.findMany({ where: { id: { in: documentIds } }, select: { id: true, templateId: true } });
    for (const row of rows) documentTemplate.set(row.id, row.templateId);
  }

  const marks: Array<{ templateId: string; dayKey: string; count: number }> = [];
  for (const row of entryCounts) {
    const templateId = documentTemplate.get(row.documentId);
    if (templateId) marks.push({ templateId, dayKey: dayKeyOf(row.date), count: row._count._all });
  }
  for (const entry of legacyEntries) {
    marks.push({ templateId: entry.templateId, dayKey: orgTodayKey(timeZone, entry.createdAt), count: 1 });
  }
  for (const doc of configDocuments) {
    const code = codeById.get(doc.templateId);
    if (!code) continue;
    const fromKey = dayKeyOf(doc.dateFrom);
    const toKey = dayKeyOf(doc.dateTo);
    for (const dayKey of dayKeys) {
      if (dayKey < fromKey || dayKey > toKey) continue;
      const count = rollupConfigDocumentForDay(code, doc.config, dayKey)?.todayCount ?? 0;
      if (count > 0) marks.push({ templateId: doc.templateId, dayKey, count });
    }
  }

  const data = buildPeriodDays({
    dayKeys,
    mandatoryTemplateIds,
    documents: documents.map((doc) => ({ templateId: doc.templateId, fromKey: dayKeyOf(doc.dateFrom), toKey: dayKeyOf(doc.dateTo) })),
    marks,
    closures: closures.map((closure) => ({ templateId: closure.templateId, dayKey: dayKeyOf(closure.date) })),
  });
  return periodOrgStats({
    dayKeys,
    createdDayKey: orgTodayKey(timeZone, org.createdAt),
    lockedFromDayKey: input.lockedFromDayKey,
    data,
  });
}

/** Сводка по организациям аккаунта за `days` полных дней до сегодняшнего. */
export async function loadNetworkPeriod(
  accountId: string,
  days: NetworkPeriodDays,
  options: { now?: Date; activeOrgId?: string | null } = {},
): Promise<NetworkPeriodSummary> {
  const now = options.now ?? new Date();
  const found = await db.organization.findMany({
    where: networkOrgWhere(accountId),
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: NETWORK_ORG_LIMIT + 1,
    select: { id: true, name: true, timezone: true, createdAt: true, disabledJournalCodes: true, deletionRequestedAt: true },
  });
  const truncated = found.length > NETWORK_ORG_LIMIT;
  const orgs = found.slice(0, NETWORK_ORG_LIMIT);
  const todayKey = orgTodayKey(DEFAULT_TZ, now);
  const keys = periodDayKeys(todayKey, days);
  const range = { from: keys[0] ?? todayKey, to: keys[keys.length - 1] ?? todayKey };
  if (orgs.length === 0) {
    return { accountId, days, rows: [], totals: networkPeriodTotals([]), range, truncated, generatedAt: now };
  }

  const [templates, locked] = await Promise.all([
    db.journalTemplate.findMany({ where: { isActive: true }, select: { id: true, code: true } }),
    lockedFromDays(orgs[0].id, now),
  ]);
  const counted = await runWithConcurrency(orgs, NETWORK_CONCURRENCY, (org) =>
    orgPeriodStats({ org, days, now, templates, lockedFromDayKey: locked.get(org.id) ?? null }),
  );
  const rows: NetworkPeriodRow[] = orgs.map((org, index) => {
    const result = counted[index];
    if (!result.ok) console.error("[network-period] org count failed", { organizationId: org.id, error: result.error });
    const stats = result.ok ? result.value : null;
    return {
      id: org.id,
      name: org.name,
      current: org.id === options.activeOrgId,
      deletionRequested: org.deletionRequestedAt !== null,
      stats,
      status: periodStatus(stats),
    };
  });
  return { accountId, days, rows, totals: networkPeriodTotals(rows), range, truncated, generatedAt: now };
}
