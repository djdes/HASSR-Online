import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { planPeriodPriceRub, tierForHeadcount, type PaidTier } from "@/lib/tariff-plans";

import { autoAdvance, dealKey, isClosedStage, type DealStage } from "./deals";
import { loadPlatformStaff } from "./people.server";
import { pickAssignee } from "./staff";

/**
 * Сделки воронки CRM (2026-11-10). Сделка — один период решения аккаунта:
 * пробный (с регистрации до конца пробного и отсрочки) или продление (за
 * 30 дней до конца годовой оплаты, за 7 — помесячной без автопродления; не
 * продлилось — сделка появится в отсрочке). `syncDeals` идёт в цикле CRM раз в 5 минут:
 * заводит сделки, ставит «Договор подписан» по ЭДО, закрывает «Оплачено»
 * и «Отказ». «Сообщение отправлено» и «Был прозвон» ставят сценарий,
 * спец-КП и итог задачи (`advanceDealFor`).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Сделка на продление появляется за столько дней до конца оплаты: годовым — за месяц, помесячным — за неделю. */
const RENEWAL_WINDOW_DAYS = { year: 30, month: 7 } as const;

export type DealSyncResult = { created: number; moved: number; won: number; lost: number };

type DealRow = { id: string; kind: string; unitKey: string; stage: string; stageManual: boolean; periodEnd: Date | null; ownerId: string | null; contactId: string | null; contractSignedAt: Date | null };

async function move(deal: DealRow, target: DealStage, extra: Prisma.CrmDealUpdateInput = {}): Promise<boolean> {
  const next = autoAdvance(deal, target);
  // Закрытую сделку («Оплачено», «Отказ») трогает только оплата — без «хвостов» вроде причины отказа.
  if (!next && (isClosedStage(deal.stage) || !Object.keys(extra).length)) return false;
  const now = new Date();
  await db.crmDeal.update({
    where: { id: deal.id },
    data: {
      ...extra,
      ...(next ? { stage: next } : {}),
      ...(next === "won" ? { wonAt: now, lostAt: null, lostReason: null } : {}),
      ...(next === "lost" && !("lostAt" in extra) ? { lostAt: now } : {}),
    },
  });
  if (next) deal.stage = next;
  return Boolean(next);
}

/**
 * Сдвинуть открытую сделку организации (последнюю по сроку): письмо
 * сценария, спец-КП, итог звонка. Нет сделки — ничего.
 */
export async function advanceDealFor(
  where: { dealId?: string | null; organizationIds?: string[] },
  target: DealStage,
  extra: { messageSentAt?: Date; calledAt?: Date; lostReason?: string | null; amountRub?: number | null; offerJson?: Prisma.InputJsonValue } = {},
): Promise<string | null> {
  const deal = where.dealId
    ? await db.crmDeal.findUnique({ where: { id: where.dealId } })
    : where.organizationIds?.length
      ? await db.crmDeal.findFirst({ where: { organizationId: { in: where.organizationIds }, stage: { notIn: ["won", "lost"] } }, orderBy: { periodEnd: "desc" } })
      : null;
  if (!deal) return null;
  const data: Prisma.CrmDealUpdateInput = {};
  if (extra.messageSentAt) data.messageSentAt = extra.messageSentAt;
  if (extra.calledAt) data.calledAt = extra.calledAt;
  if (extra.amountRub !== undefined) data.amountRub = extra.amountRub;
  if (extra.offerJson !== undefined) data.offerJson = extra.offerJson;
  if (target === "lost") {
    data.lostReason = extra.lostReason ?? null;
    data.lostAt = new Date();
  }
  await move(deal, target, data);
  return deal.id;
}

/** Клиент заплатил — открытые сделки его организаций «Оплачено». */
export async function markDealsWon(organizationIds: string[]): Promise<number> {
  if (!organizationIds.length) return 0;
  const deals = await db.crmDeal.findMany({ where: { organizationId: { in: organizationIds }, stage: { not: "won" } } });
  let count = 0;
  for (const deal of deals) {
    // «Отказ» по старому периоду не воскрешаем — только последнюю сделку.
    if (deal.stage === "lost" && deals.some((other) => other.id !== deal.id && (other.periodEnd?.getTime() ?? 0) > (deal.periodEnd?.getTime() ?? 0))) continue;
    if (await move(deal, "won")) count += 1;
  }
  return count;
}

/** Ручной перенос по доске: колонка фиксируется, автоматика дальше её не двигает. */
export async function setDealStage(id: string, stage: DealStage, args: { lostReason?: string | null; ownerId?: string | null } = {}): Promise<void> {
  const now = new Date();
  await db.crmDeal.update({
    where: { id },
    data: {
      stage,
      stageManual: true,
      ...(stage === "won" ? { wonAt: now, lostAt: null, lostReason: null } : {}),
      ...(stage === "lost" ? { lostAt: now, lostReason: args.lostReason?.trim() || null } : { lostReason: null }),
      ...(stage === "called" ? { calledAt: now } : {}),
      ...(args.ownerId !== undefined ? { ownerId: args.ownerId } : {}),
    },
  });
}

type Unit = Awaited<ReturnType<typeof import("@/lib/billing.server").listBillingUnits>>[number];

export async function syncDeals(now: Date = new Date()): Promise<DealSyncResult> {
  const result: DealSyncResult = { created: 0, moved: 0, won: 0, lost: 0 };
  const { listBillingUnits, readTrialSettings, stateForUnit } = await import("@/lib/billing.server");
  const { readLifecycleSettings } = await import("@/lib/crm/tasks.server");
  const { readPlanPricing } = await import("@/lib/tariffs");
  const [units, trialSettings, settings, staff, pricing] = await Promise.all([listBillingUnits(), readTrialSettings(), readLifecycleSettings(), loadPlatformStaff(), readPlanPricing()]);
  if (!settings.enabled) return result;
  const orgIds = units.flatMap((unit) => unit.scopeOrgIds);
  const [deals, orgs, contacts, contracts] = await Promise.all([
    // Открытые и закрытые за 30 дней; более старую сделку того же периода найдёт `dedupeKey` (P2002).
    db.crmDeal.findMany({ where: { OR: [{ stage: { notIn: ["won", "lost"] } }, { updatedAt: { gte: new Date(now.getTime() - 30 * DAY_MS) } }] }, orderBy: { periodEnd: "asc" } }),
    db.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, accountManagerId: true } }),
    db.crmContact.findMany({ where: { organizationId: { in: orgIds } }, orderBy: { lastActivityAt: "desc" }, select: { id: true, organizationId: true } }),
    db.edoDocument.findMany({ where: { organizationId: { in: orgIds }, kind: "contract", stateCode: 7, deletedAt: null }, select: { organizationId: true, updatedAt: true } }),
  ]);
  const manager = new Map(orgs.map((org) => [org.id, org.accountManagerId]));
  const contactOf = new Map<string, string>();
  for (const contact of contacts) if (contact.organizationId && !contactOf.has(contact.organizationId)) contactOf.set(contact.organizationId, contact.id);
  const signedAt = new Map<string, Date>();
  for (const contract of contracts) {
    const prev = signedAt.get(contract.organizationId);
    if (!prev || contract.updatedAt < prev) signedAt.set(contract.organizationId, contract.updatedAt);
  }
  const byUnit = new Map<string, DealRow[]>();
  for (const deal of deals) byUnit.set(deal.unitKey, [...(byUnit.get(deal.unitKey) ?? []), deal]);

  const ensure = async (unit: Unit, kind: "trial" | "renewal", periodEnd: Date, seats: number): Promise<DealRow | null> => {
    const key = dealKey(kind, unit.key, periodEnd);
    const existing = (byUnit.get(unit.key) ?? []).find((deal) => deal.kind === kind && deal.periodEnd?.getTime() === periodEnd.getTime());
    if (existing) return existing;
    const tier: PaidTier = tierForHeadcount(Math.ceil(Math.max(1, seats) / Math.max(1, unit.pointsInUse)));
    const points = Math.max(1, unit.pointsInUse);
    const monthRub = planPeriodPriceRub(pricing.rates, tier, "month", points);
    const accountManager = unit.scopeOrgIds.map((id) => manager.get(id)).find(Boolean) ?? null;
    try {
      const created = await db.crmDeal.create({
        data: {
          kind,
          dedupeKey: key,
          unitKey: unit.key,
          organizationId: unit.organizationId,
          contactId: unit.scopeOrgIds.map((id) => contactOf.get(id)).find(Boolean) ?? null,
          ownerId: pickAssignee(staff, [accountManager, settings.assigneeId]),
          periodEnd,
          amountRub: monthRub,
          offerJson: { tier, cycle: "month", points, seats, monthRub } as Prisma.InputJsonValue,
        },
      });
      result.created += 1;
      byUnit.set(unit.key, [...(byUnit.get(unit.key) ?? []), created]);
      return created;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return db.crmDeal.findUnique({ where: { dedupeKey: key } });
      throw error;
    }
  };

  for (const unit of units) {
    if (unit.exempt) continue;
    try {
      const state = stateForUnit(unit, trialSettings, now);
      const signed = unit.scopeOrgIds.map((id) => signedAt.get(id)).filter((value): value is Date => Boolean(value)).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

      if (state.kind === "free_period" && state.trialEndsAt && !unit.inactive) await ensure(unit, "trial", state.trialEndsAt, state.activeUsers);
      // Отсрочка: решение ещё не принято — сделка по тому сроку, что кончился.
      if (state.kind === "needs_decision" && !state.graceExpired && !unit.inactive) {
        if (state.reason === "subscription_expired" && unit.subscriptionEnd) await ensure(unit, "renewal", unit.subscriptionEnd, state.activeUsers);
        else if (state.trialEndsAt) await ensure(unit, "trial", state.trialEndsAt, state.activeUsers);
      }
      // Продление: годовым — всегда (решение раз в год), помесячным — только без автопродления
      // с баланса; не продлилось — сделка появится в отсрочке.
      const yearly = state.planCycle === "year";
      if (state.kind === "paid" && state.paidUntil && !unit.inactive && (yearly || !unit.autoRenew) && state.paidUntil.getTime() - now.getTime() <= RENEWAL_WINDOW_DAYS[yearly ? "year" : "month"] * DAY_MS) {
        await ensure(unit, "renewal", state.paidUntil, state.activeUsers);
      }

      const open = (byUnit.get(unit.key) ?? []).filter((deal) => !isClosedStage(deal.stage));
      for (const deal of open) {
        const end = deal.periodEnd?.getTime() ?? 0;
        if (signed && !deal.contractSignedAt) {
          if (await move(deal, "contract_signed", { contractSignedAt: signed })) result.moved += 1;
          deal.contractSignedAt = signed;
        }
        // Оплатили дальше конца периода сделки — «Оплачено» (в т.ч. оплата мимо хука).
        if (state.kind === "paid" && state.paidUntil && state.paidUntil.getTime() > end + DAY_MS) {
          if (await move(deal, "won")) result.won += 1;
          continue;
        }
        // Период прошёл, аккаунт на бесплатном — «Отказ».
        if (state.kind === "free" && end < now.getTime()) {
          if (await move(deal, "lost", { lostAt: now, lostReason: "Перешли на бесплатный тариф" })) result.lost += 1;
          continue;
        }
        // Ответственный: закрепили менеджера за клиентом — сделка за ним.
        const accountManager = unit.scopeOrgIds.map((id) => manager.get(id)).find(Boolean) ?? null;
        if (accountManager && deal.ownerId !== accountManager && staff.some((person) => person.id === accountManager)) {
          await db.crmDeal.update({ where: { id: deal.id }, data: { ownerId: accountManager } });
          deal.ownerId = accountManager;
        }
        if (!deal.contactId) {
          const contactId = unit.scopeOrgIds.map((id) => contactOf.get(id)).find(Boolean);
          if (contactId) {
            await db.crmDeal.update({ where: { id: deal.id }, data: { contactId } });
            deal.contactId = contactId;
          }
        }
      }
    } catch (error) {
      console.error("[deals] unit failed", { unit: unit.key, error });
    }
  }
  return result;
}

// ---------------------------------------------------------------- read

export type DealCard = {
  id: string;
  kind: string;
  stage: string;
  stageManual: boolean;
  organizationId: string;
  organizationName: string;
  contactId: string | null;
  ownerId: string | null;
  ownerName: string | null;
  periodEnd: string | null;
  amountRub: number | null;
  seats: number | null;
  discountPercent: number | null;
  contractSignedAt: string | null;
  messageSentAt: string | null;
  calledAt: string | null;
  lostReason: string | null;
  openTasks: number;
  updatedAt: string;
};

export type DealFilter = {
  /** Охват «свои»: свои сделки и свободные. */
  ownScopeId?: string | null;
  kind?: string | null;
  ownerId?: string | null;
  /** Только со сроком в ближайшие 7 дней. */
  dueSoon?: boolean;
  now?: Date;
};

/** Сделки для доски: открытые + закрытые за 30 дней. */
export async function listDeals(filter: DealFilter): Promise<DealCard[]> {
  const now = filter.now ?? new Date();
  const and: Prisma.CrmDealWhereInput[] = [{ OR: [{ stage: { notIn: ["won", "lost"] } }, { updatedAt: { gte: new Date(now.getTime() - 30 * DAY_MS) } }] }];
  if (filter.ownScopeId) and.push({ OR: [{ ownerId: filter.ownScopeId }, { ownerId: null }] });
  if (filter.kind) and.push({ kind: filter.kind });
  if (filter.ownerId === "none") and.push({ ownerId: null });
  else if (filter.ownerId) and.push({ ownerId: filter.ownerId });
  if (filter.dueSoon) and.push({ stage: { notIn: ["won", "lost"] }, periodEnd: { lte: new Date(now.getTime() + 7 * DAY_MS) } });
  const deals = await db.crmDeal.findMany({ where: { AND: and }, orderBy: [{ periodEnd: "asc" }], take: 500 });
  const orgIds = [...new Set(deals.map((deal) => deal.organizationId))];
  const ownerIds = [...new Set(deals.map((deal) => deal.ownerId).filter((value): value is string => Boolean(value)))];
  const [orgs, owners, tasks] = await Promise.all([
    orgIds.length ? db.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }) : [],
    ownerIds.length ? db.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } }) : [],
    deals.length ? db.crmTask.groupBy({ by: ["dealId"], where: { dealId: { in: deals.map((deal) => deal.id) }, status: { in: ["open", "waiting"] } }, _count: { _all: true } }) : [],
  ]);
  const orgName = new Map(orgs.map((org) => [org.id, org.name]));
  const ownerName = new Map(owners.map((owner) => [owner.id, owner.name]));
  const taskCount = new Map(tasks.map((row) => [row.dealId, row._count._all]));
  return deals.map((deal) => {
    const offer = (deal.offerJson ?? {}) as { seats?: number; discountPercent?: number };
    return {
      id: deal.id,
      kind: deal.kind,
      stage: deal.stage,
      stageManual: deal.stageManual,
      organizationId: deal.organizationId,
      organizationName: orgName.get(deal.organizationId) ?? "Организация",
      contactId: deal.contactId,
      ownerId: deal.ownerId,
      ownerName: deal.ownerId ? (ownerName.get(deal.ownerId) ?? null) : null,
      periodEnd: deal.periodEnd?.toISOString() ?? null,
      amountRub: deal.amountRub,
      seats: typeof offer.seats === "number" ? offer.seats : null,
      discountPercent: typeof offer.discountPercent === "number" ? offer.discountPercent : null,
      contractSignedAt: deal.contractSignedAt?.toISOString() ?? null,
      messageSentAt: deal.messageSentAt?.toISOString() ?? null,
      calledAt: deal.calledAt?.toISOString() ?? null,
      lostReason: deal.lostReason,
      openTasks: taskCount.get(deal.id) ?? 0,
      updatedAt: deal.updatedAt.toISOString(),
    };
  });
}

/** Для сводки CRM: сделок в работе и со сроком за 7 дней. */
export async function countDeals(args: { ownScopeId?: string | null; now?: Date }): Promise<{ open: number; dueSoon: number }> {
  const now = args.now ?? new Date();
  const scope: Prisma.CrmDealWhereInput = args.ownScopeId ? { OR: [{ ownerId: args.ownScopeId }, { ownerId: null }] } : {};
  const [open, dueSoon] = await Promise.all([
    db.crmDeal.count({ where: { ...scope, stage: { notIn: ["won", "lost"] } } }),
    db.crmDeal.count({ where: { ...scope, stage: { notIn: ["won", "lost"] }, periodEnd: { lte: new Date(now.getTime() + 7 * DAY_MS) } } }),
  ]);
  return { open, dueSoon };
}
