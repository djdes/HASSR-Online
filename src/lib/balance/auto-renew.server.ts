import { db } from "@/lib/db";
import type { AccountBillingState } from "@/lib/billing-period";
import { formatMskDay, lastDayBefore } from "@/lib/billing-period";
import type { BillingUnit } from "@/lib/billing.server";
import type { BasePlanSnapshot } from "@/lib/plan-payment";
import type { PlanTarget } from "@/lib/tariff-plans";

import {
  autoRenewDecision,
  autoRenewDoneText,
  autoRenewShortText,
  bestBalance,
  pickPayer,
  renewableTarget,
} from "./auto-renew-core";
import { formatPoints } from "./constants";

/**
 * Автопродление с баланса — обёртка с базой (логика — auto-renew-core.ts).
 *
 *   • runAutoRenewForUnit — ежедневная задача биллинга: срок на исходе,
 *     автопродление включено → заказ тарифа, оплаченный с баланса, и
 *     продление той же дорогой, что у оплаты (`completePaidOrder`);
 *   • tryAutoRenewForOrganization — сразу после пополнения: человек положил
 *     деньги, чтобы подписка не кончилась, — ждать задачу до утра незачем;
 *   • loadAutoRenewPreview — карточка «Автопродление» и напоминания: сколько
 *     спишем, когда, хватает ли.
 *
 * Цена — та же, что при оформлении (`quoteCheckout`: тариф, период, точки,
 * акция) плюс скидка навсегда аккаунта. Карта не списывается никогда.
 */

const BALANCE_HREF = "/settings/balance";

type RenewalQuote =
  | {
      ok: true;
      target: PlanTarget;
      tariffKey: string;
      title: string;
      description: string;
      priceRub: number;
      changeKind: string;
      creditRub: number;
      periodEnd: Date;
      basePlanJson: BasePlanSnapshot;
      baseRub: number;
      promotionId: string | null;
      promotionPercent: number | null;
      promotionDiscountRub: number;
      promoCode: string | null;
      promoDiscountRub: number;
      lifetimeDiscountId: string | null;
    }
  | { ok: false; reason: string };

/** Цена продления «как при оформлении»: квота, акция, скидка навсегда. */
async function quoteRenewal(organizationId: string, target: PlanTarget, email: string | null, now: Date): Promise<RenewalQuote> {
  const [{ quoteCheckout }, { basePlanSnapshot, changeKindNote }, { resolveCheckoutDiscount }, { computeCheckoutAmounts, orderDiscountNote }, { lifetimeTerm }] =
    await Promise.all([
      import("@/lib/plan-checkout.server"),
      import("@/lib/plan-payment"),
      import("@/lib/promo/checkout"),
      import("@/lib/promo/promotions"),
      import("@/lib/promo/discounts"),
    ]);
  const quote = await quoteCheckout({ organizationId, target, now });
  if (!quote.ok) return { ok: false, reason: `quote:${quote.code}` };
  // Тот же тариф, период и точки: «продление» (от конца срока) или, если срок
  // уже кончился, «новая» (с сегодня). Другое — не автопродление.
  if (quote.change.kind !== "renew" && quote.change.kind !== "new") return { ok: false, reason: `kind:${quote.change.kind}` };
  const offer = quote.offer;
  const discount = email
    ? await resolveCheckoutDiscount({ promoRaw: "", organizationId, email, offerRub: offer.priceRub, now, scope: "autorenew" }).catch(() => null)
    : null;
  const applied = discount?.ok ? discount.applied : null;
  const amounts = computeCheckoutAmounts({
    baseRub: offer.baseRub,
    promotion: offer.promotion,
    promo: applied ? { kind: applied.kind, value: applied.value } : null,
  });
  const changeNote = changeKindNote(quote.change.kind, { remainingDays: quote.change.remainingDays, creditRub: quote.change.creditRub });
  const discountNote = orderDiscountNote({
    promotion: offer.promotion,
    promotionDiscountRub: amounts.promotionDiscountRub,
    promoCode: applied?.code ?? null,
    promoDiscountRub: amounts.promoDiscountRub,
    lifetime: applied ? (applied.source === "lifetime" ? "auto" : applied.lifetime ? "code" : null) : null,
    lifetimeTerm: applied?.lifetime ? lifetimeTerm(applied) : null,
  });
  const notes = [changeNote, discountNote, "автопродление с баланса"].filter(Boolean).join("; ");
  return {
    ok: true,
    target: quote.target,
    tariffKey: quote.tariffKey,
    title: quote.title,
    description: `${quote.title} (${notes})`,
    priceRub: amounts.grossRub,
    changeKind: quote.change.kind,
    creditRub: quote.change.creditRub,
    periodEnd: quote.change.periodEnd,
    basePlanJson: basePlanSnapshot(quote.base),
    baseRub: amounts.baseRub,
    promotionId: offer.promotion?.id ?? null,
    promotionPercent: offer.promotion?.percent ?? null,
    promotionDiscountRub: amounts.promotionDiscountRub,
    promoCode: applied?.code ?? null,
    promoDiscountRub: amounts.promoDiscountRub,
    lifetimeDiscountId: applied?.lifetimeDiscountId ?? null,
  };
}

async function ownerEmail(ownerUserId: string | null): Promise<string | null> {
  if (!ownerUserId) return null;
  const owner = await db.user.findUnique({ where: { id: ownerUserId }, select: { email: true } });
  return owner?.email ?? null;
}

async function scopeBalances(scopeOrgIds: readonly string[]): Promise<Array<{ id: string; balanceRub: number }>> {
  if (scopeOrgIds.length === 0) return [];
  return db.organization.findMany({ where: { id: { in: [...scopeOrgIds] } }, select: { id: true, balanceRub: true } });
}

export type AutoRenewOutcome =
  | { status: "skipped"; reason: string }
  | { status: "renewed"; orderId: number; priceRub: number; payerOrganizationId: string; paidUntil: Date }
  | { status: "short"; priceRub: number; balanceRub: number; notified: boolean }
  | { status: "already" }
  | { status: "would-renew"; priceRub: number; payerOrganizationId: string }
  | { status: "failed"; error: string };

/**
 * Одна попытка автопродления аккаунта. `notifyShortage: false` — попытка
 * после пополнения: если всё ещё не хватает, письмо «не хватает» не шлём
 * (его отправит задача в день списания, один раз).
 */
export async function runAutoRenewForUnit(
  unit: BillingUnit,
  state: Pick<AccountBillingState, "kind" | "graceExpired">,
  now: Date,
  options: { dryRun?: boolean; notifyShortage?: boolean } = {},
): Promise<AutoRenewOutcome> {
  const decision = autoRenewDecision(unit, state, now);
  if (!decision.due) return { status: "skipped", reason: decision.reason };
  const email = await ownerEmail(unit.ownerUserId);
  if (!email) return { status: "skipped", reason: "no-owner" };
  const quote = await quoteRenewal(unit.organizationId, decision.target, email, now);
  if (!quote.ok) return { status: "skipped", reason: quote.reason };

  const balances = await scopeBalances(unit.scopeOrgIds);
  const payer = pickPayer(balances, unit.organizationId, quote.priceRub);
  if (!payer) {
    const balanceRub = bestBalance(balances, unit.organizationId);
    const notified = options.notifyShortage !== false && !options.dryRun
      ? await notifyShortage(unit, { title: quote.title, priceRub: quote.priceRub, balanceRub, paidUntil: decision.paidUntil, expired: decision.expired })
      : false;
    return { status: "short", priceRub: quote.priceRub, balanceRub, notified };
  }
  if (options.dryRun) return { status: "would-renew", priceRub: quote.priceRub, payerOrganizationId: payer };

  const { createOrderPaidFromBalance } = await import("./checkout");
  const created = await createOrderPaidFromBalance({
    organizationId: payer,
    userId: null,
    email,
    tariffKey: quote.tariffKey,
    description: quote.description,
    grossRub: quote.priceRub,
    spendDedupeKey: decision.dedupeKey,
    promoCode: quote.promoCode,
    discountRub: quote.promoDiscountRub,
    lifetimeDiscountId: quote.lifetimeDiscountId,
    baseRub: quote.baseRub,
    promotionId: quote.promotionId,
    promotionPercent: quote.promotionPercent,
    promotionDiscountRub: quote.promotionDiscountRub,
    points: quote.target.points,
    changeKind: quote.changeKind,
    creditRub: quote.creditRub,
    periodEndsAt: quote.periodEnd,
    basePlanJson: quote.basePlanJson,
  });
  if (created.status === "already") return { status: "already" };
  if (created.status === "short") {
    // Баланс потратили между чтением и списанием — «не хватает» без письма:
    // следующая попытка (задача, пополнение) увидит свежую цифру.
    return { status: "short", priceRub: quote.priceRub, balanceRub: created.balanceRub, notified: false };
  }

  // Продление, письмо-чек «оплачено с баланса», партнёрские и CRM — той же
  // дорогой, что у оплаты. Внутри всё best-effort.
  const stored = await db.paymentOrder.findUnique({ where: { id: created.id } });
  if (stored) {
    const { completePaidOrder } = await import("@/lib/payment-fulfillment");
    await completePaidOrder(stored);
  }
  const after = await db.organization.findUnique({ where: { id: payer }, select: { balanceRub: true, subscriptionEnd: true } });
  const paidUntil = after?.subscriptionEnd ?? quote.periodEnd;
  await notifyRenewed(unit, {
    payerOrganizationId: payer,
    orderId: created.id,
    title: quote.title,
    priceRub: quote.priceRub,
    balanceAfterRub: after?.balanceRub ?? 0,
    paidUntil,
    previousEnd: decision.paidUntil,
  });
  console.info("[billing] auto-renew from balance", {
    account: unit.accountId,
    payer,
    orderId: created.id,
    priceRub: quote.priceRub,
    paidUntil: paidUntil.toISOString(),
  });
  return { status: "renewed", orderId: created.id, priceRub: quote.priceRub, payerOrganizationId: payer, paidUntil };
}

/**
 * Попытка сразу после пополнения баланса (кассой, по счёту или ROOT).
 * Best-effort: сбой только в лог — пополнение уже зачислено, а задача
 * повторит продление в свой час.
 */
export async function tryAutoRenewForOrganization(organizationId: string, now: Date = new Date()): Promise<AutoRenewOutcome> {
  try {
    const { loadAccountBilling, stateForUnit } = await import("@/lib/billing.server");
    const loaded = await loadAccountBilling(organizationId);
    if (!loaded) return { status: "skipped", reason: "no-unit" };
    const state = stateForUnit(loaded.unit, loaded.settings, now);
    const outcome = await runAutoRenewForUnit(loaded.unit, state, now, { notifyShortage: false });
    if (outcome.status !== "skipped") console.info("[billing] auto-renew after top-up", { organizationId, status: outcome.status });
    return outcome;
  } catch (error) {
    console.error("[billing] auto-renew after top-up failed", { organizationId, error });
    return { status: "failed", error: error instanceof Error ? error.message : String(error) };
  }
}

export type AutoRenewPreview = {
  /** Автопродление включено у аккаунта. */
  enabled: boolean;
  /** Тариф может продлеваться сам (платный, с периодом, аккаунт есть). */
  renewable: boolean;
  /** Почему не продлится сам, если включено: запланирована смена тарифа и т. п. */
  blockedReason: "scheduled" | "legacy" | "not-paid-plan" | "exempt" | "inactive" | "no-account" | null;
  /** «Тариф «Стандарт» на месяц, 1 точка». */
  title: string | null;
  priceRub: number | null;
  /** Последний оплаченный день и день списания (накануне конца, МСК). */
  paidUntil: string | null;
  chargeDay: string | null;
  balanceRub: number;
  shortRub: number;
};

/** Что показать в «Тариф и оплата» и в напоминаниях. */
export async function loadAutoRenewPreview(organizationId: string, now: Date = new Date()): Promise<AutoRenewPreview | null> {
  const { loadAccountBilling } = await import("@/lib/billing.server");
  const loaded = await loadAccountBilling(organizationId);
  if (!loaded) return null;
  return previewForUnit(loaded.unit, now);
}

export async function previewForUnit(unit: BillingUnit, now: Date): Promise<AutoRenewPreview> {
  const balances = await scopeBalances(unit.scopeOrgIds.length ? unit.scopeOrgIds : [unit.organizationId]);
  const balanceRub = bestBalance(balances, unit.organizationId);
  const target = renewableTarget(unit);
  const blockedReason: AutoRenewPreview["blockedReason"] = !unit.accountId
    ? "no-account"
    : unit.exempt
      ? "exempt"
      : unit.inactive
        ? "inactive"
        : unit.plan === "paid"
          ? "legacy"
          : !target
            ? "not-paid-plan"
            : unit.scheduledPlan
              ? "scheduled"
              : null;
  const base: AutoRenewPreview = {
    enabled: unit.autoRenew,
    renewable: Boolean(target && unit.accountId && !unit.exempt),
    blockedReason,
    title: null,
    priceRub: null,
    paidUntil: unit.subscriptionEnd ? formatMskDay(lastDayBefore(unit.subscriptionEnd)) : null,
    chargeDay: unit.subscriptionEnd ? formatMskDay(new Date(lastDayBefore(unit.subscriptionEnd).getTime() - 24 * 60 * 60 * 1000)) : null,
    balanceRub,
    shortRub: 0,
  };
  if (!target || blockedReason) return base;
  const quote = await quoteRenewal(unit.organizationId, target, await ownerEmail(unit.ownerUserId), now).catch(() => null);
  if (!quote?.ok) return base;
  return { ...base, title: quote.title, priceRub: quote.priceRub, shortRub: Math.max(0, quote.priceRub - balanceRub) };
}

/* ------------------------------------------------------------ оповещения */

const P = 'style="margin:0 0 16px;color:#3f3f46;line-height:1.6"';
const BOX = 'style="background:#f5f6ff;border-radius:8px;padding:16px 20px;margin:0 0 24px;color:#3848c7;line-height:1.6"';
const BUTTON =
  'style="display:inline-block;background:#5566f6;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:12px;font-weight:600"';
const APP_URL = (process.env.NEXTAUTH_URL || process.env.APP_URL || "https://wesetup.ru").replace(/\/+$/, "");

async function auditOnce(unit: BillingUnit, action: string, paidUntil: Date): Promise<boolean> {
  const since = new Date(paidUntil.getTime() - 10 * 24 * 60 * 60 * 1000);
  const rows = await db.auditLog.findMany({
    where: { organizationId: { in: unit.scopeOrgIds.length ? unit.scopeOrgIds : [unit.organizationId] }, action, createdAt: { gte: since } },
    select: { details: true },
  });
  const key = paidUntil.toISOString();
  return !rows.some((row) => (row.details as { paidUntil?: unknown } | null)?.paidUntil === key);
}

/** «Не хватает на продление» — раз на срок: письмо и Telegram владельцу, колокольчик руководству. */
async function notifyShortage(
  unit: BillingUnit,
  args: { title: string; priceRub: number; balanceRub: number; paidUntil: Date; expired: boolean },
): Promise<boolean> {
  const action = "billing.auto-renew.short";
  if (!(await auditOnce(unit, action, args.paidUntil))) return false;
  const { escapeHtml } = await import("@/lib/html-escape");
  const lastDayLabel = formatMskDay(lastDayBefore(args.paidUntil));
  const copy = autoRenewShortText({
    orgName: unit.organizationName,
    title: args.title,
    priceRub: args.priceRub,
    balanceRub: args.balanceRub,
    lastDayLabel,
    expired: args.expired,
  });
  const html = autoRenewShortText({ ...args, orgName: escapeHtml(unit.organizationName), title: escapeHtml(args.title), lastDayLabel });
  const { sendOwnerNotice } = await import("@/lib/billing.server");
  await sendOwnerNotice({
    organizationId: unit.organizationId,
    kind: "billing.auto_renew_short",
    buttonLabel: "Пополнить баланс",
    telegramText: `⚠️ ${copy.head} ${copy.action}`,
    email: {
      subject: copy.subject,
      title: "Не хватает на продление",
      html:
        `<p ${P}>Здравствуйте!</p>` +
        `<p ${P}>${html.head}</p>` +
        `<div ${BOX}>${html.action}</div>` +
        `<a href="${APP_URL}${BALANCE_HREF}" ${BUTTON}>Пополнить баланс</a>`,
    },
  }).catch((error) => console.error("[billing] auto-renew short notice failed", error));
  const { notifyManagement } = await import("@/lib/notifications");
  await notifyManagement({
    organizationId: unit.organizationId,
    kind: "billing.auto-renew-short",
    dedupeKey: `billing.auto-renew-short:${unit.accountId ?? unit.organizationId}:${args.paidUntil.toISOString()}`,
    title: `Не хватает ${formatPoints(Math.max(0, args.priceRub - args.balanceRub))} на продление подписки`,
    linkHref: BALANCE_HREF,
    linkLabel: "Пополнить баланс",
    items: [{ id: "short", label: `${copy.head} ${copy.action}` }],
  }).catch((error) => console.error("[billing] auto-renew short bell failed", error));
  await db.auditLog.create({
    data: {
      organizationId: unit.organizationId,
      userName: "WeSetup",
      action,
      entity: unit.accountId ? "account" : "organization",
      entityId: unit.accountId ?? unit.organizationId,
      details: { paidUntil: args.paidUntil.toISOString(), priceRub: args.priceRub, balanceRub: args.balanceRub },
    },
  });
  return true;
}

/** Продлено с баланса: колокольчик руководству, Telegram владельцу, аудит. Чек-письмо уже ушло (`notifyAboutPayment`). */
async function notifyRenewed(
  unit: BillingUnit,
  args: { payerOrganizationId: string; orderId: number; title: string; priceRub: number; balanceAfterRub: number; paidUntil: Date; previousEnd: Date },
): Promise<void> {
  const text = autoRenewDoneText({
    title: args.title,
    priceRub: args.priceRub,
    balanceAfterRub: args.balanceAfterRub,
    paidUntilLabel: formatMskDay(lastDayBefore(args.paidUntil)),
  });
  try {
    const { notifyManagement } = await import("@/lib/notifications");
    await notifyManagement({
      organizationId: args.payerOrganizationId,
      kind: "billing.auto-renewed",
      dedupeKey: `billing.auto-renewed:${args.orderId}`,
      title: `Подписка продлена с баланса: −${formatPoints(args.priceRub)}`,
      linkHref: BALANCE_HREF,
      linkLabel: "Детализация баланса",
      items: [{ id: `order-${args.orderId}`, label: text }],
    });
  } catch (error) {
    console.error("[billing] auto-renew bell failed", error);
  }
  try {
    const { sendOwnerNotice } = await import("@/lib/billing.server");
    await sendOwnerNotice({ organizationId: unit.organizationId, kind: "billing.auto_renewed", telegramText: `✅ ${text}`, email: null });
  } catch (error) {
    console.error("[billing] auto-renew owner notice failed", error);
  }
  await db.auditLog
    .create({
      data: {
        organizationId: args.payerOrganizationId,
        userName: "WeSetup",
        action: "billing.auto-renew",
        entity: "PaymentOrder",
        entityId: String(args.orderId),
        details: {
          orderId: args.orderId,
          priceRub: args.priceRub,
          paidUntil: args.previousEnd.toISOString(),
          newPaidUntil: args.paidUntil.toISOString(),
          balanceAfterRub: args.balanceAfterRub,
        },
      },
    })
    .catch((error) => console.error("[billing] auto-renew audit failed", error));
}

