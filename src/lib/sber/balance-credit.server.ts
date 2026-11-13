/**
 * Зачисление поступлений из выписки на баланс — обёртка с базой для
 * `balance-credit.ts`. Деньги идут обычным путём пополнения: под каждое
 * поступление создаётся заказ-пополнение (как счёт на пополнение) и сразу
 * отмечается оплаченным через `markInvoicePaid`. Поэтому всё, что бывает
 * при пополнении, случается и здесь: строка «Пополнение» в истории баланса,
 * колокольчик и письмо руководству с УПД, комиссия партнёру, заметка
 * админу и автопродление тарифа, если срок на исходе.
 */
import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { formatPoints } from "@/lib/balance/constants";
import { TOPUP_TARIFF_KEY } from "@/lib/balance/topup-core";
import { markInvoicePaid } from "@/lib/invoices/service";
import { notifyPlatformAdmin } from "@/lib/platform-admin";
import { escapeTelegramHtml } from "@/lib/telegram";

import type { PayerOrganization, RecentPaidInvoice, StatementCreditDecision } from "./balance-credit";
import { digitsOnly } from "./scanflow-shared";
import type { StatementTx } from "./statement-parse";

const APP_URL = process.env.NEXTAUTH_URL || "https://wesetup.ru";
/** Сколько дней назад искать счёт, отмеченный оплаченным вручную. */
const RECENT_PAID_DAYS = 30;
const MANAGER_ROLES = ["owner", "manager", "head_chef", "technologist"];

/** Организации с ИНН плательщиков из выписки (и были ли у них оплаты). */
export async function loadPayerOrganizations(payerInns: string[]): Promise<PayerOrganization[]> {
  const inns = [...new Set(payerInns.map((inn) => digitsOnly(inn)).filter((inn) => inn.length === 10 || inn.length === 12))];
  if (inns.length === 0) return [];
  const platformOrgId = process.env.PLATFORM_ORG_ID || "platform";
  const rows = await db.organization.findMany({
    where: { id: { not: platformOrgId }, OR: inns.map((inn) => ({ inn: { contains: inn } })) },
    select: { id: true, name: true, inn: true },
  });
  const matching = rows.filter((row) => inns.includes(digitsOnly(row.inn)));
  if (matching.length === 0) return [];
  const paid = await db.paymentOrder.groupBy({
    by: ["organizationId"],
    where: { organizationId: { in: matching.map((row) => row.id) }, status: { in: ["paid", "completed"] }, isTest: false },
  });
  const paying = new Set(paid.map((row) => row.organizationId));
  return matching.map((row) => ({ ...row, hasPaidOrders: paying.has(row.id) }));
}

/**
 * Счета, отмеченные оплаченными за последний месяц не сверкой выписки, а
 * вручную: их деньги, придя в выписку, повторно не зачисляем.
 */
export async function loadRecentManuallyPaidInvoices(now: Date): Promise<RecentPaidInvoice[]> {
  const rows = await db.paymentOrder.findMany({
    where: {
      paymentMethod: "invoice",
      status: { in: ["paid", "completed"] },
      paidAt: { gte: new Date(now.getTime() - RECENT_PAID_DAYS * 86_400_000) },
    },
    select: { id: true, amountRub: true, buyerJson: true, organizationId: true },
  });
  if (rows.length === 0) return [];
  const linked = new Set(
    (
      await db.sberIncomingPayment.findMany({
        where: { orderId: { in: rows.map((row) => row.id) } },
        select: { orderId: true },
      })
    ).map((row) => row.orderId),
  );
  const open = rows.filter((row) => !linked.has(row.id));
  const orgIds = [...new Set(open.map((row) => row.organizationId).filter((id): id is string => Boolean(id)))];
  const orgs = orgIds.length
    ? await db.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, inn: true } })
    : [];
  const innByOrg = new Map(orgs.map((org) => [org.id, digitsOnly(org.inn)]));
  return open.map((row) => {
    const guestInn =
      row.buyerJson && typeof row.buyerJson === "object" ? digitsOnly((row.buyerJson as Record<string, unknown>).inn) : "";
    return {
      id: row.id,
      amountRub: Number(row.amountRub),
      buyerInn: (row.organizationId ? innByOrg.get(row.organizationId) : guestInn) || null,
    };
  });
}

/** Куда слать письмо о пополнении: почта последней оплаты, иначе руководитель. */
async function organizationBillingEmail(organizationId: string): Promise<{ email: string; userId: string | null } | null> {
  const lastOrder = await db.paymentOrder.findFirst({
    where: { organizationId, email: { contains: "@" } },
    orderBy: { createdAt: "desc" },
    select: { email: true, userId: true },
  });
  if (lastOrder) return { email: lastOrder.email, userId: lastOrder.userId };
  const manager = await db.user.findFirst({
    where: { organizationId, isActive: true, archivedAt: null, role: { in: MANAGER_ROLES }, email: { contains: "@" } },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true },
  });
  return manager ? { email: manager.email, userId: manager.id } : null;
}

function rub(amount: number): string {
  return `${amount.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;
}

function payerLine(tx: StatementTx): string {
  return [tx.payerName, tx.payerInn ? `ИНН ${tx.payerInn}` : null].filter(Boolean).join(", ") || "плательщик не указан";
}

function baseRecord(tx: StatementTx) {
  return {
    operationId: tx.operationId,
    operationDate: tx.date,
    amountRub: tx.amountRub,
    payerInn: tx.payerInn,
    payerName: tx.payerName,
    purpose: tx.purpose.slice(0, 500),
  };
}

export type StatementCreditOutcome = "credited" | "already" | "review" | "failed" | "skipped";

/**
 * Провести решение по одному поступлению. Сначала запись поступления
 * (уникальный operationId): параллельная сверка того же дня на ней
 * споткнётся и не зачислит деньги второй раз.
 */
export async function applyStatementCredit(
  tx: StatementTx,
  decision: Exclude<StatementCreditDecision, { kind: "skip" }>,
  review: { orderId: number; reason: string } | null,
): Promise<StatementCreditOutcome> {
  const base = baseRecord(tx);
  const amount = rub(tx.amountRub);

  if (decision.kind === "already-paid") {
    await db.sberIncomingPayment.create({
      data: { ...base, orderId: decision.orderId, status: "already", note: "счёт уже отмечен оплаченным вручную" },
    });
    return "already";
  }

  if (decision.kind === "ambiguous") {
    const orgs = await db.organization.findMany({ where: { id: { in: decision.organizationIds } }, select: { id: true, name: true } });
    await db.sberIncomingPayment.create({
      data: { ...base, orderId: review?.orderId ?? null, status: "review", note: `ИНН у нескольких организаций: ${orgs.map((o) => o.name).join("; ")}`.slice(0, 500) },
    });
    await notifyPlatformAdmin(
      [
        `🔎 <b>Сбер: поступление не зачислено — ИНН у нескольких организаций</b>`,
        `${escapeTelegramHtml(payerLine(tx))} · ${amount} · ${escapeTelegramHtml(tx.date.slice(0, 10))}`,
        `Назначение: ${escapeTelegramHtml(tx.purpose.slice(0, 200))}`,
        ...orgs.map((o) => `• ${escapeTelegramHtml(o.name)}: ${APP_URL}/root/organizations/${o.id}`),
        `Зачислите вручную нужной: «Пополнить баланс» → «Безнал».`,
      ].join("\n"),
      { kind: "payment", dedupeKey: `sber-ambiguous:${tx.operationId}` },
    ).catch((error) => console.error("[sber-credit] уведомление не ушло:", error));
    return "review";
  }

  const contact = await organizationBillingEmail(decision.organizationId);
  await db.sberIncomingPayment.create({
    data: {
      ...base,
      organizationId: decision.organizationId,
      reviewOrderId: decision.orderId,
      status: "crediting",
      note: review ? review.reason.slice(0, 500) : "без счёта, по ИНН плательщика",
    },
  });

  const paidAt = Number.isFinite(Date.parse(tx.date)) ? new Date(tx.date) : new Date();
  const order = await db.paymentOrder.create({
    data: {
      // A bank payment belongs to the organization even without a billing email.
      // Empty email is intentional; notifications remain best-effort after settlement.
      email: contact?.email ?? "",
      userId: contact?.userId ?? null,
      organizationId: decision.organizationId,
      tariffKey: TOPUP_TARIFF_KEY,
      amountRub: decision.amount,
      description: `Пополнение баланса на ${formatPoints(decision.amount)} (поступление на расчётный счёт)`,
      status: "pending",
      isTest: false,
      paymentMethod: "invoice",
    },
    select: { id: true },
  });
  await db.sberIncomingPayment.update({ where: { operationId: tx.operationId }, data: { orderId: order.id } });
  const raw: Prisma.InputJsonValue = {
    source: "sber-statement",
    kind: "balance-credit",
    operationId: tx.operationId,
    operationDate: tx.date,
    amountRub: tx.amountRub,
    payerInn: tx.payerInn,
    payerName: tx.payerName,
    purpose: tx.purpose.slice(0, 500),
    reviewOrderId: decision.orderId,
    at: new Date().toISOString(),
  };
  const marked = await markInvoicePaid(order.id, null, { rawResult: raw, paidAt });
  if (!marked.ok) {
    await db.sberIncomingPayment.update({
      where: { operationId: tx.operationId },
      data: { orderId: order.id, status: "failed", note: marked.error.slice(0, 500) },
    });
    await notifyPlatformAdmin(
      `⚠️ Сбер: поступление ${amount} от ${escapeTelegramHtml(payerLine(tx))} не зачислено на баланс: ${escapeTelegramHtml(marked.error)}. Заказ №${order.id}: ${APP_URL}/root/invoices`,
      { kind: "payment", dedupeKey: `sber-credit-failed:${tx.operationId}` },
    ).catch(() => {});
    return "failed";
  }
  await db.sberIncomingPayment.update({
    where: { operationId: tx.operationId },
    data: { orderId: order.id, status: "credited" },
  });

  if (review) {
    // Пополнение само сообщило админу о деньгах; здесь — почему счёт открыт.
    await notifyPlatformAdmin(
      [
        `🔎 <b>Сбер: ${amount} зачислено на баланс, счёт №${review.orderId} не отмечен</b>`,
        `${escapeTelegramHtml(review.reason)}.`,
        `${escapeTelegramHtml(payerLine(tx))} · ${escapeTelegramHtml(tx.date.slice(0, 10))}`,
        decision.orderId
          ? `Если это оплата счёта — отметьте «Оплата поступила»: деньги второй раз не зачислятся, тариф спишется с баланса. ${APP_URL}/root/invoices`
          : `Счёт другой организации — проверьте: ${APP_URL}/root/invoices`,
      ].join("\n"),
      { kind: "payment", dedupeKey: `sber-review-credited:${tx.operationId}` },
    ).catch((error) => console.error("[sber-credit] уведомление не ушло:", error));
  }
  console.info(
    `[sber-credit] credited op=${tx.operationId} org=${decision.organizationId} rub=${decision.amount} order=${order.id} review=${decision.orderId ?? "-"}`,
  );
  return "credited";
}
