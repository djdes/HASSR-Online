import type { PaymentOrder, Prisma } from "@prisma/client";

import { formatPoints } from "@/lib/balance/constants";
import { settlePaidOrder } from "@/lib/balance/topup";
import { TOPUP_TARIFF_KEY, isTopupOrder, topupOrderDescription } from "@/lib/balance/topup-core";
import { buildBuyerSnapshot, buildSellerSnapshot } from "@/lib/closing-documents/build";
import { readLegalImage, readPlatformRequisites } from "@/lib/closing-documents/requisites";
import { db } from "@/lib/db";
import { sendInvoiceEmail } from "@/lib/email";
import type { LegalProfile } from "@/lib/org-legal-profile";
import { completePaidOrder } from "@/lib/payment-fulfillment";
import { notifyPlatformAdmin } from "@/lib/platform-admin";
import { resolveCheckoutDiscount } from "@/lib/promo/checkout";
import { getSubscriptionOffer } from "@/lib/promo/offer";
import { computeCheckoutAmounts, orderDiscountNote } from "@/lib/promo/promotions";
import { isTestMode } from "@/lib/robokassa";
import { readTariff } from "@/lib/tariffs";

import { INVOICE_VALID_DAYS, buildInvoiceDraft, invoiceRequisitesReady } from "./build";
import { renderInvoicePdf } from "./pdf";

/**
 * Счёт по безналу — жизненный цикл.
 *
 * - `createInvoiceOrder`: заказ `paymentMethod = "invoice"` в статусе
 *   pending, без баллов и без кассы. Один действующий счёт на
 *   организацию: повторный запрос возвращает его же.
 * - `createTopupInvoiceOrder`: счёт на пополнение баланса — отдельно от
 *   счёта на подписку (свой «один действующий»), подписку не продлевает.
 * - `renderInvoice`: PDF по текущим реквизитам сторон (счёт — не
 *   закрывающий документ, снимок не нужен: оплатят — будет УПД).
 * - `markInvoicePaid` (ROOT): тот же путь, что у вебхука кассы —
 *   pending → paid одним updateMany, затем `completePaidOrder`: подписка,
 *   письмо, УПД, партнёрские начисления. Повторное нажатие — 409.
 * - `cancelInvoice` (ROOT): pending → cancelled.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

export type CreateInvoiceResult =
  | { ok: true; order: PaymentOrder; created: boolean }
  | { ok: false; status: number; error: string };

function legalProfileOf(raw: unknown): LegalProfile | null {
  if (!raw || typeof raw !== "object") return null;
  return typeof (raw as Record<string, unknown>).inn === "string" ? (raw as LegalProfile) : null;
}

async function loadOrganizationParty(organizationId: string) {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { name: true, inn: true, address: true, legalProfileJson: true, subscriptionEnd: true },
  });
  if (!org) return null;
  return {
    name: org.name,
    inn: org.inn,
    address: org.address,
    legalProfile: legalProfileOf(org.legalProfileJson),
  };
}

export async function createInvoiceOrder(args: {
  organizationId: string;
  userId: string;
  email: string;
  tariffKey: string;
  /** Введённый промокод (или код из ссылки); проверит и посчитает сервер. */
  promoCode?: string | null;
}): Promise<CreateInvoiceResult> {
  const requisites = await readPlatformRequisites();
  if (!invoiceRequisitesReady(requisites)) {
    return { ok: false, status: 409, error: "Оплата по счёту пока недоступна — реквизиты исполнителя не заполнены" };
  }
  const organization = await loadOrganizationParty(args.organizationId);
  if (!organization) return { ok: false, status: 404, error: "Организация не найдена" };
  const buyer = buildBuyerSnapshot(organization);
  if (!buyer.inn) {
    return { ok: false, status: 400, error: "Укажите ИНН организации в настройках — без него счёт не оформить" };
  }
  // Цена с действующей акцией — та же, что в кабинете рядом с кнопкой.
  // Счёт фиксирует её на свой срок: оплатят после конца акции — всё
  // равно по сумме счёта.
  const now = new Date();
  const offer = await getSubscriptionOffer(now, args.tariffKey);
  if (!offer) return { ok: false, status: 400, error: "Тариф недоступен" };

  // Счёт на пополнение баланса — не счёт на подписку: его не возвращаем.
  const existing = await db.paymentOrder.findFirst({
    where: {
      organizationId: args.organizationId,
      paymentMethod: "invoice",
      status: "pending",
      tariffKey: { not: TOPUP_TARIFF_KEY },
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return { ok: true, order: existing, created: false };

  // Скидка поверх акции — как у оплаты картой: введённый код или скидка
  // навсегда аккаунта, выгоднейшая из двух. Чужой или неподходящий код —
  // отказ, а не счёт без скидки.
  const discount = await resolveCheckoutDiscount({
    promoRaw: args.promoCode ?? null,
    organizationId: args.organizationId,
    email: args.email,
    offerRub: offer.priceRub,
    now,
    scope: "invoice",
  });
  if (!discount.ok) return { ok: false, status: 400, error: discount.message };
  const applied = discount.applied;
  const amounts = computeCheckoutAmounts({
    baseRub: offer.baseRub,
    promotion: offer.promotion,
    promo: applied ? { kind: applied.kind, value: applied.value } : null,
  });
  if (amounts.grossRub <= 0) {
    return {
      ok: false,
      status: 400,
      error: "Скидка закрывает всю сумму — счёт не нужен. Оформите подписку на странице оплаты",
    };
  }

  const note = orderDiscountNote({
    promotion: offer.promotion,
    promotionDiscountRub: amounts.promotionDiscountRub,
    promoCode: applied?.code ?? null,
    promoDiscountRub: amounts.promoDiscountRub,
    lifetime: applied ? (applied.source === "lifetime" ? "auto" : applied.lifetime ? "code" : null) : null,
  });
  const order = await db.paymentOrder.create({
    data: {
      email: args.email,
      tariffKey: offer.tariffKey,
      amountRub: amounts.grossRub,
      description: `${offer.tariffTitle} на ${offer.periodDays} дн. (счёт${note ? `; ${note}` : ""})`,
      status: "pending",
      isTest: isTestMode(),
      organizationId: args.organizationId,
      userId: args.userId,
      paymentMethod: "invoice",
      invoiceDueAt: new Date(now.getTime() + INVOICE_VALID_DAYS * DAY_MS),
      baseRub: amounts.baseRub,
      promotionId: offer.promotion?.id ?? null,
      promotionPercent: offer.promotion?.percent ?? null,
      promotionDiscountRub: amounts.promotionDiscountRub,
      promoCode: applied?.code ?? null,
      discountRub: amounts.promoDiscountRub,
      lifetimeDiscountId: applied?.lifetimeDiscountId ?? null,
    },
  });
  console.info(
    `[promo] invoice #${order.id}: base ${offer.baseRub} ₽` +
      (offer.promotion ? ` → promotion ${offer.promotion.id} −${offer.promotion.percent}%` : "") +
      (applied
        ? ` → ${applied.source === "lifetime" ? "lifetime (auto)" : applied.lifetime ? "promo (lifetime)" : "promo"} ${applied.code} −${amounts.promoDiscountRub} ₽`
        : "") +
      ` = ${amounts.grossRub} ₽`
  );
  return { ok: true, order, created: true };
}

export async function renderInvoice(orderId: number): Promise<{ order: PaymentOrder; pdf: Buffer } | null> {
  const order = await db.paymentOrder.findUnique({ where: { id: orderId } });
  if (!order || order.paymentMethod !== "invoice" || !order.organizationId) return null;
  const topup = isTopupOrder(order);
  const [requisites, organization, tariff] = await Promise.all([
    readPlatformRequisites(),
    loadOrganizationParty(order.organizationId),
    topup ? Promise.resolve(null) : readTariff(order.tariffKey),
  ]);
  if (!organization) return null;
  const draft = buildInvoiceDraft({
    order: { id: order.id, createdAt: order.createdAt, amountRub: Number(order.amountRub), bundleConfig: order.bundleConfig },
    tariff: tariff ? { title: tariff.title, periodDays: tariff.periodDays, priceRub: tariff.priceRub } : null,
    seller: buildSellerSnapshot(requisites),
    buyer: buildBuyerSnapshot(organization),
    purpose: topup ? "topup" : "subscription",
  });
  const [facsimile, stamp] = await Promise.all([
    readLegalImage("facsimile", requisites),
    readLegalImage("stamp", requisites),
  ]);
  return { order, pdf: renderInvoicePdf(draft, { facsimile, stamp }) };
}

/** Письмо со счётом клиенту и заметка админу — best-effort, после ответа клиенту. */
export async function deliverInvoice(orderId: number, organizationName: string): Promise<void> {
  const rendered = await renderInvoice(orderId);
  if (!rendered) return;
  const { order, pdf } = rendered;
  const topup = isTopupOrder(order);
  await sendInvoiceEmail({
    to: order.email,
    number: String(order.id),
    amountRub: Number(order.amountRub),
    dueAt: order.invoiceDueAt ?? new Date(order.createdAt.getTime() + INVOICE_VALID_DAYS * DAY_MS),
    organizationId: order.organizationId,
    pdf,
    purpose: topup ? "topup" : "subscription",
  }).catch((error) => console.error("[invoices] email failed", error));
  await notifyPlatformAdmin(
    [
      `🧾 Выставлен счёт №${order.id}${topup ? " на пополнение баланса" : ""}`,
      `Организация: ${organizationName}`,
      `Сумма: ${Number(order.amountRub).toLocaleString("ru-RU")} ₽ · ${order.description}`,
      `Когда деньги придут — ROOT → организация → «Оплата поступила».`,
    ].join("\n"),
    { kind: "payment", dedupeKey: `invoice-created:${order.id}` }
  ).catch((error) => console.error("[invoices] admin notify failed", error));
}

export async function markInvoicePaid(
  orderId: number,
  byUserId: string
): Promise<{ ok: true; order: PaymentOrder } | { ok: false; status: number; error: string }> {
  const raw: Prisma.InputJsonValue = { manual: true, by: byUserId, at: new Date().toISOString() };
  // pending → paid одним условным апдейтом; у счёта на пополнение в той же
  // транзакции баланс получает сумму счёта (settlePaidOrder, topup-core.ts).
  const settled = await settlePaidOrder({
    orderId,
    paymentMethod: "invoice",
    rawResult: raw,
    actorUserId: byUserId,
  });
  if (!settled.claimed) {
    const fresh = await db.paymentOrder.findUnique({ where: { id: orderId }, select: { status: true, paymentMethod: true } });
    if (!fresh || fresh.paymentMethod !== "invoice") return { ok: false, status: 404, error: "Счёт не найден" };
    return { ok: false, status: 409, error: fresh.status === "paid" ? "Счёт уже отмечен оплаченным" : `Счёт в статусе «${fresh.status}»` };
  }
  const stored = await db.paymentOrder.findUnique({ where: { id: orderId } });
  if (!stored) return { ok: false, status: 404, error: "Счёт не найден" };
  // Подписка, письмо «Оплата получена» с УПД, партнёрские начисления —
  // одной точкой с кассой. Внутри всё best-effort.
  await completePaidOrder(stored);
  return { ok: true, order: stored };
}

/**
 * Счёт на пополнение баланса (сумма уже проверена `parseTopupAmount`).
 * Как у подписки: нужны реквизиты исполнителя и ИНН покупателя; один
 * действующий счёт на пополнение — повтор с той же суммой возвращает его
 * же, с другой — отказ с номером действующего счёта (иначе бухгалтерия
 * получила бы два счёта и оплатила оба).
 */
export async function createTopupInvoiceOrder(args: {
  organizationId: string;
  userId: string;
  email: string;
  amountRub: number;
}): Promise<CreateInvoiceResult> {
  const requisites = await readPlatformRequisites();
  if (!invoiceRequisitesReady(requisites)) {
    return { ok: false, status: 409, error: "Оплата по счёту пока недоступна — реквизиты исполнителя не заполнены" };
  }
  const organization = await loadOrganizationParty(args.organizationId);
  if (!organization) return { ok: false, status: 404, error: "Организация не найдена" };
  if (!buildBuyerSnapshot(organization).inn) {
    return { ok: false, status: 400, error: "Укажите ИНН организации в настройках — без него счёт не оформить" };
  }
  const now = new Date();
  const existing = await db.paymentOrder.findFirst({
    where: {
      organizationId: args.organizationId,
      paymentMethod: "invoice",
      status: "pending",
      tariffKey: TOPUP_TARIFF_KEY,
      OR: [{ invoiceDueAt: null }, { invoiceDueAt: { gt: now } }],
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    if (Number(existing.amountRub) === args.amountRub) return { ok: true, order: existing, created: false };
    const due = existing.invoiceDueAt ? ` — он действует до ${existing.invoiceDueAt.toLocaleDateString("ru-RU")}` : "";
    console.info(
      `[balance] topup invoice refused org=${args.organizationId} rub=${args.amountRub}: pending invoice #${existing.id} on ${Number(existing.amountRub)}`,
    );
    return {
      ok: false,
      status: 409,
      error: `Уже выставлен счёт № ${existing.id} на ${formatPoints(Number(existing.amountRub))}${due}. Оплатите его или напишите на support@wesetup.ru, чтобы отменить`,
    };
  }
  const order = await db.paymentOrder.create({
    data: {
      email: args.email,
      tariffKey: TOPUP_TARIFF_KEY,
      amountRub: args.amountRub,
      description: topupOrderDescription(args.amountRub, "invoice"),
      status: "pending",
      isTest: isTestMode(),
      organizationId: args.organizationId,
      userId: args.userId,
      paymentMethod: "invoice",
      invoiceDueAt: new Date(now.getTime() + INVOICE_VALID_DAYS * DAY_MS),
    },
  });
  console.info(
    `[balance] topup order created org=${args.organizationId} rub=${args.amountRub} order=${order.id} method=invoice`,
  );
  return { ok: true, order, created: true };
}

export async function cancelInvoice(orderId: number): Promise<boolean> {
  const result = await db.paymentOrder.updateMany({
    where: { id: orderId, status: "pending", paymentMethod: "invoice" },
    data: { status: "cancelled" },
  });
  return result.count > 0;
}
