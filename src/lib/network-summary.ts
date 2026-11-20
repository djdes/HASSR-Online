/**
 * «Сеть» — сводка по организациям аккаунта для его владельца (серия D, Р4).
 * Чистые функции: статусы, итоги, строки таблицы и правило пункта меню.
 * Данные собирает `network-summary.server.ts`.
 */

import { formatDate, formatNumber, type Locale } from "@/i18n/locales";
import type { MonitoringMetric } from "@/lib/monitoring";
import type { PaidTier } from "@/lib/tariff-plans";

/** Больше организаций на странице не считаем: журналы — запросы на каждую. */
export const NETWORK_ORG_LIMIT = 50;
/** Сколько организаций считаем одновременно. */
export const NETWORK_CONCURRENCY = 4;
/** Пункт меню и страница — с двух организаций в аккаунте. */
export const NETWORK_MIN_ORGS = 2;

/** Адрес страницы «Сеть». */
export const NETWORK_HREF = "/settings/network";

/**
 * Журналы за сегодня, как на главной («Вся организация»): `done` — все
 * заполнены, `partial` — часть, `none` — ни одного, `empty` — журналов нет,
 * `unknown` — посчитать не удалось.
 */
export type JournalDayStatus = "done" | "partial" | "none" | "empty" | "unknown";

export function journalDayStatus(metric: MonitoringMetric | null): JournalDayStatus {
  if (!metric) return "unknown";
  if (metric.total <= 0) return "empty";
  if (metric.done >= metric.total) return "done";
  if (metric.done <= 0) return "none";
  return "partial";
}

/** Остались незаполненные журналы сегодня. */
export function hasUnfilledJournals(metric: MonitoringMetric | null): boolean {
  return Boolean(metric && metric.total > 0 && metric.done < metric.total);
}

/** Свои 14 дней организации (`org-trial.ts`): в силе до последнего дня, закрыта или нет отметки. */
export type NetworkTrialCell =
  | { state: "trial"; lastDay: Date }
  | { state: "locked" }
  | { state: "none" };

export function networkTrialCell(entry: { status: "trial" | "locked"; trialEndsAt: Date } | null | undefined): NetworkTrialCell {
  if (!entry) return { state: "none" };
  if (entry.status === "locked") return { state: "locked" };
  // Конец не включительно: последний бесплатный день — за миллисекунду до него.
  return { state: "trial", lastDay: new Date(entry.trialEndsAt.getTime() - 1) };
}

/** Тариф аккаунта одной строкой над таблицей. */
export type NetworkPlan =
  | { kind: "paid"; tier: PaidTier; points: number }
  | { kind: "legacy" }
  | { kind: "trial"; lastDay: Date | null }
  | { kind: "free" }
  | { kind: "none" };

export function networkPlanOf(
  state: {
    kind: string;
    paidTier: PaidTier | "legacy" | null;
    planPoints: number;
    trialEndsAt: Date | null;
  } | null,
): NetworkPlan {
  if (!state) return { kind: "none" };
  if (state.kind === "paid") {
    if (state.paidTier === "standard" || state.paidTier === "premium" || state.paidTier === "vip") {
      return { kind: "paid", tier: state.paidTier, points: Math.max(1, Math.floor(state.planPoints || 1)) };
    }
    return { kind: "legacy" };
  }
  if (state.kind === "free_period") {
    return { kind: "trial", lastDay: state.trialEndsAt ? new Date(state.trialEndsAt.getTime() - 1) : null };
  }
  if (state.kind === "free" || state.kind === "needs_decision") return { kind: "free" };
  return { kind: "none" };
}

export type NetworkOrgRow = {
  id: string;
  name: string;
  /** Активная организация сессии. */
  current: boolean;
  /** «Сделано / всего» за сегодня; null — посчитать не удалось. */
  journals: MonitoringMetric | null;
  journalStatus: JournalDayStatus;
  balanceRub: number;
  trial: NetworkTrialCell;
  /** Последний обмен справочниками (самый поздний по кабинетам); null — не было. */
  lastExchangeAt: Date | null;
  deletionRequested: boolean;
};

export type NetworkTotals = {
  organizations: number;
  balanceRub: number;
  /** Сколько организаций с незаполненными журналами сегодня. */
  withUnfilled: number;
};

export function buildNetworkRows(input: {
  activeOrgId: string;
  orgs: ReadonlyArray<{ id: string; name: string; balanceRub: number; deletionRequested: boolean }>;
  journals: ReadonlyMap<string, MonitoringMetric | null>;
  trials: ReadonlyArray<{ organizationId: string; status: "trial" | "locked"; trialEndsAt: Date }>;
  exchanges: ReadonlyArray<{ organizationId: string; lastSyncedAt: Date | null }>;
}): NetworkOrgRow[] {
  const trialByOrg = new Map(input.trials.map((entry) => [entry.organizationId, entry]));
  const lastExchange = latestByOrganization(input.exchanges);
  return input.orgs.map((org) => {
    const journals = input.journals.get(org.id) ?? null;
    return {
      id: org.id,
      name: org.name,
      current: org.id === input.activeOrgId,
      journals,
      journalStatus: journalDayStatus(journals),
      balanceRub: Number.isFinite(org.balanceRub) ? org.balanceRub : 0,
      trial: networkTrialCell(trialByOrg.get(org.id)),
      lastExchangeAt: lastExchange.get(org.id) ?? null,
      deletionRequested: org.deletionRequested,
    };
  });
}

/** Самая поздняя дата по организации (организация бывает в нескольких кабинетах). */
export function latestByOrganization(
  rows: ReadonlyArray<{ organizationId: string; lastSyncedAt: Date | null }>,
): Map<string, Date> {
  const latest = new Map<string, Date>();
  for (const row of rows) {
    if (!row.lastSyncedAt) continue;
    const known = latest.get(row.organizationId);
    if (!known || row.lastSyncedAt.getTime() > known.getTime()) latest.set(row.organizationId, row.lastSyncedAt);
  }
  return latest;
}

export function networkTotals(rows: ReadonlyArray<Pick<NetworkOrgRow, "balanceRub" | "journals">>): NetworkTotals {
  return {
    organizations: rows.length,
    balanceRub: rows.reduce((sum, row) => sum + row.balanceRub, 0),
    withUnfilled: rows.filter((row) => hasUnfilledJournals(row.journals)).length,
  };
}

/**
 * Пункт меню «Сеть» и страница: полный доступ, не «войти как» (чужая сеть),
 * не руководитель точки, владелец аккаунта активной организации и в аккаунте
 * две рабочие организации и больше (без демо и мастер-кабинетов).
 */
export function isNetworkViewer(input: {
  fullAccess: boolean;
  impersonating: boolean;
  pointScoped: boolean;
}): boolean {
  return input.fullAccess && !input.impersonating && !input.pointScoped;
}

export function isNetworkOwner(input: {
  userId: string;
  ownerUserId: string | null | undefined;
  organizations: number;
}): boolean {
  return Boolean(input.ownerUserId) && input.ownerUserId === input.userId && input.organizations >= NETWORK_MIN_ORGS;
}

/** «23 ноября» — день по Москве, как сроки тарифа. */
export function formatNetworkDay(date: Date, locale: Locale): string {
  return formatDate(locale, date, "Europe/Moscow", { day: "numeric", month: "long" });
}

/** «20 ноября, 14:05» — день и время по Москве. */
export function formatNetworkDateTime(date: Date, locale: Locale): string {
  return formatDate(locale, date, "Europe/Moscow", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

/** «12 345 ₽» — как баланс в «Балансе и бонусах». */
export function formatNetworkRub(value: number, locale: Locale): string {
  return `${formatNumber(locale, value)}\u00a0₽`;
}
