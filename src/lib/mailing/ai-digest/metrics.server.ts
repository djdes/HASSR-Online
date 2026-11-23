import { db } from "@/lib/db";
import { PAID_ORDER_STATUSES } from "@/lib/promo/service";
import { PAID_TARIFF_ORDER_WHERE } from "@/lib/signup-funnel.server";

import type { DigestMetrics, MailingWeek, SalesWeek } from "./report";
import type { ReportPeriod } from "./schedule";

/**
 * Цифры недели для ИИ-сводки: продажи (оплаты тарифов — как в воронке
 * `/root/funnel`: оплачен, не тест, без возврата, не пополнение баланса) и
 * рассылки ROOT (тесты себе не в счёт).
 */

const BALANCE_TOPUP_TARIFF = "balance_topup";

async function salesWeek(start: Date, end: Date, titles: Map<string, string>): Promise<SalesWeek> {
  const range = { gte: start, lt: end };
  const orders = await db.paymentOrder.findMany({
    where: { ...PAID_TARIFF_ORDER_WHERE, paidAt: range },
    select: {
      amountRub: true,
      tariffKey: true,
      organizationId: true,
      email: true,
      recurringChargeOf: true,
      paymentMethod: true,
      discountRub: true,
      promotionDiscountRub: true,
    },
  });
  const [topUps, refunds] = await Promise.all([
    db.paymentOrder.aggregate({
      where: { status: { in: [...PAID_ORDER_STATUSES] }, isTest: false, refundedAt: null, tariffKey: BALANCE_TOPUP_TARIFF, paidAt: range },
      _count: { _all: true },
      _sum: { amountRub: true },
    }),
    db.paymentOrder.aggregate({
      where: { isTest: false, refundedAt: range },
      _count: { _all: true },
      _sum: { amountRub: true },
    }),
  ]);

  let revenue = 0;
  let autopay = 0;
  let invoice = 0;
  let discounted = 0;
  let discountRub = 0;
  const payers = new Set<string>();
  const byTariff = new Map<string, { orders: number; revenue: number }>();
  for (const order of orders) {
    const amount = Number(order.amountRub);
    revenue += amount;
    if (order.recurringChargeOf !== null) autopay += 1;
    if (order.paymentMethod === "invoice") invoice += 1;
    const discount = order.discountRub + order.promotionDiscountRub;
    if (discount > 0) {
      discounted += 1;
      discountRub += discount;
    }
    payers.add(order.organizationId ?? `email:${order.email.toLowerCase()}`);
    const row = byTariff.get(order.tariffKey) ?? { orders: 0, revenue: 0 };
    row.orders += 1;
    row.revenue += amount;
    byTariff.set(order.tariffKey, row);
  }

  // Впервые оплатившие: у организации нет оплаты тарифа раньше этой недели.
  const orgIds = [...payers].filter((id) => !id.startsWith("email:"));
  let newPayingOrgs = 0;
  if (orgIds.length > 0) {
    const earlier = await db.paymentOrder.findMany({
      where: { ...PAID_TARIFF_ORDER_WHERE, organizationId: { in: orgIds }, paidAt: { lt: start } },
      select: { organizationId: true },
      distinct: ["organizationId"],
    });
    newPayingOrgs = orgIds.length - earlier.length;
  }

  return {
    revenue,
    orders: orders.length,
    avgCheck: orders.length > 0 ? revenue / orders.length : null,
    autopayOrders: autopay,
    invoiceOrders: invoice,
    discountedOrders: discounted,
    discountRub,
    payingOrgs: payers.size,
    newPayingOrgs,
    topUps: { count: topUps._count._all, revenue: Number(topUps._sum.amountRub ?? 0) },
    refunds: { count: refunds._count._all, revenue: Number(refunds._sum.amountRub ?? 0) },
    tariffs: [...byTariff.entries()]
      .map(([key, row]) => ({ key, title: titles.get(key) ?? key, ...row }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8),
  };
}

async function mailingWeek(start: Date, end: Date): Promise<MailingWeek> {
  const range = { gte: start, lt: end };
  const live = { isTest: false };
  const [campaigns, sent, email, inApp, push, telegram, failed, clickers, unsubscribes] = await Promise.all([
    db.mailingCampaign.findMany({
      where: { startedAt: range },
      select: { id: true, title: true },
    }),
    db.mailingRecipient.count({ where: { ...live, sentAt: range } }),
    db.mailingRecipient.count({ where: { ...live, emailSentAt: range } }),
    db.mailingRecipient.count({ where: { ...live, sentAt: range, inAppStatus: "sent" } }),
    db.mailingRecipient.count({ where: { ...live, sentAt: range, pushStatus: "sent" } }),
    db.mailingRecipient.count({ where: { ...live, sentAt: range, telegramStatus: "sent" } }),
    db.mailingRecipient.count({ where: { ...live, status: "failed", updatedAt: range } }),
    db.mailingRecipient.count({ where: { ...live, clickedAt: range } }),
    db.mailingRecipient.count({ where: { ...live, unsubscribedAt: range } }),
  ]);

  let topCampaigns: MailingWeek["topCampaigns"] = [];
  if (campaigns.length > 0) {
    const ids = campaigns.map((c) => c.id);
    const [sentBy, clickBy] = await Promise.all([
      db.mailingRecipient.groupBy({ by: ["campaignId"], where: { ...live, campaignId: { in: ids }, sentAt: { not: null } }, _count: { _all: true } }),
      db.mailingRecipient.groupBy({ by: ["campaignId"], where: { ...live, campaignId: { in: ids }, clickedAt: { not: null } }, _count: { _all: true } }),
    ]);
    const sentMap = new Map(sentBy.map((row) => [row.campaignId, row._count._all]));
    const clickMap = new Map(clickBy.map((row) => [row.campaignId, row._count._all]));
    topCampaigns = campaigns
      .map((c) => ({ title: c.title || "Без названия", sent: sentMap.get(c.id) ?? 0, clicks: clickMap.get(c.id) ?? 0 }))
      .sort((a, b) => b.sent - a.sent || b.clicks - a.clicks)
      .slice(0, 5);
  }

  return {
    campaigns: campaigns.length,
    sent,
    byChannel: { email, inApp, push, telegram },
    failed,
    clickers,
    unsubscribes,
    topCampaigns,
  };
}

/** Цифры недели и недели перед ней; конец недели — не позже `now`. */
export async function collectDigestMetrics(period: ReportPeriod, now: Date = new Date()): Promise<DigestMetrics> {
  const end = new Date(Math.min(period.end.getTime(), now.getTime() + 1));
  const tariffs = await db.platformTariff.findMany({ select: { key: true, title: true } }).catch(() => []);
  const titles = new Map(tariffs.map((t) => [t.key, t.title]));
  const [curSales, prevSales, curMail, prevMail] = await Promise.all([
    salesWeek(period.start, end, titles),
    salesWeek(period.previousStart, period.previousEnd, titles),
    mailingWeek(period.start, end),
    mailingWeek(period.previousStart, period.previousEnd),
  ]);
  return {
    periodLabel: period.label,
    previousLabel: period.previousLabel,
    current: { sales: curSales, mailings: curMail },
    previous: { sales: prevSales, mailings: prevMail },
  };
}
