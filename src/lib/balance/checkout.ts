import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

import { POINTS_HOLD_HOURS, pointsToSpend } from "./constants";
import { applyBalanceChange, DuplicateBalanceChangeError, InsufficientBalanceError } from "./ledger";

/**
 * Оформление заказа со списанием баллов.
 *
 * Почему холд именно при создании заказа, а не при оплате: между
 * «Перейти к оплате» и приходом вебхука проходит минута, и без холда
 * одни и те же баллы можно было бы потратить в двух вкладках. Поэтому
 * баллы списываются сразу, а если заказ так и не оплатили — возвращаются
 * (при оформлении следующего заказа или крону через сутки).
 */

type TxClient = Prisma.TransactionClient;

type PendingPointOrder = {
  id: number;
  pointsSpent: number;
  organizationId: string | null;
};

/**
 * Закрывает неоплаченный заказ с холдом и возвращает баллы. Возвращает
 * `true`, если именно этот вызов забрал заказ (то есть баллы вернул он).
 */
async function releaseOrder(tx: TxClient, order: PendingPointOrder): Promise<boolean> {
  const claimed = await tx.paymentOrder.updateMany({
    where: { id: order.id, status: "pending" },
    data: { status: "expired" },
  });
  if (claimed.count === 0) return false;
  if (order.pointsSpent <= 0 || !order.organizationId) return true;

  // Проверяем ДО начисления, а не ловим P2002 после: `applyBalanceChange`
  // сначала двигает баланс и только потом пишет строку, и «проглоченный»
  // внутри транзакции дубль оставил бы баланс без записи в леджере.
  // Гонку страхует уникальный `dedupeKey` — она откатит транзакцию целиком.
  const dedupeKey = `order_release:${order.id}`;
  const already = await tx.balanceTransaction.findUnique({
    where: { dedupeKey },
    select: { id: true },
  });
  if (already) return true;

  await applyBalanceChange(tx, {
    organizationId: order.organizationId,
    amount: order.pointsSpent,
    kind: "order_release",
    description: `Возврат баллов по неоплаченному заказу №${order.id}`,
    dedupeKey,
    paymentOrderId: order.id,
  });
  return true;
}

/**
 * Баллы, списанные в оплату заказа, — обратно на баланс, когда оплату этого
 * заказа вернули (ROOT, разбор оплаты). Идемпотентно: тот же `dedupeKey`,
 * что у возврата по неоплаченному заказу. `true` — баллы вернул этот вызов.
 */
export async function returnRefundedOrderPoints(order: PendingPointOrder): Promise<boolean> {
  if (order.pointsSpent <= 0 || !order.organizationId) return false;
  const organizationId = order.organizationId;
  return db.$transaction(async (tx) => {
    const dedupeKey = `order_release:${order.id}`;
    const already = await tx.balanceTransaction.findUnique({ where: { dedupeKey }, select: { id: true } });
    if (already) return false;
    await applyBalanceChange(tx, {
      organizationId,
      amount: order.pointsSpent,
      kind: "order_release",
      description: `Возврат баллов по заказу №${order.id}: оплата возвращена`,
      dedupeKey,
      paymentOrderId: order.id,
    });
    return true;
  });
}

export type CreateOrderWithPointsInput = {
  organizationId: string | null;
  userId: string | null;
  email: string;
  tariffKey: string;
  description: string;
  /** Полная сумма заказа: подписка + оборудование. */
  grossRub: number;
  /** Цена подписки — потолок списания: железо баллами не оплачивается. */
  subscriptionRub: number;
  bundleConfig: Record<string, number> | null;
  isTest: boolean;
  recurringConsent: boolean;
  partnerSlug: string | null;
  referrerOrganizationId: string | null;
  /** Тумблер «списать баллы» на странице оформления. */
  usePoints: boolean;
  /** Промокод (в верхнем регистре) и скидка в рублях — уже посчитанные сервером. */
  promoCode?: string | null;
  discountRub?: number;
  /** Скидка навсегда применилась сама (id AccountLifetimeDiscount). */
  lifetimeDiscountId?: string | null;
  /**
   * Снимок цены для отчёта ROOT: цена подписки по тарифу до скидок и
   * действовавшая акция (id, процент, скидка в рублях). Сумму заказа не
   * меняют — она уже в grossRub.
   */
  baseRub?: number | null;
  promotionId?: string | null;
  promotionPercent?: number | null;
  promotionDiscountRub?: number;
  /**
   * Тарифы 2026-10: точки, вид перехода, зачёт остатка и конец срока,
   * посчитанные `quoteCheckout` — их применит оплата (`planAfterPayment`).
   */
  points?: number | null;
  changeKind?: string | null;
  creditRub?: number;
  periodEndsAt?: Date | null;
  /** Снимок подписки, от которой посчитан заказ (`basePlanSnapshot`). */
  basePlanJson?: Prisma.InputJsonValue | null;
};

export type CreatedOrder = {
  id: number;
  amountRub: number;
  pointsSpent: number;
  isTest: boolean;
  /** Заказ полностью закрыт баллами — Робокасса не нужна. */
  paidByPoints: boolean;
};

/**
 * Одна интерактивная транзакция: закрыть свои прошлые холды, посчитать
 * баланс, создать заказ, списать баллы и — если платить больше нечего —
 * сразу пометить заказ оплаченным. Fulfillment вызывается ПОСЛЕ коммита.
 */
export async function createOrderWithPoints(
  input: CreateOrderWithPointsInput,
): Promise<CreatedOrder> {
  const gross = Math.max(0, Math.round(input.grossRub));

  return db.$transaction(async (tx) => {
    let balance = 0;

    if (input.organizationId && input.usePoints) {
      // Старые неоплаченные заказы этой организации с холдом закрываем и
      // возвращаем баллы: человек оформляет заказ заново, и прежний
      // холд ему только мешает.
      const stale = await tx.paymentOrder.findMany({
        where: {
          organizationId: input.organizationId,
          status: "pending",
          pointsSpent: { gt: 0 },
        },
        select: { id: true, pointsSpent: true, organizationId: true },
      });
      for (const order of stale) {
        await releaseOrder(tx, order);
      }

      const org = await tx.organization.findUnique({
        where: { id: input.organizationId },
        select: { balanceRub: true },
      });
      balance = org?.balanceRub ?? 0;
    }

    const pointsSpent = pointsToSpend({
      balanceRub: balance,
      subscriptionRub: Math.min(input.subscriptionRub, gross),
      usePoints: input.usePoints && Boolean(input.organizationId),
    });
    const net = gross - pointsSpent;
    const paidByPoints = net === 0;

    const order = await tx.paymentOrder.create({
      data: {
        email: input.email,
        tariffKey: input.tariffKey,
        amountRub: net,
        description: input.description,
        bundleConfig: input.bundleConfig ?? undefined,
        isTest: input.isTest,
        recurringConsent: input.recurringConsent,
        partnerSlug: input.partnerSlug ?? undefined,
        organizationId: input.organizationId ?? undefined,
        userId: input.userId ?? undefined,
        pointsSpent,
        referrerOrganizationId: input.referrerOrganizationId ?? undefined,
        promoCode: input.promoCode ?? undefined,
        discountRub: input.discountRub ?? 0,
        lifetimeDiscountId: input.lifetimeDiscountId ?? undefined,
        baseRub: input.baseRub ?? undefined,
        promotionId: input.promotionId ?? undefined,
        promotionPercent: input.promotionPercent ?? undefined,
        promotionDiscountRub: input.promotionDiscountRub ?? 0,
        points: input.points ?? undefined,
        changeKind: input.changeKind ?? undefined,
        creditRub: input.creditRub ?? 0,
        periodEndsAt: input.periodEndsAt ?? undefined,
        basePlanJson: input.basePlanJson ?? undefined,
      },
      select: { id: true, isTest: true },
    });

    if (pointsSpent > 0 && input.organizationId) {
      await applyBalanceChange(tx, {
        organizationId: input.organizationId,
        amount: -pointsSpent,
        kind: "order_spend",
        description: `Оплата заказа №${order.id} баллами`,
        dedupeKey: `order_spend:${order.id}`,
        paymentOrderId: order.id,
        actorUserId: input.userId,
      });
    }

    if (paidByPoints) {
      await tx.paymentOrder.update({
        where: { id: order.id },
        data: {
          status: "paid",
          paidAt: new Date(),
          isTest: false,
          // Ноль к оплате бывает и без баллов — промокод на 100 %.
          rawResult: { paidBy: pointsSpent > 0 ? "points" : "discount", pointsSpent },
        },
      });
    }

    return {
      id: order.id,
      amountRub: net,
      pointsSpent,
      isTest: paidByPoints ? false : order.isTest,
      paidByPoints,
    };
  });
}

/**
 * Страховочный проход крона: заказы с холдом, которые провисели дольше
 * `POINTS_HOLD_HOURS`, закрываются, а баллы возвращаются. Каждый заказ —
 * своя транзакция: падение на одном не должно отменять остальные.
 */
export async function expireStalePointOrders(
  cutoff: Date = new Date(Date.now() - POINTS_HOLD_HOURS * 60 * 60 * 1000),
): Promise<{ expired: number; releasedRub: number }> {
  const stale = await db.paymentOrder.findMany({
    where: {
      status: "pending",
      pointsSpent: { gt: 0 },
      createdAt: { lt: cutoff },
    },
    select: { id: true, pointsSpent: true, organizationId: true },
    take: 500,
  });

  let expired = 0;
  let releasedRub = 0;
  for (const order of stale) {
    const released = await db.$transaction((tx) => releaseOrder(tx, order));
    if (released) {
      expired += 1;
      releasedRub += order.pointsSpent;
    }
  }
  return { expired, releasedRub };
}

export type BalanceOrderInput = Omit<
  CreateOrderWithPointsInput,
  "usePoints" | "bundleConfig" | "recurringConsent" | "partnerSlug" | "referrerOrganizationId" | "isTest" | "subscriptionRub"
> & {
  organizationId: string;
  /**
   * Ключ строки списания (`autorenew:<аккаунт>:<конец срока>`): одно
   * списание на срок — второй параллельный запуск откатится по unique.
   */
  spendDedupeKey: string;
};

export type BalanceOrderResult =
  | { status: "paid"; id: number; amountRub: number }
  | { status: "short"; balanceRub: number }
  | { status: "already" };

/**
 * Заказ тарифа, оплаченный целиком с баланса (автопродление). Одна
 * транзакция: хватает ли баланса → заказ сразу `paid` → строка
 * «Оплата тарифа» (`subscription_charge`). Не хватает — заказа нет вовсе
 * (в отличие от оформления, где остаток платят картой). Чужие незакрытые
 * холды не трогаем: человек может прямо сейчас платить в другой вкладке.
 * Продление подписки — `completePaidOrder` после коммита.
 */
export async function createOrderPaidFromBalance(input: BalanceOrderInput): Promise<BalanceOrderResult> {
  const gross = Math.max(0, Math.round(input.grossRub));
  try {
    return await db.$transaction(async (tx): Promise<BalanceOrderResult> => {
      const org = await tx.organization.findUnique({ where: { id: input.organizationId }, select: { balanceRub: true } });
      const balanceRub = org?.balanceRub ?? 0;
      if (gross <= 0 || balanceRub < gross) return { status: "short", balanceRub };
      const order = await tx.paymentOrder.create({
        data: {
          email: input.email,
          tariffKey: input.tariffKey,
          amountRub: 0,
          description: input.description,
          isTest: false,
          organizationId: input.organizationId,
          userId: input.userId ?? undefined,
          pointsSpent: gross,
          promoCode: input.promoCode ?? undefined,
          discountRub: input.discountRub ?? 0,
          lifetimeDiscountId: input.lifetimeDiscountId ?? undefined,
          baseRub: input.baseRub ?? undefined,
          promotionId: input.promotionId ?? undefined,
          promotionPercent: input.promotionPercent ?? undefined,
          promotionDiscountRub: input.promotionDiscountRub ?? 0,
          points: input.points ?? undefined,
          changeKind: input.changeKind ?? undefined,
          creditRub: input.creditRub ?? 0,
          periodEndsAt: input.periodEndsAt ?? undefined,
          basePlanJson: input.basePlanJson ?? undefined,
          status: "paid",
          paidAt: new Date(),
          rawResult: { paidBy: "balance", autoRenew: true, pointsSpent: gross },
        },
        select: { id: true },
      });
      await applyBalanceChange(tx, {
        organizationId: input.organizationId,
        amount: -gross,
        kind: "subscription_charge",
        description: `Оплата тарифа с баланса: ${input.description}, заказ №${order.id}`,
        dedupeKey: input.spendDedupeKey,
        paymentOrderId: order.id,
        actorUserId: input.userId,
      });
      return { status: "paid", id: order.id, amountRub: gross };
    });
  } catch (error) {
    // Баланс успели потратить между чтением и списанием — как «не хватает».
    if (error instanceof InsufficientBalanceError) {
      const org = await db.organization.findUnique({ where: { id: input.organizationId }, select: { balanceRub: true } });
      return { status: "short", balanceRub: org?.balanceRub ?? 0 };
    }
    // Этот срок уже продлили (параллельный запуск задачи) — заказ откатился.
    if (error instanceof DuplicateBalanceChangeError) return { status: "already" };
    throw error;
  }
}
