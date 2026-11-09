import { isBillingCycle, isPaidTier, type PlanTarget } from "@/lib/tariff-plans";

import { formatPoints } from "./constants";

/**
 * Автопродление подписки с баланса — чистая логика (владелец, 2026-11-09:
 * «по примеру мобильных операторов… при активной включённой подписке
 * автоматически списываются с баланса»). Обёртка с базой —
 * auto-renew.server.ts, вызов — ежедневная задача биллинга.
 *
 * Когда списываем: за сутки-двое до конца срока. Квота «продление» считает
 * новый период от текущего конца, поэтому раннее списание не отнимает ни
 * дня. Если задача пропустила окно, — после конца, пока не истёк грейс
 * (период тогда считается с момента списания, как новая подписка).
 */

/** Окно списания до конца срока. Задача идёт раз в сутки — двое суток не дают его проскочить. */
export const AUTO_RENEW_WINDOW_HOURS = 48;

export type AutoRenewUnit = {
  accountId: string | null;
  /** Тариф аккаунта: standard/premium/vip — платные; paid — прежняя «Подписка». */
  plan: string;
  planCycle: string | null;
  planPoints: number;
  /** Самый поздний срок по аккаунту и его организациям. */
  subscriptionEnd: Date | null;
  exempt: boolean;
  inactive: boolean;
  /** Запланированная смена тарифа с конца срока — её применяет оплата, не автопродление. */
  scheduledPlan: unknown | null;
  autoRenew: boolean;
};

export type AutoRenewStateView = {
  kind: string;
  graceExpired: boolean;
};

export type AutoRenewSkip =
  | "no-account"
  | "exempt"
  | "inactive"
  | "legacy"
  | "not-paid-plan"
  | "off"
  | "scheduled"
  | "no-end"
  | "not-due"
  | "grace-over";

export type AutoRenewDecision =
  | { due: true; target: PlanTarget; paidUntil: Date; dedupeKey: string; expired: boolean }
  | { due: false; reason: AutoRenewSkip };

/** Ключ списания: одно автопродление на аккаунт и конец срока. */
export function autoRenewDedupeKey(accountId: string, paidUntil: Date): string {
  return `autorenew:${accountId}:${paidUntil.toISOString()}`;
}

/** Тариф, который продлевается сам: платный, с известным периодом. */
export function renewableTarget(unit: Pick<AutoRenewUnit, "plan" | "planCycle" | "planPoints">): PlanTarget | null {
  if (!isPaidTier(unit.plan) || !isBillingCycle(unit.planCycle)) return null;
  return { tier: unit.plan, cycle: unit.planCycle, points: Math.max(1, Math.floor(unit.planPoints || 1)) };
}

export function autoRenewDecision(unit: AutoRenewUnit, state: AutoRenewStateView, now: Date): AutoRenewDecision {
  if (!unit.accountId) return { due: false, reason: "no-account" };
  if (unit.exempt) return { due: false, reason: "exempt" };
  if (unit.inactive) return { due: false, reason: "inactive" };
  if (unit.plan === "paid") return { due: false, reason: "legacy" };
  const target = renewableTarget(unit);
  if (!target) return { due: false, reason: "not-paid-plan" };
  if (!unit.autoRenew) return { due: false, reason: "off" };
  if (unit.scheduledPlan) return { due: false, reason: "scheduled" };
  const paidUntil = unit.subscriptionEnd;
  if (!paidUntil) return { due: false, reason: "no-end" };
  const msLeft = paidUntil.getTime() - now.getTime();
  if (msLeft > AUTO_RENEW_WINDOW_HOURS * 60 * 60 * 1000) return { due: false, reason: "not-due" };
  const expired = msLeft <= 0;
  // После конца — только пока руководитель ещё «решает» (грейс): потом
  // аккаунт уходит на бесплатный, и продление — уже новая покупка.
  if (expired && (state.kind !== "needs_decision" || state.graceExpired)) return { due: false, reason: "grace-over" };
  return { due: true, target, paidUntil, dedupeKey: autoRenewDedupeKey(unit.accountId, paidUntil), expired };
}

/**
 * Кто платит: основная организация аккаунта, если на её балансе хватает;
 * иначе — организация аккаунта с самым большим балансом, если хватает там.
 * Складывать балансы разных организаций не будем: у каждой своя история.
 */
export function pickPayer(
  balances: ReadonlyArray<{ id: string; balanceRub: number }>,
  mainOrganizationId: string,
  priceRub: number,
): string | null {
  const main = balances.find((row) => row.id === mainOrganizationId);
  if (main && main.balanceRub >= priceRub) return main.id;
  const best = [...balances].sort((a, b) => b.balanceRub - a.balanceRub)[0];
  return best && best.balanceRub >= priceRub ? best.id : null;
}

/** Баланс, с которого показываем «на балансе» и «не хватает»: основной, а если где-то больше — тот. */
export function bestBalance(balances: ReadonlyArray<{ id: string; balanceRub: number }>, mainOrganizationId: string): number {
  const main = balances.find((row) => row.id === mainOrganizationId)?.balanceRub ?? 0;
  return Math.max(main, ...balances.map((row) => row.balanceRub));
}

/* ------------------------------------------------------------ тексты */

/**
 * Строка в напоминании о конце срока при включённом автопродлении:
 * хватает — «спишем», не хватает — «пополните».
 */
export function autoRenewReminderLine(args: { priceRub: number; balanceRub: number; chargeDayLabel: string }): string {
  const short = args.priceRub - args.balanceRub;
  if (short <= 0) {
    return (
      `Автопродление включено: ${args.chargeDayLabel} спишем ${formatPoints(args.priceRub)} с баланса ` +
      `(на балансе ${formatPoints(args.balanceRub)}) — продлевать вручную не нужно.`
    );
  }
  return (
    `Автопродление включено, но на балансе ${formatPoints(args.balanceRub)} — не хватает ${formatPoints(short)}. ` +
    `Пополните баланс до ${args.chargeDayLabel}, и подписка продлится сама.`
  );
}

/** Подписка продлена с баланса: колокольчик и Telegram. */
export function autoRenewDoneText(args: { title: string; priceRub: number; balanceAfterRub: number; paidUntilLabel: string }): string {
  return (
    `Подписка продлена до ${args.paidUntilLabel}: ${args.title}. ` +
    `С баланса списано ${formatPoints(args.priceRub)}, осталось ${formatPoints(args.balanceAfterRub)}.`
  );
}

/** Не хватило денег на балансе в день списания. */
export function autoRenewShortText(args: {
  orgName: string;
  title: string;
  priceRub: number;
  balanceRub: number;
  lastDayLabel: string;
  expired: boolean;
}): { subject: string; head: string; action: string } {
  const short = Math.max(0, args.priceRub - args.balanceRub);
  return {
    subject: `«${args.orgName}»: не хватает ${formatPoints(short)} на продление`,
    head:
      `Не удалось продлить подписку «${args.orgName}» с баланса: ${args.title} стоит ${formatPoints(args.priceRub)}, ` +
      `на балансе ${formatPoints(args.balanceRub)} — не хватает ${formatPoints(short)}.`,
    action: args.expired
      ? "Пополните баланс — подписка продлится сразу после зачисления. Можно и оплатить тариф картой или по счёту."
      : `Пополните баланс до ${args.lastDayLabel} включительно — подписка продлится сама сразу после зачисления. Можно и оплатить тариф картой или по счёту.`,
  };
}
