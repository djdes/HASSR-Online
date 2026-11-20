import { runWithConcurrency } from "@/lib/bounded-concurrency";
import { loadAccountBilling } from "@/lib/billing.server";
import { db } from "@/lib/db";
import { parseDisabledCodes } from "@/lib/disabled-journals";
import { journalMetric, type MonitoringMetric } from "@/lib/monitoring";
import { networkOrgWhere } from "@/lib/network-access.server";
import {
  NETWORK_CONCURRENCY,
  NETWORK_MIN_ORGS,
  NETWORK_ORG_LIMIT,
  buildNetworkRows,
  networkPlanOf,
  networkTotals,
  type NetworkOrgRow,
  type NetworkPlan,
  type NetworkTotals,
} from "@/lib/network-summary";
import { getTemplatesFilledToday } from "@/lib/today-compliance";

/**
 * «Сеть» (серия D, Р4): по каждой организации аккаунта — журналы за сегодня
 * (как на главной при «Вся организация»), баланс, свои 14 дней, последний
 * обмен справочниками. Только владелец аккаунта активной организации, в
 * аккаунте две рабочие организации и больше. Тариф аккаунта читается один
 * раз; журналы — по организации, не больше `NETWORK_CONCURRENCY` сразу и не
 * больше `NETWORK_ORG_LIMIT` организаций.
 */

export type NetworkSummary = {
  accountId: string;
  activeOrganizationId: string;
  plan: NetworkPlan;
  rows: NetworkOrgRow[];
  totals: NetworkTotals;
  /** Организаций больше `NETWORK_ORG_LIMIT` — показаны первые по созданию. */
  truncated: boolean;
  generatedAt: Date;
};

export type NetworkSummaryRefusal = "not_owner" | "single_org";

export class NetworkSummaryAccessError extends Error {
  constructor(readonly code: NetworkSummaryRefusal) {
    super(code === "not_owner" ? "Сводка по сети доступна владельцу аккаунта" : "В аккаунте одна организация");
    this.name = "NetworkSummaryAccessError";
  }
}

/**
 * Данные страницы «Сеть». Не владелец аккаунта активной организации —
 * `NetworkSummaryAccessError("not_owner")`, одна организация — `single_org`.
 * Проверки сессии (полный доступ, «войти как», точка) — на странице.
 */
export async function loadNetworkSummary(input: {
  ownerUserId: string;
  activeOrgId: string;
  now?: Date;
}): Promise<NetworkSummary> {
  const now = input.now ?? new Date();
  const account = await db.account.findUnique({ where: { ownerUserId: input.ownerUserId }, select: { id: true } });
  if (!account) throw new NetworkSummaryAccessError("not_owner");
  const active = await db.organization.findUnique({ where: { id: input.activeOrgId }, select: { accountId: true } });
  if (!active || active.accountId !== account.id) throw new NetworkSummaryAccessError("not_owner");

  const found = await db.organization.findMany({
    where: networkOrgWhere(account.id),
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: NETWORK_ORG_LIMIT + 1,
    select: { id: true, name: true, balanceRub: true, disabledJournalCodes: true, deletionRequestedAt: true },
  });
  if (found.length < NETWORK_MIN_ORGS) throw new NetworkSummaryAccessError("single_org");
  const truncated = found.length > NETWORK_ORG_LIMIT;
  const orgs = found.slice(0, NETWORK_ORG_LIMIT);
  const ids = orgs.map((org) => org.id);

  const [templates, billing, exchanges] = await Promise.all([
    db.journalTemplate.findMany({ where: { isActive: true }, select: { id: true, code: true } }),
    loadAccountBilling(input.activeOrgId, now).catch((error) => {
      console.error("[network] billing load failed", error);
      return null;
    }),
    db.directoryExchangeMember.findMany({
      where: { organizationId: { in: ids }, lastSyncedAt: { not: null } },
      select: { organizationId: true, lastSyncedAt: true },
    }),
  ]);

  // Как на главной при «Вся организация»: набор организации без точки,
  // непериодические журналы без записи сегодня — не заполнены.
  const counted = await runWithConcurrency(orgs, NETWORK_CONCURRENCY, async (org): Promise<MonitoringMetric> => {
    const disabled = parseDisabledCodes(org.disabledJournalCodes);
    const filled = await getTemplatesFilledToday(org.id, now, templates, disabled, {
      treatAperiodicAsFilled: false,
      buildingId: null,
    });
    return journalMetric(templates, disabled, filled);
  });
  const journals = new Map<string, MonitoringMetric | null>();
  counted.forEach((result, index) => {
    if (!result.ok) console.error("[network] journals count failed", { organizationId: ids[index], error: result.error });
    journals.set(ids[index], result.ok ? result.value : null);
  });

  const rows = buildNetworkRows({
    activeOrgId: input.activeOrgId,
    orgs: orgs.map((org) => ({
      id: org.id,
      name: org.name,
      balanceRub: org.balanceRub,
      deletionRequested: org.deletionRequestedAt !== null,
    })),
    journals,
    trials: billing?.unit.orgTrials ?? [],
    exchanges,
  });
  return {
    accountId: account.id,
    activeOrganizationId: input.activeOrgId,
    plan: networkPlanOf(billing?.state ?? null),
    rows,
    totals: networkTotals(rows),
    truncated,
    generatedAt: now,
  };
}
