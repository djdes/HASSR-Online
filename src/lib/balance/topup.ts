import type { Prisma } from "@prisma/client";

import { recordAuditLog } from "@/lib/audit-log";
import { readPlatformRequisites } from "@/lib/closing-documents/requisites";
import { db } from "@/lib/db";
import { invoiceRequisitesReady } from "@/lib/invoices/build";
import { publishToOrganization } from "@/lib/live-events";
import { notifyManagement } from "@/lib/notifications";
import { readLegalProfile } from "@/lib/org-legal-profile";
import { notifyPlatformAdmin } from "@/lib/platform-admin";
import { isConfigured, isTestMode, type ReceiptItem } from "@/lib/robokassa";
import { escapeTelegramHtml } from "@/lib/telegram";

import { formatPoints } from "./constants";
import { sendBalanceTopupEmail } from "./emails";
import { applyBalanceChange, getBalance } from "./ledger";
import {
  TOPUP_TARIFF_KEY,
  isTopupOrder,
  settleOrderPayment,
  topupAmountOf,
  topupOrderDescription,
  type SettleInput,
  type SettleResult,
  type SettleStore,
  type SettleTx,
  type TopupBlockConfig,
} from "./topup-core";

/**
 * Пополнение баланса деньгами — обёртка ядра (topup-core.ts) с базой.
 *
 *   • createTopupCardOrder — заказ для кассы (Робокасса); сумму
 *     проверил маршрут (`parseTopupAmount`), здесь только запись;
 *   • settlePaidOrder — подтверждение оплаты ЛЮБОГО заказа (ResultURL
 *     кассы и ROOT «Оплата поступила»): pending → paid, а у пополнения в
 *     той же транзакции — строка леджера `topup:<orderId>`;
 *   • completeTopupOrder — всё, что после: комиссия партнёру (те же
 *     правила, что у подписки), колокольчик руководству и письмо
 *     плательщику, живое событие для открытых вкладок баланса, заметка
 *     админу, аудит. Каждый шаг best-effort: деньги уже зачислены.
 *
 * Счёт на пополнение — createTopupInvoiceOrder в lib/invoices/service.ts
 * (рядом со счётом на подписку и его проверками реквизитов).
 */

const ORDER_SNAPSHOT_SELECT = {
  id: true,
  tariffKey: true,
  status: true,
  amountRub: true,
  organizationId: true,
  userId: true,
  isTest: true,
  paymentMethod: true,
} as const;

function settleTx(tx: Prisma.TransactionClient): SettleTx {
  return {
    async claimPending({ orderId, paymentMethod, paidAt, rawResult }) {
      const claimed = await tx.paymentOrder.updateMany({
        where: { id: orderId, status: "pending", ...(paymentMethod ? { paymentMethod } : {}) },
        data: { status: "paid", paidAt, rawResult: rawResult as Prisma.InputJsonValue },
      });
      return claimed.count > 0;
    },
    findOrder: (orderId) =>
      tx.paymentOrder.findUnique({ where: { id: orderId }, select: ORDER_SNAPSHOT_SELECT }),
    async hasCredit(dedupeKey) {
      const row = await tx.balanceTransaction.findUnique({ where: { dedupeKey }, select: { id: true } });
      return row !== null;
    },
    async credit(entry) {
      await applyBalanceChange(tx, { ...entry, kind: "topup" });
    },
  };
}

const prismaSettleStore: SettleStore = {
  transaction: (fn) => db.$transaction((tx) => fn(settleTx(tx))),
};

/**
 * Подтверждение оплаты заказа. Для подписки — прежний атомарный перевод
 * pending → paid; для пополнения — плюс зачисление в той же транзакции.
 * Сбой зачисления откатывает и перевод: касса повторит уведомление.
 */
export async function settlePaidOrder(input: SettleInput): Promise<SettleResult> {
  const result = await settleOrderPayment(prismaSettleStore, input);
  const topup = result.topup;
  if (topup?.status === "credited") {
    console.info(
      `[balance] topup paid org=${topup.organizationId} rub=${topup.amountRub} order=${input.orderId}`,
    );
  } else if (topup?.status === "already") {
    console.info(`[balance] topup already credited order=${input.orderId} org=${topup.organizationId}`);
  } else if (topup?.status === "skipped") {
    // Не бывает при заказах из createTopupCardOrder / счёта (организация и
    // целая сумма есть всегда), но если случилось — деньги пришли, а баллы
    // нет: человек должен узнать сразу.
    console.error(`[balance] topup paid but NOT credited order=${input.orderId} reason=${topup.reason}`);
    await notifyPlatformAdmin(
      `⚠️ Пополнение баланса №${input.orderId} оплачено, но не зачислено (${topup.reason}) — разобрать вручную.`,
      { kind: "payment", dedupeKey: `topup-not-credited:${input.orderId}` },
    ).catch((error) => console.error("[balance] topup alert failed", error));
  }
  return result;
}

/**
 * Данные блока «Пополнить баланс»: можно ли платить картой и счётом, кто
 * плательщик по счёту и есть ли действующий счёт на пополнение.
 */
export async function loadTopupBlockConfig(organizationId: string): Promise<TopupBlockConfig> {
  const now = new Date();
  const [requisites, organization, pending] = await Promise.all([
    readPlatformRequisites(),
    db.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, inn: true, legalProfileJson: true, recurringActive: true },
    }),
    db.paymentOrder.findFirst({
      where: {
        organizationId,
        tariffKey: TOPUP_TARIFF_KEY,
        paymentMethod: "invoice",
        status: "pending",
        OR: [{ invoiceDueAt: null }, { invoiceDueAt: { gt: now } }],
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, amountRub: true, invoiceDueAt: true },
    }),
  ]);
  const inn =
    readLegalProfile(organization?.legalProfileJson)?.inn?.trim() || organization?.inn?.trim() || null;
  return {
    cardReady: isConfigured(),
    invoiceReady: invoiceRequisitesReady(requisites),
    organizationName: organization?.name ?? "",
    organizationInn: inn,
    pendingInvoice: pending
      ? {
          id: pending.id,
          amountRub: Number(pending.amountRub),
          dueAt: pending.invoiceDueAt?.toISOString() ?? null,
        }
      : null,
    recurringActive: organization?.recurringActive === true,
  };
}

/** Строка чека 54-ФЗ для пополнения (уходит, только если чеки включены env). */
export function topupReceiptItems(amountRub: number, name: string): ReceiptItem[] {
  return [
    {
      name: name.slice(0, 128),
      quantity: 1,
      sum: amountRub,
      payment_method: "advance",
      payment_object: "payment",
      tax: "none",
    },
  ];
}

/** Заказ на пополнение картой. Сумма уже проверена `parseTopupAmount`. */
export async function createTopupCardOrder(input: {
  organizationId: string;
  userId: string;
  email: string;
  amountRub: number;
}): Promise<{ id: number; amountRub: number; description: string; isTest: boolean }> {
  const description = topupOrderDescription(input.amountRub, "card");
  const order = await db.paymentOrder.create({
    data: {
      email: input.email,
      tariffKey: TOPUP_TARIFF_KEY,
      amountRub: input.amountRub,
      description,
      isTest: isTestMode(),
      organizationId: input.organizationId,
      userId: input.userId,
      paymentMethod: "card",
    },
    select: { id: true, isTest: true },
  });
  console.info(
    `[balance] topup order created org=${input.organizationId} rub=${input.amountRub} order=${order.id} method=card test=${order.isTest}`,
  );
  return { id: order.id, amountRub: input.amountRub, description, isTest: order.isTest };
}

/**
 * После подтверждённой оплаты пополнения (зачисление уже в леджере).
 * Зовёт completePaidOrder вместо продления подписки.
 */
export async function completeTopupOrder(
  orderId: number,
  actor: { id: string; name?: string | null; email?: string | null } | null = null,
): Promise<{ organizationId: string | null; isNewClient: boolean }> {
  const order = await db.paymentOrder.findUnique({
    where: { id: orderId },
    select: { ...ORDER_SNAPSHOT_SELECT, email: true },
  });
  if (!order || !isTopupOrder(order) || !order.organizationId) {
    console.error(`[balance] completeTopupOrder: order ${orderId} is not a paid top-up`);
    return { organizationId: order?.organizationId ?? null, isNewClient: false };
  }
  const organizationId = order.organizationId;
  const amountRub = topupAmountOf(order) ?? 0;
  const how = order.paymentMethod === "invoice" ? "по счёту" : "картой";

  // Партнёр: комиссия с пополнения — те же правила, что с оплаты подписки
  // (computePaymentAccruals). База — деньги заказа; подписка, оплаченная
  // потом этими баллами, имеет amountRub = 0 и второго начисления не даст.
  try {
    const { accrueForPaidOrder } = await import("@/lib/partners/accruals");
    const accrual = await accrueForPaidOrder(order.id);
    const total = accrual.drafts.reduce((sum, draft) => sum + draft.amountRub, 0);
    console.info(
      `[balance] topup partner accrual order=${order.id} org=${organizationId} created=${accrual.created} amount=${total}`,
    );
  } catch (error) {
    console.error(`[balance] topup partner accrual failed order=${order.id}`, error);
  }

  // Открытые вкладки «Баланс и бонусы» перечитают баланс и покажут тост.
  publishToOrganization(organizationId, {
    type: "balance",
    data: { amount: amountRub, comment: "Пополнение баланса" },
  });

  const balanceRub = await getBalance(organizationId).catch(() => amountRub);

  await notifyManagement({
    organizationId,
    kind: "balance.topup",
    dedupeKey: `balance.topup:${order.id}`,
    title: `Баланс пополнен на ${formatPoints(amountRub)}`,
    linkHref: "/settings/balance",
    linkLabel: "Открыть баланс",
    items: [
      {
        id: `order-${order.id}`,
        label: `Оплата ${how}, заказ №${order.id}. Баланс: ${formatPoints(balanceRub)}${order.isTest ? " (тестовый платёж)" : ""}`,
      },
    ],
  }).catch((error) => console.error("[balance] topup notify failed", error));

  await sendBalanceTopupEmail({
    to: order.email,
    amountRub,
    balanceRub,
    orderId: order.id,
    paymentMethod: order.paymentMethod,
    isTest: order.isTest,
  }).catch((error) => console.error("[balance] topup email failed", error));

  const organization = await db.organization
    .findUnique({ where: { id: organizationId }, select: { name: true } })
    .catch(() => null);
  await notifyPlatformAdmin(
    [
      order.isTest ? "🧪 ТЕСТОВОЕ пополнение баланса" : "💰 Пополнение баланса",
      `Сумма: ${formatPoints(amountRub)} (${how})`,
      `Организация: ${escapeTelegramHtml(organization?.name ?? organizationId)}`,
      `Почта: ${escapeTelegramHtml(order.email)}`,
      `Заказ №${order.id}`,
    ].join("\n"),
    { kind: "payment", dedupeKey: `topup-paid:${order.id}` },
  ).catch((error) => console.error("[balance] topup admin notify failed", error));

  await recordAuditLog({
    organizationId,
    session: actor ? { user: actor } : null,
    action: "balance.topup.paid",
    entity: "PaymentOrder",
    entityId: String(order.id),
    details: {
      amountRub,
      paymentMethod: order.paymentMethod,
      isTest: order.isTest,
      balanceRub,
    },
  });
  console.info(
    `[balance] topup completed order=${order.id} org=${organizationId} rub=${amountRub} balance=${balanceRub}`,
  );
  return { organizationId, isNewClient: false };
}
