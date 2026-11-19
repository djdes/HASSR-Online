import { EXCHANGE_KINDS, emptyKindRecord, type ExchangeKind } from "@/lib/directory-exchange/kinds";

/**
 * Итог обмена справочниками (и разового переноса) — что получила каждая
 * организация по каждому списку. Чистый модуль: его типы читают и сервер,
 * и окно «Связать или перенести».
 */

export type ExchangeCounters = {
  /** Появилось новых записей. */
  created: number;
  /** Обновлено по правке другого участника. */
  updated: number;
  /** Не добавлено из-за тарифа: места сотрудников или точки. */
  skippedLimit: number;
  /** Не добавлено или не обновлено: такое название уже занято. */
  skippedConflict: number;
};

export type ExchangeSummaryOrganization = {
  organizationId: string;
  name: string;
  kinds: Record<ExchangeKind, ExchangeCounters>;
};

export type ExchangeSummary = {
  organizations: ExchangeSummaryOrganization[];
  /** Пояснения для человека: кто не участвовал и почему. */
  notes: string[];
};

export function emptyCounters(): ExchangeCounters {
  return { created: 0, updated: 0, skippedLimit: 0, skippedConflict: 0 };
}

export function emptyKindCounters(): Record<ExchangeKind, ExchangeCounters> {
  return emptyKindRecord(emptyCounters);
}

export function emptySummary(): ExchangeSummary {
  return { organizations: [], notes: [] };
}

/** Сумма счётчиков по всем организациям и спискам. */
export function summaryTotals(summary: ExchangeSummary): ExchangeCounters {
  const total = emptyCounters();
  for (const organization of summary.organizations) {
    for (const kind of EXCHANGE_KINDS) {
      const counters = organization.kinds[kind];
      total.created += counters.created;
      total.updated += counters.updated;
      total.skippedLimit += counters.skippedLimit;
      total.skippedConflict += counters.skippedConflict;
    }
  }
  return total;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** Итог из `DirectoryExchangeMember.lastSyncJson`; мусор и пустое — null. */
export function parseExchangeSummary(raw: unknown): ExchangeSummary | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as { organizations?: unknown; notes?: unknown };
  if (!Array.isArray(source.organizations)) return null;
  const organizations: ExchangeSummaryOrganization[] = [];
  for (const entry of source.organizations) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as { organizationId?: unknown; name?: unknown; kinds?: unknown };
    if (typeof item.organizationId !== "string") continue;
    const kinds = emptyKindCounters();
    const given = item.kinds && typeof item.kinds === "object" ? (item.kinds as Record<string, unknown>) : {};
    for (const kind of EXCHANGE_KINDS) {
      const counters = (given[kind] ?? {}) as Record<string, unknown>;
      kinds[kind] = {
        created: count(counters.created),
        updated: count(counters.updated),
        skippedLimit: count(counters.skippedLimit),
        skippedConflict: count(counters.skippedConflict),
      };
    }
    organizations.push({ organizationId: item.organizationId, name: typeof item.name === "string" ? item.name : "", kinds });
  }
  const notes = Array.isArray(source.notes) ? source.notes.filter((note): note is string => typeof note === "string") : [];
  return { organizations, notes };
}
