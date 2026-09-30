import { Prisma } from "@prisma/client";

import { isTopupOrder } from "@/lib/balance/topup-core";
import { voidClosingDocument } from "@/lib/closing-documents/service";
import { db } from "@/lib/db";
import { hardwareTotal, normalizeHardwareConfig } from "@/lib/hardware-pricing";
import { escapeTelegramHtml, notifyEmployee } from "@/lib/telegram";

import {
  ACCRUAL_KINDS,
  buildPayoutSheet,
  computeHardwareAccrual,
  computePaymentAccruals,
  computeReversals,
  isReversalKind,
  periodMonthOf,
  previousPeriodMonth,
  roundRub,
  type AccrualDraft,
  type AccrualKind,
  type AccrualStatus,
  type RewardRule,
} from "./rewards";
import { ensurePartnerSchemaExtras, getCurrentRewardRule, toRewardRule } from "./schema-extras";
import { PartnerError } from "./errors";

/**
 * Начисления партнёрам: привязаны к платежу (`PaymentOrder`), уникальны
 * по `(paymentOrderId, kind)`, поэтому повторная обработка одного и того
 * же платежа ничего не дублирует. Оборудование начисляется отдельно —
 * после отметки ROOT «отгружено».
 */

type OrderRow = {
  id: number;
  organizationId: string | null;
  amountRub: Prisma.Decimal;
  bundleConfig: Prisma.JsonValue | null;
  paidAt: Date | null;
  shippedAt: Date | null;
  refundedAt: Date | null;
  status: string;
};

const ORDER_SELECT = {
  id: true,
  organizationId: true,
  amountRub: true,
  bundleConfig: true,
  paidAt: true,
  shippedAt: true,
  refundedAt: true,
  status: true,
  tariffKey: true,
} as const;

/** Разбивка суммы заказа: подписка = всё, что не оборудование. */
export function splitOrderAmount(order: Pick<OrderRow, "amountRub" | "bundleConfig">): {
  subscriptionRub: number;
  hardwareRub: number;
} {
  const total = Number(order.amountRub);
  const hardware = order.bundleConfig ? hardwareTotal(normalizeHardwareConfig(order.bundleConfig)) : 0;
  const hardwareRub = Math.min(Math.max(0, hardware), total);
  return { subscriptionRub: roundRub(total - hardwareRub), hardwareRub: roundRub(hardwareRub) };
}

/** Привязка, действовавшая в момент `at` (с запасом: привязка идёт сразу после оплаты). */
async function linkActiveAt(organizationId: string, at: Date) {
  const tolerance = 15 * 60 * 1000;
  return db.partnerClient.findFirst({
    where: {
      organizationId,
      attachedAt: { lte: new Date(at.getTime() + tolerance) },
      OR: [{ detachedAt: null }, { detachedAt: { gte: at } }],
      partner: { status: "active" },
    },
    orderBy: { attachedAt: "desc" },
    select: {
      id: true,
      partnerId: true,
      attachedAt: true,
      firstPaymentAt: true,
      partner: { select: { applicantUserId: true } },
    },
  });
}

async function insertDrafts(input: {
  drafts: AccrualDraft[];
  partnerId: string;
  partnerClientId: string;
  organizationId: string;
  paymentOrderId: number;
  ruleVersion: number;
  periodMonth: string;
  status?: AccrualStatus;
  reversalOf?: Map<AccrualKind, string>;
}): Promise<number> {
  let created = 0;
  for (const draft of input.drafts) {
    try {
      await db.partnerAccrual.create({
        data: {
          partnerId: input.partnerId,
          partnerClientId: input.partnerClientId,
          organizationId: input.organizationId,
          paymentOrderId: input.paymentOrderId,
          kind: draft.kind,
          baseAmountRub: new Prisma.Decimal(draft.baseAmountRub),
          ratePercent: draft.ratePercent === null ? null : new Prisma.Decimal(draft.ratePercent),
          amountRub: new Prisma.Decimal(draft.amountRub),
          status: input.status ?? "accrued",
          ruleVersion: input.ruleVersion,
          periodMonth: input.periodMonth,
          reversalOfId: input.reversalOf?.get(draft.kind) ?? null,
        },
      });
      created += 1;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
      throw error;
    }
  }
  return created;
}

/**
 * Начисления за оплаченный заказ: подписка (в окне N месяцев от первого
 * платежа клиента после привязки) и бонус за N-й платёж. Идемпотентно.
 */
export async function accrueForPaidOrder(orderId: number): Promise<{ created: number; drafts: AccrualDraft[] }> {
  await ensurePartnerSchemaExtras();
  const order = await db.paymentOrder.findUnique({ where: { id: orderId }, select: ORDER_SELECT });
  if (!order || !order.organizationId || !order.paidAt || order.status !== "paid" || order.refundedAt) {
    return { created: 0, drafts: [] };
  }
  const link = await linkActiveAt(order.organizationId, order.paidAt);
  if (!link) return { created: 0, drafts: [] };

  const { subscriptionRub } = splitOrderAmount(order);
  if (subscriptionRub <= 0) return { created: 0, drafts: [] };

  // Сколько оплаченных подписочных платежей было у клиента после привязки до этого.
  const earlier = await db.paymentOrder.findMany({
    where: {
      organizationId: order.organizationId,
      status: "paid",
      refundedAt: null,
      id: { not: order.id },
      paidAt: { gte: link.attachedAt, lt: order.paidAt },
    },
    select: { amountRub: true, bundleConfig: true, tariffKey: true },
  });
  // Бонус «за N-й платёж» считается только по оплатам подписки: пополнения
  // баланса дают процент, но не двигают счётчик и сами бонус не дают.
  const paidSubscriptionPaymentsBefore = earlier.filter(
    (o) => !isTopupOrder(o) && splitOrderAmount(o).subscriptionRub > 0,
  ).length;

  const firstPaymentAt = link.firstPaymentAt && link.firstPaymentAt < order.paidAt ? link.firstPaymentAt : null;
  if (!link.firstPaymentAt) {
    await db.partnerClient.update({ where: { id: link.id }, data: { firstPaymentAt: order.paidAt } });
  }

  const rule = await getCurrentRewardRule();
  const drafts = computePaymentAccruals(rule, {
    paidAt: order.paidAt,
    subscriptionRub,
    firstPaymentAt,
    paidSubscriptionPaymentsBefore,
    bonusEligible: !isTopupOrder(order),
  });
  const created = await insertDrafts({
    drafts,
    partnerId: link.partnerId,
    partnerClientId: link.id,
    organizationId: order.organizationId,
    paymentOrderId: order.id,
    ruleVersion: rule.version,
    periodMonth: periodMonthOf(order.paidAt),
  });
  if (created > 0) notifyPartnerAboutAccrual(link.partner.applicantUserId, order.organizationId, drafts);
  return { created, drafts };
}

/** Оборудование: начисляется после отметки ROOT «отгружено». Идемпотентно. */
export async function accrueHardwareShipped(orderId: number): Promise<{ created: number }> {
  await ensurePartnerSchemaExtras();
  const order = await db.paymentOrder.findUnique({ where: { id: orderId }, select: ORDER_SELECT });
  if (!order || !order.organizationId || !order.paidAt || !order.shippedAt || order.refundedAt) return { created: 0 };
  const { hardwareRub } = splitOrderAmount(order);
  if (hardwareRub <= 0) return { created: 0 };
  const link = await linkActiveAt(order.organizationId, order.paidAt);
  if (!link) return { created: 0 };
  const rule = await getCurrentRewardRule();
  const draft = computeHardwareAccrual(rule, hardwareRub);
  if (!draft) return { created: 0 };
  const created = await insertDrafts({
    drafts: [draft],
    partnerId: link.partnerId,
    partnerClientId: link.id,
    organizationId: order.organizationId,
    paymentOrderId: order.id,
    ruleVersion: rule.version,
    periodMonth: periodMonthOf(order.shippedAt),
  });
  if (created > 0) notifyPartnerAboutAccrual(link.partner.applicantUserId, order.organizationId, [draft]);
  return { created };
}

/**
 * Возврат платежа: на каждое положительное начисление — сторно с минусом.
 * Если оригинал ещё не выплачен, сторно ложится в тот же месяц и статус,
 * и ведомость схлопывается в ноль; если уже выплачен — минус в текущий
 * месяц, зачтётся при следующей выплате.
 */
export async function reverseOrderAccruals(orderId: number): Promise<{ created: number }> {
  const rows = await db.partnerAccrual.findMany({
    where: { paymentOrderId: orderId },
    select: {
      id: true,
      kind: true,
      baseAmountRub: true,
      ratePercent: true,
      amountRub: true,
      status: true,
      periodMonth: true,
      partnerId: true,
      partnerClientId: true,
      organizationId: true,
      ruleVersion: true,
    },
  });
  if (rows.length === 0) return { created: 0 };
  const existing = rows.map((r) => ({
    kind: r.kind as AccrualKind,
    baseAmountRub: Number(r.baseAmountRub),
    ratePercent: r.ratePercent === null ? null : Number(r.ratePercent),
    amountRub: Number(r.amountRub),
  }));
  const drafts = computeReversals(existing);
  let created = 0;
  const now = new Date();
  for (const draft of drafts) {
    const originalKind = draft.kind.replace(/_reversal$/, "") as AccrualKind;
    const original = rows.find((r) => r.kind === originalKind);
    if (!original) continue;
    const mirrored = original.status !== "paid";
    created += await insertDrafts({
      drafts: [draft],
      partnerId: original.partnerId,
      partnerClientId: original.partnerClientId,
      organizationId: original.organizationId,
      paymentOrderId: orderId,
      ruleVersion: original.ruleVersion,
      periodMonth: mirrored ? original.periodMonth : periodMonthOf(now),
      status: mirrored ? (original.status as AccrualStatus) : "accrued",
      reversalOf: new Map([[draft.kind, original.id]]),
    });
  }
  return { created };
}

function notifyPartnerAboutAccrual(userId: string, organizationId: string, drafts: AccrualDraft[]) {
  const total = roundRub(drafts.reduce((s, d) => s + d.amountRub, 0));
  if (total <= 0) return;
  db.organization
    .findUnique({ where: { id: organizationId }, select: { name: true } })
    .then((org) =>
      notifyEmployee(
        userId,
        `💰 Начислено <b>${total.toLocaleString("ru-RU", { minimumFractionDigits: 2 })} ₽</b> по клиенту ${escapeTelegramHtml(
          org?.name ?? "—",
        )}. Подробности — в разделе «Вознаграждение» партнёрского кабинета.`,
      ),
    )
    .catch((err) => console.error("partner accrual notify failed", err));
}

// ---------------------------------------------------------------------------
// ROOT: пометки на заказе
// ---------------------------------------------------------------------------

export async function markOrderShipped(orderId: number, shipped: boolean): Promise<{ created: number }> {
  const order = await db.paymentOrder.findUnique({ where: { id: orderId }, select: ORDER_SELECT });
  if (!order) throw new PartnerError("Заказ не найден", 404);
  if (order.status !== "paid") throw new PartnerError("Отметить отгрузку можно только у оплаченного заказа", 409);
  if (splitOrderAmount(order).hardwareRub <= 0) throw new PartnerError("В заказе нет оборудования", 409);
  if (!shipped) {
    if (order.shippedAt && (await db.partnerAccrual.count({ where: { paymentOrderId: orderId, kind: "hardware" } })) > 0) {
      throw new PartnerError("По отгрузке уже есть начисление — снять отметку нельзя", 409);
    }
    await db.paymentOrder.update({ where: { id: orderId }, data: { shippedAt: null } });
    return { created: 0 };
  }
  if (!order.shippedAt) {
    await db.paymentOrder.update({ where: { id: orderId }, data: { shippedAt: new Date() } });
  }
  return accrueHardwareShipped(orderId);
}

export async function markOrderRefunded(orderId: number): Promise<{ created: number }> {
  const order = await db.paymentOrder.findUnique({ where: { id: orderId }, select: ORDER_SELECT });
  if (!order) throw new PartnerError("Заказ не найден", 404);
  if (order.status !== "paid") throw new PartnerError("Возврат отмечается только у оплаченного заказа", 409);
  if (!order.refundedAt) {
    await db.paymentOrder.update({ where: { id: orderId }, data: { refundedAt: new Date() } });
  }
  // Возврат аннулирует закрывающий документ: скачать его больше нельзя.
  await voidClosingDocument(orderId).catch((error) =>
    console.error("[closing-documents] void failed", error)
  );
  return reverseOrderAccruals(orderId);
}

// ---------------------------------------------------------------------------
// Закрытие месяца и выплаты
// ---------------------------------------------------------------------------

/** 1-го числа: всё начисленное за период (и раньше) становится «к выплате». */
export async function closeMonth(period?: string): Promise<{ period: string; moved: number }> {
  const target = period ?? previousPeriodMonth(new Date());
  if (!/^\d{4}-\d{2}$/.test(target)) throw new PartnerError("Период — в формате YYYY-MM");
  if (target >= periodMonthOf(new Date())) throw new PartnerError("Закрыть можно только прошедший месяц", 409);
  const result = await db.partnerAccrual.updateMany({
    where: { status: "accrued", periodMonth: { lte: target } },
    data: { status: "payable" },
  });
  return { period: target, moved: result.count };
}

export type PayoutSheetLine = {
  partnerId: string;
  companyName: string;
  slug: string;
  payoutType: string | null;
  payoutDetails: Prisma.JsonValue | null;
  agreementSignedAt: Date | null;
  agreementNumber: string | null;
  payableRub: number;
  carryOver: boolean;
  accrualCount: number;
};

/** Ведомость: сумма «к выплате» по каждому партнёру, с признаком переноса. */
export async function buildPayoutSheetForAdmin(): Promise<{ lines: PayoutSheetLine[]; minPayoutRub: number }> {
  const rule = await getCurrentRewardRule();
  const grouped = await db.partnerAccrual.groupBy({
    by: ["partnerId"],
    where: { status: "payable" },
    _sum: { amountRub: true },
    _count: { _all: true },
  });
  if (grouped.length === 0) return { lines: [], minPayoutRub: rule.minPayoutRub };
  const partners = await db.partner.findMany({
    where: { id: { in: grouped.map((g) => g.partnerId) } },
    select: {
      id: true,
      companyName: true,
      slug: true,
      payoutType: true,
      payoutDetails: true,
      agreementSignedAt: true,
      agreementNumber: true,
    },
  });
  const byId = new Map(partners.map((p) => [p.id, p]));
  const sheet = buildPayoutSheet(
    grouped.map((g) => ({ partnerId: g.partnerId, payableRub: Number(g._sum.amountRub ?? 0) })),
    rule.minPayoutRub,
  );
  const lines: PayoutSheetLine[] = sheet.map((line) => {
    const p = byId.get(line.partnerId);
    const count = grouped.find((g) => g.partnerId === line.partnerId)?._count._all ?? 0;
    return {
      partnerId: line.partnerId,
      companyName: p?.companyName ?? "—",
      slug: p?.slug ?? "",
      payoutType: p?.payoutType ?? null,
      payoutDetails: p?.payoutDetails ?? null,
      agreementSignedAt: p?.agreementSignedAt ?? null,
      agreementNumber: p?.agreementNumber ?? null,
      payableRub: line.payableRub,
      carryOver: line.carryOver,
      accrualCount: count,
    };
  });
  return { lines, minPayoutRub: rule.minPayoutRub };
}

/** ROOT отметил выплату: все строки «к выплате» партнёра → «выплачено» с датой и номером документа. */
export async function markPartnerPaid(input: {
  partnerId: string;
  paidAt: Date;
  documentNo: string;
}): Promise<{ paidRub: number; count: number }> {
  const documentNo = input.documentNo.trim().slice(0, 64);
  if (!documentNo) throw new PartnerError("Укажите номер платёжного документа");
  if (Number.isNaN(input.paidAt.getTime())) throw new PartnerError("Некорректная дата выплаты");
  const sum = await db.partnerAccrual.aggregate({
    where: { partnerId: input.partnerId, status: "payable" },
    _sum: { amountRub: true },
    _count: { _all: true },
  });
  const paidRub = roundRub(Number(sum._sum.amountRub ?? 0));
  if (sum._count._all === 0) throw new PartnerError("У партнёра нет строк к выплате", 409);
  if (paidRub <= 0) throw new PartnerError("Сумма к выплате не положительная — выплачивать нечего", 409);
  const result = await db.partnerAccrual.updateMany({
    where: { partnerId: input.partnerId, status: "payable" },
    data: { status: "paid", paidAt: input.paidAt, paidDocumentNo: documentNo },
  });
  const partner = await db.partner.findUnique({ where: { id: input.partnerId }, select: { applicantUserId: true } });
  if (partner) {
    notifyEmployee(
      partner.applicantUserId,
      `✅ Выплата <b>${paidRub.toLocaleString("ru-RU", { minimumFractionDigits: 2 })} ₽</b> отмечена, документ № ${escapeTelegramHtml(documentNo)}.`,
    ).catch(() => undefined);
  }
  return { paidRub, count: result.count };
}

// ---------------------------------------------------------------------------
// Правила
// ---------------------------------------------------------------------------

export async function listRewardRules() {
  await ensurePartnerSchemaExtras();
  const rows = await db.partnerRewardRule.findMany({ orderBy: { version: "desc" } });
  return rows.map((row) => ({
    ...toRewardRule(row),
    id: row.id,
    effectiveFrom: row.effectiveFrom,
    comment: row.comment,
    createdAt: row.createdAt,
  }));
}

export async function createRewardRuleVersion(
  input: Omit<RewardRule, "version">,
  meta: { userId: string; comment: string },
): Promise<RewardRule> {
  const check = (v: number, min: number, max: number, label: string) => {
    if (!Number.isFinite(v) || v < min || v > max) throw new PartnerError(`${label}: допустимо от ${min} до ${max}`);
  };
  check(input.subscriptionPercent, 0, 100, "Доля подписки");
  check(input.subscriptionMonths, 0, 120, "Месяцев подписки");
  check(input.hardwarePercent, 0, 100, "Доля оборудования");
  check(input.bonusAmountRub, 0, 1_000_000, "Бонус");
  check(input.bonusAfterPayments, 1, 100, "Платёж для бонуса");
  check(input.minPayoutRub, 0, 1_000_000, "Минимальная выплата");
  const latest = await db.partnerRewardRule.findFirst({ orderBy: { version: "desc" }, select: { version: true } });
  const version = (latest?.version ?? 0) + 1;
  const row = await db.partnerRewardRule.create({
    data: {
      version,
      subscriptionPercent: new Prisma.Decimal(input.subscriptionPercent),
      subscriptionMonths: Math.floor(input.subscriptionMonths),
      hardwarePercent: new Prisma.Decimal(input.hardwarePercent),
      bonusAmountRub: new Prisma.Decimal(input.bonusAmountRub),
      bonusAfterPayments: Math.floor(input.bonusAfterPayments),
      minPayoutRub: new Prisma.Decimal(input.minPayoutRub),
      createdByUserId: meta.userId,
      comment: meta.comment.trim().slice(0, 500) || null,
    },
  });
  return toRewardRule(row);
}

// ---------------------------------------------------------------------------
// Кабинет партнёра: список начислений и итоги
// ---------------------------------------------------------------------------

export type AccrualView = {
  id: string;
  date: Date;
  organizationId: string;
  clientName: string;
  kind: AccrualKind;
  paymentOrderId: number | null;
  baseAmountRub: number;
  ratePercent: number | null;
  amountRub: number;
  status: AccrualStatus;
  periodMonth: string;
  ruleVersion: number;
  paidAt: Date | null;
  paidDocumentNo: string | null;
};

export type MonthTotal = { periodMonth: string; accrued: number; payable: number; paid: number; total: number };

export async function listAccruals(filter: {
  partnerId?: string;
  organizationId?: string;
  periodMonth?: string;
  take?: number;
}): Promise<AccrualView[]> {
  const rows = await db.partnerAccrual.findMany({
    where: {
      ...(filter.partnerId ? { partnerId: filter.partnerId } : {}),
      ...(filter.organizationId ? { organizationId: filter.organizationId } : {}),
      ...(filter.periodMonth ? { periodMonth: filter.periodMonth } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: filter.take ?? 2000,
  });
  const orgIds = Array.from(new Set(rows.map((r) => r.organizationId)));
  const orgs = orgIds.length
    ? await db.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } })
    : [];
  const names = new Map(orgs.map((o) => [o.id, o.name]));
  return rows.map((r) => ({
    id: r.id,
    date: r.createdAt,
    organizationId: r.organizationId,
    clientName: names.get(r.organizationId) ?? "Организация удалена",
    kind: (ACCRUAL_KINDS as readonly string[]).includes(r.kind) ? (r.kind as AccrualKind) : "subscription",
    paymentOrderId: r.paymentOrderId,
    baseAmountRub: Number(r.baseAmountRub),
    ratePercent: r.ratePercent === null ? null : Number(r.ratePercent),
    amountRub: Number(r.amountRub),
    status: r.status as AccrualStatus,
    periodMonth: r.periodMonth,
    ruleVersion: r.ruleVersion,
    paidAt: r.paidAt,
    paidDocumentNo: r.paidDocumentNo,
  }));
}

export function summarizeByMonth(rows: AccrualView[]): MonthTotal[] {
  const map = new Map<string, MonthTotal>();
  for (const r of rows) {
    const m = map.get(r.periodMonth) ?? { periodMonth: r.periodMonth, accrued: 0, payable: 0, paid: 0, total: 0 };
    m[r.status] = roundRub(m[r.status] + r.amountRub);
    m.total = roundRub(m.total + r.amountRub);
    map.set(r.periodMonth, m);
  }
  return Array.from(map.values()).sort((a, b) => (a.periodMonth < b.periodMonth ? 1 : -1));
}

export function summarizeBalances(rows: AccrualView[]) {
  const totals = { accrued: 0, payable: 0, paid: 0, reversed: 0 };
  for (const r of rows) {
    totals[r.status] = roundRub(totals[r.status] + r.amountRub);
    if (isReversalKind(r.kind)) totals.reversed = roundRub(totals.reversed + r.amountRub);
  }
  return totals;
}
