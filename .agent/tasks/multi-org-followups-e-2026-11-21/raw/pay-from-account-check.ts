/*
 * Series E, AC9 (items 9–10): pay the tariff from the balances of the account's organizations.
 * Local DB, lib level (the functions behind POST /api/settings/subscription/account-pay and its
 * `?preview=1`), the same helpers and style as scripts/e2e/balance-check.ts.
 *
 *   • active organization short, others enough → transfers of the missing amount, largest balance
 *     first, then the normal pay-from-balance; balances and history rows add up; plan, points and
 *     subscriptionEnd end up exactly as after the existing pay-from-balance (a twin account paid
 *     through createOrderWithPoints + completePaidOrder, the /order path);
 *   • the same idempotency key again (sequential and 3 in parallel) → no second transfer or charge;
 *   • a charge or a transfer failing after transfers (a temporary DB trigger) → money stays on the
 *     active organization, the transfers are in the history; repeating with the key finishes the
 *     payment without transferring twice;
 *   • the account total short → refused, nothing moved; the active organization covers alone → no
 *     transfers; price changed → refused, nothing moved;
 *   • not the owner (a manager, the same manager as network manager, another account's owner) → 403;
 *   • reminder about an organization's own 14 days (Р9): the sentence «хватает …» in the letter and the
 *     bell only when the account's balances cover one more point.
 *
 * Run: npx tsx .agent/tasks/multi-org-followups-e-2026-11-21/raw/pay-from-account-check.ts
 */
import "../../../../scripts/e2e/env";

import { db } from "@/lib/db";
import { accountPayChargeKey, accountPayTransferKey, showAccountCollect } from "@/lib/balance/account-pay";
import {
  AccountPayError,
  accountPayHint,
  addPointAccountCover,
  payFromAccountBalances,
  previewAccountPayment,
} from "@/lib/balance/account-pay.server";
import { transferDedupeKeys } from "@/lib/balance/account-transfer";
import { createOrderWithPoints } from "@/lib/balance/checkout";
import { creditBalance, listTransactions } from "@/lib/balance/ledger";
import { AUDIT_ACTIONS, runBillingTransitionJob } from "@/lib/billing.server";
import { completePaidOrder } from "@/lib/payment-fulfillment";
import { basePlanSnapshot } from "@/lib/plan-payment";
import { accountSubscription, quoteCheckout, type CheckoutTarget } from "@/lib/plan-checkout.server";
import { resolveCheckoutDiscount } from "@/lib/promo/checkout";
import { computeCheckoutAmounts } from "@/lib/promo/promotions";

const TAG = `paychk${Date.now().toString(36)}`;
const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = new Date();
const PAST = new Date(NOW.getTime() - 40 * DAY);
const END = new Date(NOW.getTime() + 20 * DAY);
const orgIds: string[] = [];
const accountIds: string[] = [];
const triggers: string[] = [];
const starts = new Map<string, number>();
let failed = 0;
let passed = 0;

/* Письма в dev не уходят, а пишутся в журнал — перехватываем; остальной info-шум глушим. */
const mailLog: string[] = [];
console.info = (...args: unknown[]) => {
  const line = args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ");
  if (line.startsWith("[email/dev]")) mailLog.push(line);
};
/** Письма об организации в перехваченных строках: тема и текст. */
function mailsAbout(lines: readonly string[], name: string): Array<{ subject: string; body: string }> {
  const letters: Array<{ subject: string; body: string }> = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].startsWith("[email/dev] Subject:") || !lines[i].includes(name)) continue;
    const body = lines.slice(i + 1, i + 4).find((line) => line.startsWith("[email/dev] Body:")) ?? "";
    letters.push({ subject: lines[i].slice("[email/dev] Subject: ".length), body });
  }
  return letters;
}

function check(label: string, ok: boolean, extra?: unknown) {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${!ok && extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
}

async function refusal(run: () => Promise<unknown>): Promise<AccountPayError | null> {
  try {
    await run();
    return null;
  } catch (error) {
    if (error instanceof AccountPayError) return error;
    throw error;
  }
}

const balanceOf = async (id: string) => (await db.organization.findUniqueOrThrow({ where: { id }, select: { balanceRub: true } })).balanceRub;
const key = () => crypto.randomUUID();
const ledgerCount = (ids: string[]) => db.balanceTransaction.count({ where: { organizationId: { in: ids } } });

async function org(name: string, data: Record<string, unknown> = {}) {
  const created = await db.organization.create({ data: { name: `${name} ${TAG}`, type: "restaurant", createdAt: PAST, ...data } });
  orgIds.push(created.id);
  starts.set(created.id, (data.balanceRub as number | undefined) ?? 0);
  return created;
}

/** Баланс ровно `target` — корректировкой через леджер (инвариант «баланс = сумма строк» сохраняется). */
async function setBalance(id: string, target: number) {
  const delta = target - (await balanceOf(id));
  if (delta !== 0) await creditBalance({ organizationId: id, amount: delta, kind: "manual_adjust", description: `e2e ${TAG}` });
}

/**
 * Аккаунт «Стандарт, месяц» до END: активная организация, ещё три рабочих, демо, мастер-кабинет и
 * организация, удаление которой запрошено. Оплачено столько точек, сколько в работе — оплата «продление».
 */
async function network(label: string) {
  const active = await org(`${label} Активная`);
  const owner = await db.user.create({
    data: { email: `${TAG}-${label}@example.test`, name: `Владелец ${label}`, passwordHash: "x", role: "owner", organizationId: active.id },
  });
  const account = await db.account.create({
    data: { ownerUserId: owner.id, createdAt: PAST, subscriptionPlan: "standard", subscriptionEnd: END, planCycle: "month", planPoints: 1 },
  });
  accountIds.push(account.id);
  await db.organization.update({ where: { id: active.id }, data: { accountId: account.id } });
  const big = await org(`${label} Большая`, { accountId: account.id });
  const mid = await org(`${label} Средняя`, { accountId: account.id });
  const small = await org(`${label} Малая`, { accountId: account.id });
  const demo = await org(`${label} Демо`, { accountId: account.id, isDemo: true });
  const cabinet = await org(`${label} Кабинет`, { accountId: account.id, kind: "directory" });
  const closing = await org(`${label} Закрывается`, { accountId: account.id, deletionRequestedAt: NOW });
  const subscription = await accountSubscription(active.id, NOW);
  await db.account.update({ where: { id: account.id }, data: { planPoints: subscription.pointsInUse } });
  return { label, owner, account, active, big, mid, small, demo, cabinet, closing, points: subscription.pointsInUse };
}

/** Цена так, как её считает оплата на странице заказа (`/api/payments/robokassa/create`). */
async function routePrice(organizationId: string, email: string, target: CheckoutTarget) {
  const quote = await quoteCheckout({ organizationId, target, now: NOW });
  if (!quote.ok) throw new Error(`quote refused: ${quote.code} ${quote.error}`);
  const discount = await resolveCheckoutDiscount({ promoRaw: "", organizationId, email, offerRub: quote.offer.priceRub, now: NOW, scope: "e2e" });
  if (!discount.ok) throw new Error(`discount refused: ${discount.message}`);
  const applied = discount.applied;
  const amounts = computeCheckoutAmounts({
    baseRub: quote.offer.baseRub,
    promotion: quote.offer.promotion,
    promo: applied ? { kind: applied.kind, value: applied.value } : null,
  });
  return { quote, applied, amounts };
}

async function addTrigger(name: string, kind: string, organizationId: string) {
  triggers.push(name);
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION ${name}() RETURNS trigger AS $$ BEGIN
       IF NEW."kind" = '${kind}' AND NEW."organizationId" = '${organizationId}' THEN RAISE EXCEPTION 'e2e: ${kind} blocked'; END IF;
       RETURN NEW;
     END $$ LANGUAGE plpgsql`,
  );
  await db.$executeRawUnsafe(`CREATE TRIGGER ${name} BEFORE INSERT ON "BalanceTransaction" FOR EACH ROW EXECUTE FUNCTION ${name}()`);
}

async function dropTrigger(name: string) {
  await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name} ON "BalanceTransaction"`);
  await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${name}()`);
  triggers.splice(triggers.indexOf(name), 1);
}

async function main() {
  const m = await network("M");
  const target: CheckoutTarget = { tier: "standard", cycle: "month", points: m.points };
  const { quote, applied, amounts } = await routePrice(m.active.id, m.owner.email, target);
  const P = amounts.grossRub;
  console.log(`price: ${P} ₽ (${quote.change.kind}, ${m.points} points, promotion ${quote.offer.promotion?.id ?? "none"}, discount ${applied?.code ?? "none"})`);
  check("setup: renewal of the paid plan, price > 0", quote.change.kind === "renew" && P > 100, { kind: quote.change.kind, P });

  const a = Math.floor(P * 0.2);
  const bigRub = Math.ceil(P * 0.5);
  const midRub = Math.ceil(P * 0.4);
  const smallRub = Math.ceil(P * 0.3);
  for (const [row, rub] of [[m.active, a], [m.big, bigRub], [m.mid, midRub], [m.small, smallRub], [m.demo, 999_999], [m.cabinet, 888_888], [m.closing, 777_777]] as const) {
    await setBalance(row.id, rub);
  }
  const working = [m.active.id, m.big.id, m.mid.id, m.small.id];
  const excluded = [m.demo.id, m.cabinet.id, m.closing.id];
  const totalBefore = a + bigRub + midRub + smallRub;
  const missing = P - a;
  const midTake = missing - bigRub;

  // --- page hint and preview
  const hint = await accountPayHint(m.owner.id, m.active.id);
  check("page hint for the owner: active balance and account total without demo, cabinet and deleting", hint?.activeBalanceRub === a && hint.accountTotalRub === totalBefore, hint);
  check("button shown: active short, account enough", hint !== null && showAccountCollect({ payRub: P, activeBalanceRub: hint.activeBalanceRub, accountTotalRub: hint.accountTotalRub }));
  const preview = await previewAccountPayment({ ownerUserId: m.owner.id, activeOrganizationId: m.active.id, target, now: NOW });
  check("preview: price equals the /order pay-from-balance price", preview.priceRub === P, preview.priceRub);
  check("preview: active balance, missing, account total, canPay", preview.activeBalanceRub === a && preview.missingRub === missing && preview.accountTotalRub === totalBefore && preview.canPay, preview);
  check(
    "preview: sources largest first, exact sum, no overdraw (Большая all, Средняя the rest)",
    JSON.stringify(preview.sources) === JSON.stringify([
      { orgId: m.big.id, name: m.big.name, amountRub: bigRub },
      { orgId: m.mid.id, name: m.mid.name, amountRub: midTake },
    ]) && preview.sources.reduce((s, r) => s + r.amountRub, 0) === missing,
    preview.sources,
  );
  check("preview moved nothing", (await balanceOf(m.active.id)) === a && (await balanceOf(m.big.id)) === bigRub);

  // --- not the owner
  const manager = await db.user.create({ data: { email: `${TAG}-manager@example.test`, name: "Управляющий", passwordHash: "x", role: "manager", organizationId: m.active.id } });
  const rowsBeforeRefusals = await ledgerCount([...working, ...excluded]);
  const managerPreview = await refusal(() => previewAccountPayment({ ownerUserId: manager.id, activeOrganizationId: m.active.id, target, now: NOW }));
  const managerPay = await refusal(() => payFromAccountBalances({ ownerUserId: manager.id, activeOrganizationId: m.active.id, target, idempotencyKey: key(), now: NOW }));
  check("manager (not the owner): preview and pay → 403 not_owner", managerPreview?.status === 403 && managerPreview.code === "not_owner" && managerPay?.status === 403 && managerPay.code === "not_owner", [managerPreview?.code, managerPay?.code]);
  check("manager: no page hint", (await accountPayHint(manager.id, m.active.id)) === null);
  const networkModel = (db as unknown as { accountNetworkManager?: { create(args: unknown): Promise<unknown> } }).accountNetworkManager;
  if (networkModel) {
    await networkModel.create({ data: { accountId: m.account.id, userId: manager.id, grantedByUserId: m.owner.id } });
    const nmPreview = await refusal(() => previewAccountPayment({ ownerUserId: manager.id, activeOrganizationId: m.active.id, target, now: NOW }));
    const nmPay = await refusal(() => payFromAccountBalances({ ownerUserId: manager.id, activeOrganizationId: m.active.id, target, idempotencyKey: key(), now: NOW }));
    check("network manager of this account: preview and pay still → 403 (tariff and payment — owner only)", nmPreview?.status === 403 && nmPay?.status === 403, [nmPreview?.code, nmPay?.code]);
  } else {
    console.log("SKIP network manager rows: model not in the Prisma client");
  }
  const foreignOrg = await org("F Чужая", { balanceRub: 0 });
  const foreignOwner = await db.user.create({ data: { email: `${TAG}-foreign@example.test`, name: "Чужой", passwordHash: "x", role: "owner", organizationId: foreignOrg.id } });
  const foreignAccount = await db.account.create({ data: { ownerUserId: foreignOwner.id } });
  accountIds.push(foreignAccount.id);
  await db.organization.update({ where: { id: foreignOrg.id }, data: { accountId: foreignAccount.id } });
  const foreignHere = await refusal(() => payFromAccountBalances({ ownerUserId: foreignOwner.id, activeOrganizationId: m.active.id, target, idempotencyKey: key(), now: NOW }));
  const ownerThere = await refusal(() => payFromAccountBalances({ ownerUserId: m.owner.id, activeOrganizationId: foreignOrg.id, target, idempotencyKey: key(), now: NOW }));
  check("another account's owner, active here → 403; owner with a foreign active org → 403", foreignHere?.status === 403 && ownerThere?.status === 403, [foreignHere?.code, ownerThere?.code]);
  check("refusals moved nothing (no ledger rows, balances as set)", (await ledgerCount([...working, ...excluded])) === rowsBeforeRefusals && (await balanceOf(m.active.id)) === a && (await balanceOf(m.big.id)) === bigRub);

  // --- price changed since the confirmation
  const changed = await refusal(() => payFromAccountBalances({ ownerUserId: m.owner.id, activeOrganizationId: m.active.id, target, idempotencyKey: key(), expectedPriceRub: P + 1, now: NOW }));
  check("expected price differs → 409 price_changed with the new price, nothing moved", changed?.status === 409 && changed.code === "price_changed" && changed.params?.priceRub === P && (await ledgerCount([...working, ...excluded])) === rowsBeforeRefusals, changed && { code: changed.code, params: changed.params });

  // --- collect and pay
  const K1 = key();
  const ordersBefore = await db.paymentOrder.count({ where: { organizationId: m.active.id } });
  const paid = await payFromAccountBalances({ ownerUserId: m.owner.id, actorName: "Владелец", activeOrganizationId: m.active.id, target, idempotencyKey: K1, expectedPriceRub: P, now: NOW, ipAddress: "127.0.0.1" });
  check("pay: status paid with the price", paid.status === "paid" && paid.priceRub === P, paid);
  const transfers = paid.status === "paid" ? paid.transfers : [];
  check(
    "pay: transfers Большая → Средняя (largest first), amounts as planned, not duplicates",
    transfers.length === 2 && transfers[0].orgId === m.big.id && transfers[0].amountRub === bigRub && transfers[1].orgId === m.mid.id && transfers[1].amountRub === midTake && transfers.every((row) => !row.duplicate),
    transfers,
  );
  check("balances: active a + missing − price = 0", (await balanceOf(m.active.id)) === 0);
  check("balances: Большая → 0, Средняя − the rest, Малая untouched", (await balanceOf(m.big.id)) === 0 && (await balanceOf(m.mid.id)) === midRub - midTake && (await balanceOf(m.small.id)) === smallRub);
  check("demo, master cabinet and the deleting organization untouched", (await balanceOf(m.demo.id)) === 999_999 && (await balanceOf(m.cabinet.id)) === 888_888 && (await balanceOf(m.closing.id)) === 777_777);
  const totalAfter = (await Promise.all(working.map(balanceOf))).reduce((s, v) => s + v, 0);
  check("account total went down by exactly the price", totalBefore - totalAfter === P, { totalBefore, totalAfter, P });

  const orderId = paid.status === "paid" ? paid.orderId : -1;
  const chargeRow = await db.balanceTransaction.findUnique({ where: { dedupeKey: accountPayChargeKey(m.account.id, K1) } });
  check("history: one «Оплата тарифа» −price on the active organization, tied to the order", chargeRow?.organizationId === m.active.id && chargeRow.kind === "subscription_charge" && chargeRow.amount === -P && chargeRow.paymentOrderId === orderId && chargeRow.actorUserId === m.owner.id, chargeRow);
  for (const [source, rub] of [[m.big, bigRub], [m.mid, midTake]] as const) {
    const keys = transferDedupeKeys(m.account.id, accountPayTransferKey(K1, source.id));
    const rows = await db.balanceTransaction.findMany({ where: { dedupeKey: { in: [keys.out, keys.in] } } });
    const out = rows.find((row) => row.dedupeKey === keys.out);
    const incoming = rows.find((row) => row.dedupeKey === keys.in);
    check(
      `history: transfer_out −${rub} on ${source.name.split(" ")[1]}, transfer_in +${rub} on the active, comment «сбор на оплату тарифа»`,
      out?.organizationId === source.id && out.amount === -rub && out.kind === "transfer_out" && incoming?.organizationId === m.active.id && incoming.amount === rub && incoming.kind === "transfer_in" && incoming.description.includes("сбор на оплату тарифа"),
      rows.map((row) => [row.organizationId === source.id ? "src" : "active", row.kind, row.amount, row.description]),
    );
  }
  const shownHistory = await listTransactions(m.active.id);
  check("history list of the active organization shows the two transfers in and the charge", shownHistory.filter((row) => row.kind === "transfer_in").length === 2 && shownHistory.some((row) => row.kind === "subscription_charge" && row.kindLabel === "Оплата тарифа"));
  const order = await db.paymentOrder.findUnique({ where: { id: orderId } });
  check(
    "order: paid from balance (amount 0, pointsSpent = price), renew of the chosen points, marked accountCollect",
    order?.status === "paid" && Number(order.amountRub) === 0 && order.pointsSpent === P && order.points === m.points && order.changeKind === "renew" && order.tariffKey === quote.tariffKey && (order.rawResult as { accountCollect?: boolean } | null)?.accountCollect === true,
    order && { status: order.status, amountRub: Number(order.amountRub), pointsSpent: order.pointsSpent, points: order.points, changeKind: order.changeKind, rawResult: order.rawResult },
  );
  check("one new order for the active organization", (await db.paymentOrder.count({ where: { organizationId: m.active.id } })) === ordersBefore + 1);
  const payAudit = await db.auditLog.findMany({ where: { organizationId: m.active.id, action: "billing.account_pay" } });
  const transferAudit = await db.auditLog.count({ where: { action: "balance.transfer", organizationId: { in: [m.active.id, m.big.id, m.mid.id] } } });
  check("audit: billing.account_pay with the order and transfers; balance.transfer in both organizations of each transfer", payAudit.length === 1 && (payAudit[0].details as { orderId?: number }).orderId === orderId && transferAudit === 4, { pay: payAudit.length, transferAudit });

  // --- the plan and dates — exactly as the existing pay-from-balance (/order path) on a twin account
  const twin = await network("T");
  for (const [row, rub] of [[twin.active, P], [twin.big, 0], [twin.mid, 0], [twin.small, 0]] as const) await setBalance(row.id, rub);
  const twinPrice = await routePrice(twin.active.id, twin.owner.email, target);
  const twinOrder = await createOrderWithPoints({
    organizationId: twin.active.id,
    userId: twin.owner.id,
    email: twin.owner.email,
    tariffKey: twinPrice.quote.tariffKey,
    description: "e2e twin",
    grossRub: twinPrice.amounts.grossRub,
    subscriptionRub: twinPrice.amounts.subscriptionRub,
    baseRub: twinPrice.amounts.baseRub,
    promotionId: twinPrice.quote.offer.promotion?.id ?? null,
    promotionPercent: twinPrice.quote.offer.promotion?.percent ?? null,
    promotionDiscountRub: twinPrice.amounts.promotionDiscountRub,
    bundleConfig: null,
    points: twinPrice.quote.target.points,
    changeKind: twinPrice.quote.change.kind,
    creditRub: twinPrice.quote.change.creditRub,
    periodEndsAt: twinPrice.quote.change.periodEnd,
    basePlanJson: basePlanSnapshot(twinPrice.quote.base),
    isTest: false,
    recurringConsent: false,
    partnerSlug: null,
    referrerOrganizationId: null,
    usePoints: true,
  });
  const storedTwin = await db.paymentOrder.findUniqueOrThrow({ where: { id: twinOrder.id } });
  await completePaidOrder(storedTwin);
  check("twin: the /order path paid fully by points with the same price", twinOrder.paidByPoints && twinOrder.pointsSpent === P && twinPrice.amounts.grossRub === P, twinOrder);
  const pick = (row: { subscriptionPlan: string; planCycle: string | null; planPoints: number; subscriptionEnd: Date | null }) => ({
    plan: row.subscriptionPlan,
    cycle: row.planCycle,
    points: row.planPoints,
    end: row.subscriptionEnd?.toISOString() ?? null,
  });
  const mineAccount = pick(await db.account.findUniqueOrThrow({ where: { id: m.account.id } }));
  const twinAccount = pick(await db.account.findUniqueOrThrow({ where: { id: twin.account.id } }));
  check("account plan, cycle, points and subscriptionEnd — identical to the /order pay-from-balance", JSON.stringify(mineAccount) === JSON.stringify(twinAccount), { mine: mineAccount, twin: twinAccount });
  check("subscriptionEnd moved from END by one month (renewal)", mineAccount.end === quote.change.periodEnd.toISOString() && mineAccount.end !== END.toISOString(), { end: mineAccount.end, expected: quote.change.periodEnd.toISOString() });
  const mineOrg = await db.organization.findUniqueOrThrow({ where: { id: m.active.id }, select: { subscriptionPlan: true, subscriptionEnd: true } });
  const twinOrg = await db.organization.findUniqueOrThrow({ where: { id: twin.active.id }, select: { subscriptionPlan: true, subscriptionEnd: true } });
  check("active organization plan and end — identical to the twin", mineOrg.subscriptionPlan === twinOrg.subscriptionPlan && mineOrg.subscriptionEnd?.getTime() === twinOrg.subscriptionEnd?.getTime(), { mineOrg, twinOrg });

  // --- the same key again
  const rowsAfterPay = await ledgerCount([...working, ...excluded]);
  const again = await payFromAccountBalances({ ownerUserId: m.owner.id, activeOrganizationId: m.active.id, target, idempotencyKey: K1, expectedPriceRub: P, now: NOW });
  check("same key again → already, the same order", again.status === "already" && again.orderId === orderId, again);
  check("same key again: no new ledger rows, no new order, balances unchanged", (await ledgerCount([...working, ...excluded])) === rowsAfterPay && (await db.paymentOrder.count({ where: { organizationId: m.active.id } })) === ordersBefore + 1 && (await balanceOf(m.active.id)) === 0 && (await balanceOf(m.mid.id)) === midRub - midTake);

  // --- three parallel requests with one key (double click, retry after a network error)
  const P2 = (await previewAccountPayment({ ownerUserId: m.owner.id, activeOrganizationId: m.active.id, target, now: NOW })).priceRub;
  for (const [row, rub] of [[m.active, a], [m.big, bigRub], [m.mid, midRub], [m.small, smallRub]] as const) await setBalance(row.id, rub);
  const K2 = key();
  const rowsBeforeParallel = await ledgerCount(working);
  const endBeforeParallel = (await db.account.findUniqueOrThrow({ where: { id: m.account.id } })).subscriptionEnd;
  const parallel = await Promise.allSettled([0, 1, 2].map(() => payFromAccountBalances({ ownerUserId: m.owner.id, activeOrganizationId: m.active.id, target, idempotencyKey: K2, expectedPriceRub: P2, now: NOW })));
  const statuses = parallel.map((item) => (item.status === "fulfilled" ? item.value.status : `error:${item.reason instanceof AccountPayError ? item.reason.code : String(item.reason).slice(0, 80)}`));
  check("parallel ×3 with one key: exactly one paid, the others «already»", statuses.filter((s) => s === "paid").length === 1 && statuses.filter((s) => s === "already").length === 2, statuses);
  check("parallel: one charge row, one transfer pair per source", (await db.balanceTransaction.count({ where: { dedupeKey: accountPayChargeKey(m.account.id, K2) } })) === 1 && (await ledgerCount(working)) - rowsBeforeParallel === 5, (await ledgerCount(working)) - rowsBeforeParallel);
  check("parallel: balances as after one payment", (await balanceOf(m.active.id)) === a + (P2 - a) - P2 && (await balanceOf(m.big.id)) === 0 && (await balanceOf(m.small.id)) === smallRub);
  const endAfterParallel = (await db.account.findUniqueOrThrow({ where: { id: m.account.id } })).subscriptionEnd;
  check("parallel: subscription extended once (one more month)", Boolean(endBeforeParallel && endAfterParallel && Math.round((endAfterParallel.getTime() - endBeforeParallel.getTime()) / DAY) >= 28 && Math.round((endAfterParallel.getTime() - endBeforeParallel.getTime()) / DAY) <= 31), { endBeforeParallel, endAfterParallel });

  // --- the charge fails after the transfers: money stays on the active organization; repeat finishes
  const P3 = (await previewAccountPayment({ ownerUserId: m.owner.id, activeOrganizationId: m.active.id, target, now: NOW })).priceRub;
  for (const [row, rub] of [[m.active, a], [m.big, bigRub], [m.mid, midRub], [m.small, smallRub]] as const) await setBalance(row.id, rub);
  const endBeforeFail = (await db.account.findUniqueOrThrow({ where: { id: m.account.id } })).subscriptionEnd?.toISOString();
  const ordersBeforeFail = await db.paymentOrder.count({ where: { organizationId: m.active.id } });
  const chargeTrigger = `e2e_block_charge_${TAG}`;
  await addTrigger(chargeTrigger, "subscription_charge", m.active.id);
  const K3 = key();
  const chargeFailed = await refusal(() => payFromAccountBalances({ ownerUserId: m.owner.id, activeOrganizationId: m.active.id, target, idempotencyKey: K3, expectedPriceRub: P3, now: NOW }));
  await dropTrigger(chargeTrigger);
  check("charge fails after transfers → 409 charge_failed with what was moved and where", chargeFailed?.status === 409 && chargeFailed.code === "charge_failed" && chargeFailed.params?.movedRub === P3 - a && chargeFailed.params?.activeName === m.active.name, chargeFailed && { code: chargeFailed.code, params: chargeFailed.params, message: chargeFailed.message });
  console.log(`  message: ${chargeFailed?.message}`);
  check("charge failed: the collected money stays on the active organization (= price), sources drained as planned", (await balanceOf(m.active.id)) === P3 && (await balanceOf(m.big.id)) === 0 && (await balanceOf(m.mid.id)) === midRub - (P3 - a - bigRub));
  check("charge failed: no order, no charge row, subscription unchanged", (await db.paymentOrder.count({ where: { organizationId: m.active.id } })) === ordersBeforeFail && (await db.balanceTransaction.count({ where: { dedupeKey: accountPayChargeKey(m.account.id, K3) } })) === 0 && (await db.account.findUniqueOrThrow({ where: { id: m.account.id } })).subscriptionEnd?.toISOString() === endBeforeFail);
  check("charge failed: both transfers are in the history of the active organization", (await db.balanceTransaction.count({ where: { organizationId: m.active.id, kind: "transfer_in", dedupeKey: { in: [m.big.id, m.mid.id].map((id) => transferDedupeKeys(m.account.id, accountPayTransferKey(K3, id)).in) } } })) === 2);
  const retried = await payFromAccountBalances({ ownerUserId: m.owner.id, activeOrganizationId: m.active.id, target, idempotencyKey: K3, expectedPriceRub: P3, now: NOW });
  check("repeat with the same key: paid without new transfers", retried.status === "paid" && retried.transfers.length === 0, retried);
  check("repeat: active 0, sources not touched again, exactly one transfer pair per source for the key", (await balanceOf(m.active.id)) === 0 && (await balanceOf(m.big.id)) === 0 && (await db.balanceTransaction.count({ where: { dedupeKey: { in: [m.big.id, m.mid.id].flatMap((id) => Object.values(transferDedupeKeys(m.account.id, accountPayTransferKey(K3, id)))) } } })) === 4);

  // --- a transfer fails half-way: the first transfer stays; repeat does not transfer from it again
  const P4 = (await previewAccountPayment({ ownerUserId: m.owner.id, activeOrganizationId: m.active.id, target, now: NOW })).priceRub;
  for (const [row, rub] of [[m.active, a], [m.big, bigRub], [m.mid, midRub], [m.small, smallRub]] as const) await setBalance(row.id, rub);
  const transferTrigger = `e2e_block_mid_${TAG}`;
  await addTrigger(transferTrigger, "transfer_out", m.mid.id);
  const K4 = key();
  const transferFailed = await refusal(() => payFromAccountBalances({ ownerUserId: m.owner.id, activeOrganizationId: m.active.id, target, idempotencyKey: K4, expectedPriceRub: P4, now: NOW }));
  await dropTrigger(transferTrigger);
  check("second transfer fails → 409 transfer_failed naming the source, with the amount already moved", transferFailed?.status === 409 && transferFailed.code === "transfer_failed" && transferFailed.params?.sourceName === m.mid.name && transferFailed.params?.movedRub === bigRub, transferFailed && { code: transferFailed.code, params: transferFailed.params });
  console.log(`  message: ${transferFailed?.message}`);
  check("transfer failed: Большая's money is on the active organization, Средняя untouched, nothing charged", (await balanceOf(m.active.id)) === a + bigRub && (await balanceOf(m.big.id)) === 0 && (await balanceOf(m.mid.id)) === midRub && (await db.balanceTransaction.count({ where: { dedupeKey: accountPayChargeKey(m.account.id, K4) } })) === 0);
  const finished = await payFromAccountBalances({ ownerUserId: m.owner.id, activeOrganizationId: m.active.id, target, idempotencyKey: K4, expectedPriceRub: P4, now: NOW });
  check("repeat: paid, only Средняя transferred now", finished.status === "paid" && finished.transfers.length === 1 && finished.transfers[0].orgId === m.mid.id && finished.transfers[0].amountRub === P4 - a - bigRub, finished);
  check(
    "repeat: Большая transferred exactly once for the key, active 0",
    (await db.balanceTransaction.count({ where: { dedupeKey: { in: Object.values(transferDedupeKeys(m.account.id, accountPayTransferKey(K4, m.big.id))) } } })) === 2 && (await balanceOf(m.active.id)) === 0,
  );

  // --- the active organization covers alone: no transfers
  const P5 = (await previewAccountPayment({ ownerUserId: m.owner.id, activeOrganizationId: m.active.id, target, now: NOW })).priceRub;
  for (const [row, rub] of [[m.active, P5 + 50], [m.big, bigRub], [m.mid, midRub], [m.small, smallRub]] as const) await setBalance(row.id, rub);
  check("active covers: no button", !showAccountCollect({ payRub: P5, activeBalanceRub: P5 + 50, accountTotalRub: P5 + 50 + bigRub + midRub + smallRub }));
  const alone = await payFromAccountBalances({ ownerUserId: m.owner.id, activeOrganizationId: m.active.id, target, idempotencyKey: key(), expectedPriceRub: P5, now: NOW });
  check("active covers alone: paid, no transfers, active −price, others unchanged", alone.status === "paid" && alone.transfers.length === 0 && (await balanceOf(m.active.id)) === 50 && (await balanceOf(m.big.id)) === bigRub && (await balanceOf(m.mid.id)) === midRub && (await balanceOf(m.small.id)) === smallRub, alone);

  // --- the account total is short: refused, nothing moved
  const P6 = (await previewAccountPayment({ ownerUserId: m.owner.id, activeOrganizationId: m.active.id, target, now: NOW })).priceRub;
  for (const [row, rub] of [[m.active, 100], [m.big, 100], [m.mid, 100], [m.small, 100]] as const) await setBalance(row.id, rub);
  const shortPreview = await previewAccountPayment({ ownerUserId: m.owner.id, activeOrganizationId: m.active.id, target, now: NOW });
  check("account short: preview canPay false, no sources", !shortPreview.canPay && shortPreview.sources.length === 0 && shortPreview.accountTotalRub === 400, shortPreview);
  check("account short: no button", !showAccountCollect({ payRub: P6, activeBalanceRub: 100, accountTotalRub: 400 }));
  const rowsBeforeShort = await ledgerCount([...working, ...excluded]);
  const ordersBeforeShort = await db.paymentOrder.count({ where: { organizationId: m.active.id } });
  const short = await refusal(() => payFromAccountBalances({ ownerUserId: m.owner.id, activeOrganizationId: m.active.id, target, idempotencyKey: key(), expectedPriceRub: P6, now: NOW }));
  check("account short → 409 account_short with how much is missing", short?.status === 409 && short.code === "account_short" && short.params?.shortRub === P6 - 400, short && { code: short.code, params: short.params });
  check("account short: nothing moved, no order (deleting/demo/cabinet money is not counted)", (await ledgerCount([...working, ...excluded])) === rowsBeforeShort && (await db.paymentOrder.count({ where: { organizationId: m.active.id } })) === ordersBeforeShort && (await balanceOf(m.closing.id)) === 777_777);

  // --- ledger invariant: balance = start + sum of ledger rows
  for (const id of [...working, ...excluded, ...[twin.active.id, twin.big.id]]) {
    const sum = await db.balanceTransaction.aggregate({ where: { organizationId: id }, _sum: { amount: true } });
    check(`ledger invariant for ${(await db.organization.findUniqueOrThrow({ where: { id }, select: { name: true } })).name.replace(` ${TAG}`, "")}`, (await balanceOf(id)) === (starts.get(id) ?? 0) + (sum._sum.amount ?? 0));
  }

  // --- reminder (Р9): «хватает» only when the account covers one more point
  await reminders();
}

/** Организация во «своих 14 днях» на оплаченном аккаунте: за 3 дня до конца — письмо и колокольчик. */
async function reminders() {
  const now = new Date();
  const make = async (label: string) => {
    const home = await org(`Р${label} Основная`, { createdAt: new Date(now.getTime() - 40 * DAY) });
    const owner = await db.user.create({ data: { email: `${TAG}-r${label}@example.test`, name: "Владелец", passwordHash: "x", role: "manager", organizationId: home.id } });
    const account = await db.account.create({
      data: { ownerUserId: owner.id, createdAt: new Date(now.getTime() - 40 * DAY), subscriptionPlan: "standard", subscriptionEnd: new Date(now.getTime() + 30 * DAY), planPoints: 1, planCycle: "month" },
    });
    accountIds.push(account.id);
    await db.organization.update({ where: { id: home.id }, data: { accountId: account.id } });
    const second = await org(`Р${label} Вторая`, {
      accountId: account.id,
      createdAt: new Date(now.getTime() - 11 * DAY - 12 * HOUR),
      trialEndsAt: new Date(now.getTime() + 2 * DAY + 12 * HOUR),
    });
    return { home, owner, account, second };
  };
  const rich = await make("rich");
  const poor = await make("poor");
  const cover = await addPointAccountCover({ accountId: rich.account.id, organizationId: rich.home.id, now });
  check("reminder: the +1 point price is computed for the paid account", cover !== null && cover.priceRub > 0, cover);
  const price = cover?.priceRub ?? 0;
  // Деньги — на второй организации: важна сумма по аккаунту, не баланс одной.
  await setBalance(rich.home.id, Math.floor(price / 2));
  await setBalance(rich.second.id, price - Math.floor(price / 2));
  await setBalance(poor.home.id, Math.max(0, price - 1));
  const poorCover = await addPointAccountCover({ accountId: poor.account.id, organizationId: poor.home.id, now });
  check("reminder: the short account is 1 ₽ short", poorCover !== null && poorCover.accountTotalRub === price - 1 && poorCover.priceRub === price, poorCover);

  mailLog.splice(0);
  await runBillingTransitionJob({ now });
  const sentence = "На балансах организаций аккаунта хватает денег — точку можно оплатить с баланса в один шаг.";
  const firstRun = mailLog.splice(0);
  const richMail = mailsAbout(firstRun, rich.second.name);
  const poorMail = mailsAbout(firstRun, poor.second.name);
  console.log(`  letter (covered): ${richMail[0]?.body.slice(0, 400) ?? "none"}`);
  check("reminder: letter to the covered account carries the sentence", richMail.length === 1 && richMail[0].body.includes(sentence), richMail.map((m) => m.body.slice(0, 600)));
  check("reminder: letter to the short account (1 ₽ short) without the sentence", poorMail.length === 1 && !poorMail[0].body.includes(sentence) && poorMail[0].body.includes("Добавить точку"), poorMail.map((m) => m.body.slice(0, 600)));
  await runBillingTransitionJob({ now });
  const secondRun = mailLog.splice(0);
  const marks = await db.auditLog.findMany({ where: { organizationId: { in: [rich.second.id, poor.second.id] }, action: AUDIT_ACTIONS.orgTrialReminder } });
  check(
    "reminder: one mark per account, the second run sends nothing",
    marks.length === 2 && mailsAbout(secondRun, rich.second.name).length === 0 && mailsAbout(secondRun, poor.second.name).length === 0,
    { marks: marks.length },
  );
  const richBell = await db.notification.findFirst({ where: { userId: rich.owner.id, kind: AUDIT_ACTIONS.orgTrialReminder } });
  const poorBell = await db.notification.findFirst({ where: { userId: poor.owner.id, kind: AUDIT_ACTIONS.orgTrialReminder } });
  const labelKeys = (row: { items: unknown } | null) => (Array.isArray(row?.items) ? (row.items as Array<{ labelKey?: string }>).map((item) => item.labelKey ?? "") : []);
  check("reminder bell: the covered account has the «хватает» line (orgTrialAccountCovers), the link stays ?addPoints=1", labelKeys(richBell).includes("orgTrialAccountCovers") && richBell?.linkHref === "/settings/subscription?addPoints=1", { items: richBell?.items, link: richBell?.linkHref });
  check("reminder bell: the short account has no such line", poorBell !== null && !labelKeys(poorBell).includes("orgTrialAccountCovers"), poorBell?.items);
}

async function cleanup() {
  for (const name of [...triggers]) await dropTrigger(name).catch(() => undefined);
  await db.notification.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => undefined);
  await db.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => undefined);
  await db.paymentOrder.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => undefined);
  for (const id of [...orgIds].reverse()) await db.organization.delete({ where: { id } }).catch(() => undefined);
  await db.account.deleteMany({ where: { id: { in: accountIds } } }).catch(() => undefined);
  await db.user.deleteMany({ where: { email: { contains: TAG } } }).catch(() => undefined);
  const left = await db.organization.count({ where: { name: { contains: TAG } } });
  const leftRows = await db.balanceTransaction.count({ where: { organizationId: { in: orgIds } } });
  const leftTriggers = await db.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM pg_trigger WHERE tgname LIKE 'e2e_block_%${TAG}'`);
  console.log(`cleanup: organizations left ${left}, ledger rows left ${leftRows}, triggers left ${Number(leftTriggers[0]?.n ?? 0)}`);
}

main()
  .catch((error) => {
    failed += 1;
    console.error("FAIL script crashed", error);
  })
  .finally(async () => {
    await cleanup().catch((error) => console.error("cleanup failed", error));
    console.log(`TOTAL: ${passed} PASS, ${failed} FAIL`);
    await db.$disconnect();
    process.exit(failed > 0 ? 1 : 0);
  });
