/**
 * «Сеть» за период (серия E, Р6): по организации — сколько дней обязательные
 * журналы были заполнены и сколько записей журналов сделано. Чистые функции:
 * период из адреса, дни периода, сборка дней из записей и итоги. Данные
 * собирает `network-period.server.ts`.
 *
 * Правило дня (дешёвое, по записям, без пересчёта «Сегодня» за каждый день):
 * обязательные журналы дня — включённые ежедневные журналы организации, у
 * которых на этот день есть документ; день заполнен, если в каждом из них
 * есть хоть одна запись за день или день закрыт («Не требуется сегодня»,
 * «Завершить смену»). Считаются только дни, когда организация уже была и не
 * была закрыта после своих 14 дней.
 */

export const NETWORK_PERIODS = ["today", "7", "30"] as const;
export type NetworkPeriod = (typeof NETWORK_PERIODS)[number];
export type NetworkPeriodDays = 7 | 30;

/** `?period=7|30` — иначе «Сегодня». */
export function parseNetworkPeriod(raw: unknown): NetworkPeriod {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "7" || value === "30" ? value : "today";
}

export function networkPeriodDays(period: NetworkPeriod): NetworkPeriodDays | null {
  return period === "7" ? 7 : period === "30" ? 30 : null;
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** «2026-11-21» ± n дней. */
export function shiftDayKey(dayKey: string, days: number): string {
  if (!DAY_KEY.test(dayKey)) throw new Error(`Bad day key: ${dayKey}`);
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Дни периода — `days` полных дней до сегодняшнего (сегодня не входит: день
 * ещё идёт, и доля падала бы каждое утро), по возрастанию.
 */
export function periodDayKeys(todayKey: string, days: number): string[] {
  const count = Math.max(0, Math.floor(days));
  const keys: string[] = [];
  for (let offset = count; offset >= 1; offset -= 1) keys.push(shiftDayKey(todayKey, -offset));
  return keys;
}

/** Дни от `fromKey` до `toKey` включительно, пересечённые с днями периода. */
function coveredKeys(dayKeys: readonly string[], fromKey: string, toKey: string): string[] {
  return dayKeys.filter((key) => key >= fromKey && key <= toKey);
}

export type PeriodDayData = {
  /** День → обязательные журналы (id шаблонов), у которых на этот день есть документ. */
  mandatoryByDay: Map<string, Set<string>>;
  /** День → журналы с записью или закрытием дня. */
  filledByDay: Map<string, Set<string>>;
  /** День → записей журналов (всех, не только обязательных). */
  recordsByDay: Map<string, number>;
};

/**
 * Дни периода из сырых строк: документы (с какого по какой день), записи
 * по дням и закрытые дни. Записи и закрытия вне периода не считаются.
 */
export function buildPeriodDays(input: {
  dayKeys: readonly string[];
  /** Включённые ежедневные журналы организации. */
  mandatoryTemplateIds: ReadonlySet<string>;
  documents: ReadonlyArray<{ templateId: string; fromKey: string; toKey: string }>;
  marks: ReadonlyArray<{ templateId: string; dayKey: string; count: number }>;
  closures: ReadonlyArray<{ templateId: string; dayKey: string }>;
}): PeriodDayData {
  const inPeriod = new Set(input.dayKeys);
  const mandatoryByDay = new Map<string, Set<string>>();
  const filledByDay = new Map<string, Set<string>>();
  const recordsByDay = new Map<string, number>();
  const add = (map: Map<string, Set<string>>, dayKey: string, templateId: string) => {
    const set = map.get(dayKey) ?? new Set<string>();
    set.add(templateId);
    map.set(dayKey, set);
  };

  for (const doc of input.documents) {
    if (!input.mandatoryTemplateIds.has(doc.templateId)) continue;
    for (const dayKey of coveredKeys(input.dayKeys, doc.fromKey, doc.toKey)) add(mandatoryByDay, dayKey, doc.templateId);
  }
  for (const mark of input.marks) {
    if (!inPeriod.has(mark.dayKey) || !(mark.count > 0)) continue;
    add(filledByDay, mark.dayKey, mark.templateId);
    recordsByDay.set(mark.dayKey, (recordsByDay.get(mark.dayKey) ?? 0) + Math.floor(mark.count));
  }
  for (const closure of input.closures) {
    if (inPeriod.has(closure.dayKey)) add(filledByDay, closure.dayKey, closure.templateId);
  }
  return { mandatoryByDay, filledByDay, recordsByDay };
}

export type PeriodOrgStats = {
  /** Дни периода, когда организация уже была и не была закрыта. */
  days: number;
  /** Из них — дни, когда все обязательные журналы заполнены. */
  filledDays: number;
  /** Из них — дни, когда обязательные журналы вообще были (есть документ). */
  keptDays: number;
  /** Записей журналов за эти дни. */
  records: number;
};

/**
 * Итог организации за период. `createdDayKey` — день создания (входит),
 * `lockedFromDayKey` — первый день закрытия после своих 14 дней (с него не
 * считаем); null — не закрыта.
 */
export function periodOrgStats(input: {
  dayKeys: readonly string[];
  createdDayKey: string;
  lockedFromDayKey: string | null;
  data: PeriodDayData;
}): PeriodOrgStats {
  let days = 0;
  let filledDays = 0;
  let keptDays = 0;
  let records = 0;
  for (const dayKey of input.dayKeys) {
    if (dayKey < input.createdDayKey) continue;
    if (input.lockedFromDayKey !== null && dayKey >= input.lockedFromDayKey) continue;
    days += 1;
    records += input.data.recordsByDay.get(dayKey) ?? 0;
    const mandatory = input.data.mandatoryByDay.get(dayKey);
    if (!mandatory || mandatory.size === 0) continue;
    keptDays += 1;
    const filled = input.data.filledByDay.get(dayKey);
    if ([...mandatory].every((templateId) => filled?.has(templateId))) filledDays += 1;
  }
  return { days, filledDays, keptDays, records };
}

/**
 * Статус строки: `done` — каждый день, `partial` — не каждый, `none` — ни
 * одного дня, `empty` — обязательных журналов не было (или дней), `unknown` —
 * посчитать не удалось.
 */
export type PeriodStatus = "done" | "partial" | "none" | "empty" | "unknown";

export function periodStatus(stats: PeriodOrgStats | null): PeriodStatus {
  if (!stats) return "unknown";
  if (stats.days <= 0 || stats.keptDays <= 0) return "empty";
  if (stats.filledDays >= stats.days) return "done";
  if (stats.filledDays <= 0) return "none";
  return "partial";
}

/** Доля дней с заполненными журналами, 0–100 (целое); дней нет — null. */
export function periodPercent(stats: Pick<PeriodOrgStats, "days" | "filledDays"> | null): number | null {
  if (!stats || stats.days <= 0) return null;
  return Math.round((Math.min(stats.filledDays, stats.days) / stats.days) * 100);
}

export type NetworkPeriodRow = {
  id: string;
  name: string;
  current: boolean;
  deletionRequested: boolean;
  /** null — посчитать не удалось. */
  stats: PeriodOrgStats | null;
  status: PeriodStatus;
};

export type NetworkPeriodTotals = {
  organizations: number;
  days: number;
  filledDays: number;
  records: number;
};

export function networkPeriodTotals(rows: ReadonlyArray<Pick<NetworkPeriodRow, "stats">>): NetworkPeriodTotals {
  const totals: NetworkPeriodTotals = { organizations: rows.length, days: 0, filledDays: 0, records: 0 };
  for (const row of rows) {
    if (!row.stats) continue;
    totals.days += row.stats.days;
    totals.filledDays += row.stats.filledDays;
    totals.records += row.stats.records;
  }
  return totals;
}
