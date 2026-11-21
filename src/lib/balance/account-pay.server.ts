import { addPointsTarget } from "@/lib/add-points";
import { db } from "@/lib/db";
import { NOT_DIRECTORY_ORG_WHERE } from "@/lib/master-directory";
import { basePlanSnapshot, changeKindNote, type BasePlanSnapshot } from "@/lib/plan-payment";
import { accountSubscription, quoteCheckout, type CheckoutTarget } from "@/lib/plan-checkout.server";
import { resolveCheckoutDiscount } from "@/lib/promo/checkout";
import { lifetimeTerm } from "@/lib/promo/discounts";
import { computeCheckoutAmounts, orderDiscountNote } from "@/lib/promo/promotions";

import {
  ACCOUNT_PAY_TRANSFER_COMMENT,
  accountPayChargeKey,
  accountPayTransferKey,
  isAccountPayKey,
  planAccountCollection,
  type AccountPayPreview,
  type AccountPaySource,
  type AccountPayTransfer,
} from "./account-pay";
import { transferDedupeKeys } from "./account-transfer";
import { AccountTransferError, transferBetweenOwnOrganizations } from "./account-transfer.server";
import { createOrderPaidFromBalance } from "./checkout";
import { formatPoints } from "./constants";

/**
 * Оплата тарифа из балансов организаций аккаунта (серия E, Р9–Р10).
 *
 * Цена — та же, что у оплаты с баланса на странице заказа
 * (`/api/payments/robokassa/create`): `quoteCheckout` (тариф, период, точки,
 * вид перехода, акция) → промокод или скидка навсегда аккаунта
 * (`resolveCheckoutDiscount`) → `computeCheckoutAmounts`. Хватает на балансе
 * активной организации — обычная оплата с баланса. Не хватает, а по аккаунту
 * хватает — недостающее переводится в активную организацию существующим
 * переводом между своими организациями (сначала с самых больших балансов),
 * потом та же оплата с баланса (`createOrderPaidFromBalance` → строка
 * «Оплата тарифа», продление — `completePaidOrder`, как у автопродления).
 *
 * Только владелец аккаунта (`Account.ownerUserId`) — проверка здесь, а не в
 * переводе: управляющему сетью переводы могут быть открыты, тариф и оплата —
 * нет. «Войти как» и руководитель точки отсекаются в маршруте.
 *
 * Повтор с тем же ключом: оплата уже прошла — прежний заказ, ничего не
 * переводится и не списывается (ключ строки списания); переводы уже прошли —
 * второй раз с той же организации не переводится (ключ перевода из ключа
 * оплаты и организации). Сбой после переводов — деньги остаются на балансе
 * активной организации, переводы видны в истории, ответ говорит, что делать.
 */

export type AccountPayErrorCode =
  | "not_owner"
  | "invalid"
  | "nothing_to_pay"
  | "price_changed"
  | "account_short"
  | "deleting"
  | "transfer_failed"
  | "charge_failed"
  | "promo"
  | "unavailable"
  | "scheduled"
  | "points"
  | "account"
  | "exempt"
  | "individual";

export class AccountPayError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    readonly code: AccountPayErrorCode,
    message: string,
    /** Для фразы на клиенте: сколько уже переведено, куда, откуда не прошло. */
    readonly params: Record<string, string | number> | null = null,
  ) {
    super(message);
    this.name = "AccountPayError";
  }
}

export const ACCOUNT_PAY_OWNER_ONLY_MESSAGE = "Оплатить тариф с балансов организаций аккаунта может только владелец аккаунта";

const platformOrgId = () => (process.env.PLATFORM_ORG_ID ?? "platform").trim();

type ActiveOrg = { id: string; name: string; balanceRub: number; deleting: boolean };

/**
 * Аккаунт, которым владеет человек, и активная организация в нём. Свой
 * отказ, без функций перевода: им доступ могут расширить (управляющий сетью).
 */
async function ownerContext(ownerUserId: string, activeOrganizationId: string): Promise<{ accountId: string; email: string; active: ActiveOrg }> {
  const [account, owner, active] = await Promise.all([
    db.account.findUnique({ where: { ownerUserId }, select: { id: true } }),
    db.user.findUnique({ where: { id: ownerUserId }, select: { email: true, isActive: true, archivedAt: true } }),
    db.organization.findUnique({
      where: { id: activeOrganizationId },
      select: { id: true, name: true, accountId: true, balanceRub: true, deletionRequestedAt: true },
    }),
  ]);
  if (!account || !owner || !owner.isActive || owner.archivedAt || !active || active.accountId !== account.id) {
    throw new AccountPayError(403, "not_owner", ACCOUNT_PAY_OWNER_ONLY_MESSAGE);
  }
  return {
    accountId: account.id,
    email: owner.email.trim().toLowerCase(),
    active: { id: active.id, name: active.name, balanceRub: active.balanceRub, deleting: active.deletionRequestedAt !== null },
  };
}

/**
 * Организации аккаунта со своими деньгами, откуда можно собрать: без демо,
 * мастер-кабинетов, платформы и организаций, удаление которых запрошено.
 */
export async function accountMoneyOrganizations(accountId: string): Promise<AccountPaySource[]> {
  return db.organization.findMany({
    where: { accountId, isDemo: false, ...NOT_DIRECTORY_ORG_WHERE, id: { not: platformOrgId() }, deletionRequestedAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, name: true, balanceRub: true },
  });
}

/** Сумма балансов организаций аккаунта (тот же набор, что у сбора). */
export async function accountMoneyTotal(accountId: string): Promise<number> {
  const orgs = await accountMoneyOrganizations(accountId);
  return orgs.reduce((sum, org) => sum + Math.max(0, org.balanceRub), 0);
}

/**
 * Для страницы тарифа: балансы, по которым браузер решает, показывать ли
 * «Собрать с организаций аккаунта и оплатить». Только владельцу аккаунта с
 * двумя организациями со своими деньгами и больше; активная не удаляется.
 * Иначе (и при сбое) — null, кнопки нет.
 */
export async function accountPayHint(
  ownerUserId: string,
  activeOrganizationId: string,
): Promise<{ activeBalanceRub: number; accountTotalRub: number } | null> {
  try {
    const { accountId, active } = await ownerContext(ownerUserId, activeOrganizationId);
    if (active.deleting) return null;
    const orgs = await accountMoneyOrganizations(accountId);
    if (orgs.length < 2 || !orgs.some((org) => org.id === active.id)) return null;
    return { activeBalanceRub: active.balanceRub, accountTotalRub: orgs.reduce((sum, org) => sum + Math.max(0, org.balanceRub), 0) };
  } catch (error) {
    if (!(error instanceof AccountPayError)) console.error("[balance] account pay hint failed", error);
    return null;
  }
}

type PaymentQuote = {
  priceRub: number;
  tariffKey: string;
  description: string;
  points: number;
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
};

/** Сумма к оплате — те же шаги и то же описание заказа, что у оплаты на странице заказа. */
async function quotePayment(input: {
  organizationId: string;
  target: CheckoutTarget;
  email: string;
  promoCode: string | null;
  now: Date;
}): Promise<PaymentQuote> {
  const quote = await quoteCheckout({ organizationId: input.organizationId, target: input.target, now: input.now });
  if (!quote.ok) throw new AccountPayError(quote.status === 400 ? 400 : 409, quote.code, quote.error);
  const offer = quote.offer;
  const discount = await resolveCheckoutDiscount({
    promoRaw: input.promoCode ?? "",
    organizationId: input.organizationId,
    email: input.email,
    offerRub: offer.priceRub,
    now: input.now,
    scope: "account-pay",
  });
  if (!discount.ok) throw new AccountPayError(400, "promo", discount.message);
  const applied = discount.applied;
  const amounts = computeCheckoutAmounts({
    baseRub: offer.baseRub,
    promotion: offer.promotion,
    promo: applied ? { kind: applied.kind, value: applied.value } : null,
  });
  const changeNote = changeKindNote(quote.change.kind, { remainingDays: quote.change.remainingDays, creditRub: quote.change.creditRub });
  const title = changeNote ? `${quote.title} (${changeNote})` : quote.title;
  const discountNote = orderDiscountNote({
    promotion: offer.promotion,
    promotionDiscountRub: amounts.promotionDiscountRub,
    promoCode: applied?.code ?? null,
    promoDiscountRub: amounts.promoDiscountRub,
    lifetime: applied ? (applied.source === "lifetime" ? "auto" : applied.lifetime ? "code" : null) : null,
    lifetimeTerm: applied?.lifetime ? lifetimeTerm(applied) : null,
  });
  return {
    priceRub: amounts.grossRub,
    tariffKey: offer.tariffKey,
    description: discountNote ? `${title} (${discountNote})` : title,
    points: quote.target.points,
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

/** Организации, с которых по этому ключу оплаты уже переводили (повтор после сбоя). */
async function sourcesUsedByKey(accountId: string, idempotencyKey: string, sources: readonly AccountPaySource[]): Promise<Map<string, number>> {
  const keyed = sources.map((source) => ({ id: source.id, key: transferDedupeKeys(accountId, accountPayTransferKey(idempotencyKey, source.id)).in }));
  if (keyed.length === 0) return new Map();
  const rows = await db.balanceTransaction.findMany({
    where: { dedupeKey: { in: keyed.map((row) => row.key) } },
    select: { dedupeKey: true, amount: true },
  });
  const used = new Map<string, number>();
  for (const row of rows) {
    const source = keyed.find((item) => item.key === row.dedupeKey);
    if (source) used.set(source.id, row.amount);
  }
  return used;
}

function previewOf(input: { priceRub: number; active: ActiveOrg; sources: readonly AccountPaySource[] }): AccountPayPreview {
  const others = input.sources.filter((source) => source.id !== input.active.id);
  const accountTotalRub = Math.max(0, input.active.balanceRub) + others.reduce((sum, org) => sum + Math.max(0, org.balanceRub), 0);
  const missingRub = Math.max(0, input.priceRub - input.active.balanceRub);
  const plan = missingRub > 0 && !input.active.deleting ? planAccountCollection({ missingRub, sources: others }) : null;
  return {
    priceRub: input.priceRub,
    activeOrganizationId: input.active.id,
    activeName: input.active.name,
    activeBalanceRub: input.active.balanceRub,
    missingRub,
    accountTotalRub,
    sources: plan?.ok ? plan.transfers : [],
    canPay: input.priceRub > 0 && (missingRub === 0 || Boolean(plan?.ok)),
  };
}

export type AccountPayRequest = {
  ownerUserId: string;
  activeOrganizationId: string;
  target: CheckoutTarget;
  /** Промокод из ссылки (как у заказа); пусто — скидка навсегда аккаунта, если есть. */
  promoCode?: string | null;
  now?: Date;
};

/** Что будет при оплате: цена, баланс активной, недостающее и откуда соберём. Только владелец. */
export async function previewAccountPayment(input: AccountPayRequest): Promise<AccountPayPreview> {
  const now = input.now ?? new Date();
  const context = await ownerContext(input.ownerUserId, input.activeOrganizationId);
  const quote = await quotePayment({ organizationId: context.active.id, target: input.target, email: context.email, promoCode: input.promoCode ?? null, now });
  const sources = await accountMoneyOrganizations(context.accountId);
  return previewOf({ priceRub: quote.priceRub, active: context.active, sources });
}

export type AccountPayResult =
  | {
      status: "paid";
      orderId: number;
      priceRub: number;
      /** Переводы этого вызова; с `duplicate` — уже проведённые раньше по этому ключу. */
      transfers: Array<AccountPayTransfer & { duplicate: boolean }>;
      periodEnd: string;
    }
  | { status: "already"; orderId: number | null };

function movedText(moved: number, activeName: string): string {
  return `${formatPoints(moved)} уже на балансе «${activeName}»`;
}

/**
 * Собрать недостающее с организаций аккаунта и оплатить тариф с баланса
 * активной организации. Отказы — `AccountPayError` (маршрут отдаёт
 * `{ error, code, params }`).
 */
export async function payFromAccountBalances(
  input: AccountPayRequest & {
    idempotencyKey: string;
    /** Цена из подтверждения: изменилась (акция, остаток дней) — 409, ничего не двигаем. */
    expectedPriceRub?: number | null;
    actorName?: string | null;
    ipAddress?: string | null;
  },
): Promise<AccountPayResult> {
  if (!isAccountPayKey(input.idempotencyKey)) {
    throw new AccountPayError(400, "invalid", "Обновите страницу и повторите оплату");
  }
  const now = input.now ?? new Date();
  const context = await ownerContext(input.ownerUserId, input.activeOrganizationId);
  const { accountId, active } = context;
  const chargeKey = accountPayChargeKey(accountId, input.idempotencyKey);

  // Эта оплата уже прошла — ни переводов, ни второго списания.
  const charged = () => db.balanceTransaction.findUnique({ where: { dedupeKey: chargeKey }, select: { paymentOrderId: true } });
  const done = await charged();
  if (done) return { status: "already", orderId: done.paymentOrderId };

  const quote = await quotePayment({ organizationId: active.id, target: input.target, email: context.email, promoCode: input.promoCode ?? null, now });
  if (quote.priceRub <= 0) {
    throw new AccountPayError(409, "nothing_to_pay", "Платить с баланса нечего — оформите тариф обычным способом");
  }
  if (typeof input.expectedPriceRub === "number" && Math.round(input.expectedPriceRub) !== quote.priceRub) {
    throw new AccountPayError(409, "price_changed", `Сумма пересчитана: теперь ${formatPoints(quote.priceRub)}. Проверьте её и подтвердите ещё раз`, {
      priceRub: quote.priceRub,
    });
  }

  // Порядок чтений важен для повтора того же ключа (обрыв сети, двойной
  // запрос): сначала — с каких организаций по этому ключу уже переводили,
  // потом свежие балансы, потом ещё раз — не прошла ли оплата за это время.
  // С организации, которая по ключу уже переводила, второй раз не переводим:
  // её деньги уже на активной, и недостающее считается от свежего баланса.
  const candidates = (await accountMoneyOrganizations(accountId)).filter((source) => source.id !== active.id);
  const used = await sourcesUsedByKey(accountId, input.idempotencyKey, candidates);
  const [orgs, activeNow] = await Promise.all([
    accountMoneyOrganizations(accountId),
    db.organization.findUnique({ where: { id: active.id }, select: { balanceRub: true } }),
  ]);
  const doneMeanwhile = await charged();
  if (doneMeanwhile) return { status: "already", orderId: doneMeanwhile.paymentOrderId };
  const sources = orgs.filter((source) => source.id !== active.id && !used.has(source.id));
  const missingRub = Math.max(0, quote.priceRub - (activeNow?.balanceRub ?? 0));
  const transfers: Array<AccountPayTransfer & { duplicate: boolean }> = [];
  if (missingRub > 0) {
    if (active.deleting) {
      throw new AccountPayError(409, "deleting", `Организация «${active.name}» удаляется — собрать на её баланс нельзя`, { name: active.name });
    }
    const plan = planAccountCollection({ missingRub, sources });
    if (!plan.ok) {
      throw new AccountPayError(
        409,
        "account_short",
        `На балансах организаций аккаунта не хватает ${formatPoints(plan.shortRub)} — ничего не переведено и не списано`,
        { shortRub: plan.shortRub },
      );
    }
    let moved = 0;
    for (const step of plan.transfers) {
      try {
        const result = await transferBetweenOwnOrganizations({
          ownerUserId: input.ownerUserId,
          actorName: input.actorName ?? null,
          activeOrgId: active.id,
          fromId: step.orgId,
          toId: active.id,
          amountRub: step.amountRub,
          comment: ACCOUNT_PAY_TRANSFER_COMMENT,
          idempotencyKey: accountPayTransferKey(input.idempotencyKey, step.orgId),
          ipAddress: input.ipAddress ?? null,
        });
        moved += step.amountRub;
        transfers.push({ ...step, duplicate: result.duplicate });
      } catch (error) {
        // Параллельный запрос с тем же ключом успел оплатить — его итог.
        const paidMeanwhile = await charged().catch(() => null);
        if (paidMeanwhile) return { status: "already", orderId: paidMeanwhile.paymentOrderId };
        const reason = error instanceof AccountTransferError ? error.message : "ошибка сервера";
        if (!(error instanceof AccountTransferError)) console.error("[balance] account pay transfer failed", { accountId, from: step.orgId, error });
        throw new AccountPayError(
          409,
          "transfer_failed",
          moved > 0
            ? `Перевод из «${step.name}» не прошёл (${reason}). ${movedText(moved, active.name)} — переводы видны в истории баланса. Оплата не списана: повторите её, уже переведённое второй раз не переведётся`
            : `Перевод из «${step.name}» не прошёл (${reason}). Ничего не переведено и не списано — обновите страницу и повторите`,
          { sourceName: step.name, movedRub: moved, activeName: active.name },
        );
      }
    }
  }

  const movedRub = transfers.reduce((sum, row) => sum + row.amountRub, 0);
  const chargeFailed = (detail: string) =>
    new AccountPayError(
      409,
      "charge_failed",
      movedRub > 0
        ? `Оплата не прошла (${detail}). ${movedText(movedRub, active.name)} — переводы видны в истории баланса. Повторите оплату или оплатите тариф обычным способом`
        : `Оплата не прошла (${detail}). С баланса ничего не списано — повторите оплату`,
      { movedRub, activeName: active.name },
    );

  let created: Awaited<ReturnType<typeof createOrderPaidFromBalance>>;
  try {
    created = await createOrderPaidFromBalance({
      organizationId: active.id,
      userId: input.ownerUserId,
      email: context.email,
      tariffKey: quote.tariffKey,
      description: quote.description,
      grossRub: quote.priceRub,
      spendDedupeKey: chargeKey,
      source: "account-collect",
      promoCode: quote.promoCode,
      discountRub: quote.promoDiscountRub,
      lifetimeDiscountId: quote.lifetimeDiscountId,
      baseRub: quote.baseRub,
      promotionId: quote.promotionId,
      promotionPercent: quote.promotionPercent,
      promotionDiscountRub: quote.promotionDiscountRub,
      points: quote.points,
      changeKind: quote.changeKind,
      creditRub: quote.creditRub,
      periodEndsAt: quote.periodEnd,
      basePlanJson: quote.basePlanJson,
    });
  } catch (error) {
    console.error("[balance] account pay charge failed", { accountId, organizationId: active.id, error });
    throw chargeFailed("ошибка сервера");
  }
  if (created.status === "already") {
    // Параллельный запрос с тем же ключом успел первым.
    return { status: "already", orderId: (await charged())?.paymentOrderId ?? null };
  }
  if (created.status === "short") {
    // Баланс «кончился», потому что этот же ключ оплатил параллельный запрос.
    const paidMeanwhile = await charged();
    if (paidMeanwhile) return { status: "already", orderId: paidMeanwhile.paymentOrderId };
    throw chargeFailed(`на балансе «${active.name}» ${formatPoints(created.balanceRub)}, нужно ${formatPoints(quote.priceRub)}`);
  }

  // Продление, письмо-чек, партнёрские — той же дорогой, что у оплаты; внутри best-effort.
  const stored = await db.paymentOrder.findUnique({ where: { id: created.id } });
  if (stored) {
    const { completePaidOrder } = await import("@/lib/payment-fulfillment");
    await completePaidOrder(stored);
  }
  await db.auditLog
    .create({
      data: {
        organizationId: active.id,
        userId: input.ownerUserId,
        userName: input.actorName ?? null,
        action: "billing.account_pay",
        entity: "PaymentOrder",
        entityId: String(created.id),
        details: {
          accountId,
          orderId: created.id,
          priceRub: quote.priceRub,
          transfers: transfers.map((row) => ({ fromOrganizationId: row.orgId, fromName: row.name, amountRub: row.amountRub, duplicate: row.duplicate })),
          idempotencyKey: input.idempotencyKey,
        },
        ipAddress: input.ipAddress ?? null,
      },
    })
    .catch((error) => console.error("[balance] account pay audit failed", error));
  console.info("[billing] paid from account balances", {
    account: accountId,
    organizationId: active.id,
    orderId: created.id,
    priceRub: quote.priceRub,
    transfers: transfers.map((row) => `${row.orgId}:${row.amountRub}${row.duplicate ? " (dup)" : ""}`),
  });
  return { status: "paid", orderId: created.id, priceRub: quote.priceRub, transfers, periodEnd: quote.periodEnd.toISOString() };
}

/**
 * Р9: хватает ли по аккаунту на «Добавить точку» до конца срока — та же цена,
 * что у кнопки на странице тарифа с `?addPoints=1` (тариф и период аккаунта,
 * оплачено + 1 точка, доплата за остаток, с акцией; скидка навсегда только
 * удешевит). Не оплачено, прежняя «Подписка», без аккаунта или сбой — null.
 */
export async function addPointAccountCover(input: {
  accountId: string | null;
  organizationId: string;
  now?: Date;
}): Promise<{ priceRub: number; accountTotalRub: number } | null> {
  if (!input.accountId) return null;
  const now = input.now ?? new Date();
  try {
    const subscription = await accountSubscription(input.organizationId, now);
    const current = subscription.current;
    if (subscription.exempt || !current || current.tier === "legacy") return null;
    const points = addPointsTarget({ requested: true, paidPoints: current.points, pointsInUse: Math.max(1, subscription.pointsInUse) });
    if (points === null) return null;
    const quote = await quoteCheckout({ organizationId: input.organizationId, target: { tier: current.tier, cycle: current.cycle, points }, now });
    if (!quote.ok) return null;
    return { priceRub: quote.offer.priceRub, accountTotalRub: await accountMoneyTotal(input.accountId) };
  } catch (error) {
    console.error("[billing] add-point account cover failed", { accountId: input.accountId, error });
    return null;
  }
}
