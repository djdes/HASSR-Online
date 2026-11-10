import { db } from "@/lib/db";
import { creditBalance } from "@/lib/balance/ledger";

const HOUR = 3600_000;
const out: string[] = [];
const log = (line: string) => { out.push(line); console.log(line); };

async function ensurePaidAccount(orgId: string, ownerEmail: string, plan: { tier: string; points: number }, endInHours: number) {
  const owner = await db.user.findUniqueOrThrow({ where: { email: ownerEmail } });
  const end = new Date(Date.now() + endInHours * HOUR);
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
  let accountId = org.accountId;
  if (!accountId) {
    const acc = await db.account.create({ data: { ownerUserId: owner.id, subscriptionPlan: plan.tier, planCycle: "month", planPoints: plan.points, subscriptionEnd: end } });
    accountId = acc.id;
  } else {
    await db.account.update({ where: { id: accountId }, data: { subscriptionPlan: plan.tier, planCycle: "month", planPoints: plan.points, subscriptionEnd: end, autoRenew: true, scheduledPlanJson: undefined } });
  }
  await db.organization.update({ where: { id: orgId }, data: { accountId, subscriptionPlan: plan.tier, subscriptionEnd: end } });
  return { accountId, end };
}

async function ledger(orgId: string, take = 6) {
  const rows = await db.balanceTransaction.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "desc" }, take });
  for (const r of rows) log(`   ${r.amount > 0 ? "+" : ""}${r.amount} [${r.kind}] ${r.description}`);
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { balanceRub: true, subscriptionEnd: true } });
  const sum = await db.balanceTransaction.aggregate({ where: { organizationId: orgId }, _sum: { amount: true } });
  log(`   balance=${org.balanceRub} ledgerSum=${sum._sum.amount} subscriptionEnd=${org.subscriptionEnd?.toISOString()}`);
}

async function main() {
  const mode = process.argv[2];
  if (mode === "setup") {
    const cafe = await ensurePaidAccount("org-cafe", "cafe-owner@local.test", { tier: "standard", points: 1 }, 30);
    const dk = await ensurePaidAccount("org-dk", "alexey@local.test", { tier: "premium", points: 3 }, 30);
    await creditBalance({ organizationId: "org-cafe", amount: 3000, kind: "manual_adjust", description: "Тестовое пополнение (проверка)" });
    log(`setup: cafe account=${cafe.accountId} end=${cafe.end.toISOString()}; dk account=${dk.accountId} end=${dk.end.toISOString()}`);
    return;
  }
  if (mode === "job") {
    const { runBillingTransitionJob } = await import("@/lib/billing.server");
    const report = await runBillingTransitionJob({});
    log(`job: autoRenewed=${report.autoRenewed} autoRenewShort=${report.autoRenewShort} failed=${report.failed}`);
    for (const r of report.results) log(`   ${r.organizationId}: ${r.action} → ${r.outcome}`);
    log("cafe ledger:"); await ledger("org-cafe");
    log("dk ledger:"); await ledger("org-dk", 3);
    const audits = await db.auditLog.findMany({ where: { action: { startsWith: "billing.auto-renew" } }, orderBy: { createdAt: "asc" }, select: { action: true, organizationId: true, details: true } });
    for (const a of audits) log(`   audit ${a.action} ${a.organizationId} ${JSON.stringify(a.details)}`);
    const bells = await db.notification.findMany({ where: { kind: { startsWith: "billing.auto-renew" } }, select: { kind: true, title: true, organizationId: true } });
    for (const n of bells) log(`   bell ${n.kind} ${n.organizationId}: ${n.title}`);
    return;
  }
  if (mode === "card") {
    // Оплата тарифа картой (как /api/payments/robokassa/create → ResultURL кассы).
    const { quoteCheckout } = await import("@/lib/plan-checkout.server");
    const { basePlanSnapshot } = await import("@/lib/plan-payment");
    const { createOrderWithPoints } = await import("@/lib/balance/checkout");
    const { settlePaidOrder } = await import("@/lib/balance/topup");
    const { completePaidOrder } = await import("@/lib/payment-fulfillment");
    const quote = await quoteCheckout({ organizationId: "org-dk", target: { tier: "premium", cycle: "month", points: 3 }, now: new Date() });
    if (!quote.ok) throw new Error(quote.error);
    const order = await createOrderWithPoints({
      organizationId: "org-dk", userId: null, email: "alexey@local.test", tariffKey: quote.tariffKey, description: quote.title,
      grossRub: quote.offer.priceRub, subscriptionRub: quote.offer.priceRub, bundleConfig: null, isTest: false, recurringConsent: false,
      partnerSlug: null, referrerOrganizationId: null, usePoints: false, points: quote.target.points, changeKind: quote.change.kind,
      creditRub: quote.change.creditRub, periodEndsAt: quote.change.periodEnd, basePlanJson: basePlanSnapshot(quote.base),
    });
    log(`card order #${order.id}: ${quote.change.kind}, ${order.amountRub} ₽`);
    const settled = await settlePaidOrder({ orderId: order.id, rawResult: { local: "check" } });
    log(`settled claimed=${settled.claimed}`);
    const stored = await db.paymentOrder.findUniqueOrThrow({ where: { id: order.id } });
    await completePaidOrder(stored);
    // Повтор — ни одной лишней строки.
    const { recordPaymentThroughBalance } = await import("@/lib/balance/payment-ledger");
    log(`repeat pass-through: ${(await recordPaymentThroughBalance(order.id)).status}`);
    log("dk ledger after card payment:"); await ledger("org-dk", 4);
    return;
  }
  if (mode === "topup") {
    // Срок снова на исходе, денег не хватало; пополнили — продлевается сразу.
    await ensurePaidAccount("org-dk", "alexey@local.test", { tier: "premium", points: 3 }, 20);
    await creditBalance({ organizationId: "org-dk", amount: 6000, kind: "topup", description: "Пополнение картой (проверка)" });
    const { tryAutoRenewForOrganization } = await import("@/lib/balance/auto-renew.server");
    const outcome = await tryAutoRenewForOrganization("org-dk");
    log(`after top-up: ${JSON.stringify(outcome)}`);
    log("dk ledger:"); await ledger("org-dk", 3);
    return;
  }
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
