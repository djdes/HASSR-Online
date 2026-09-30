import type { ClosingDocument, Prisma } from "@prisma/client";

import { isTopupOrder } from "@/lib/balance/topup-core";
import { db } from "@/lib/db";
import type { LegalProfile } from "@/lib/org-legal-profile";
import { readTariff } from "@/lib/tariffs";

import { buildBuyerSnapshot, buildClosingDocument } from "./build";
import { renderClosingDocumentPdf } from "./pdf";
import { readLegalImage, readPlatformRequisites } from "./requisites";
import {
  EMPTY_REQUISITES,
  isRequisitesComplete,
  type ClosingDocumentDraft,
  type ClosingLine,
  type PartySnapshot,
  type PlatformRequisites,
} from "./types";

/**
 * Жизненный цикл закрывающего документа.
 *
 * - `ensureClosingDocument` — выпустить (снимок) лениво: при оплате и при
 *   первом скачивании старого заказа. Только для заказов, оплаченных
 *   деньгами, не тестовых и не возвращённых, и только при полном
 *   комплекте реквизитов продавца.
 * - `renderPdf` — PDF из снимка; картинки подписи и печати читаются в
 *   момент рендера (подписант тот же, документ — тот же).
 * - `voidClosingDocument` — возврат платежа аннулирует документ.
 * - `refreshClosingDocumentBuyer` — организация заполнила ИНН после
 *   оплаты: перезаписать покупателя в снимке, остальное не трогать.
 */
export type ClosingEligibility =
  | { ok: true }
  | { ok: false; reason: "not-paid" | "test" | "zero" | "refunded" | "requisites" | "advance" };

type OrderForClosing = {
  id: number;
  status: string;
  isTest: boolean;
  amountRub: Prisma.Decimal | number;
  pointsSpent: number;
  paidAt: Date | null;
  createdAt: Date;
  description: string;
  tariffKey: string;
  bundleConfig: unknown;
  organizationId: string | null;
  refundedAt: Date | null;
  promoCode: string | null;
  discountRub: number;
  promotionPercent: number | null;
  promotionDiscountRub: number;
};

export function closingEligibility(
  order: Pick<OrderForClosing, "status" | "isTest" | "amountRub" | "refundedAt"> & { tariffKey?: string | null },
  requisites: PlatformRequisites
): ClosingEligibility {
  if (order.status !== "paid") return { ok: false, reason: "not-paid" };
  // Пополнение баланса — аванс: услуга ещё не оказана, а УПД здесь
  // подтверждает оказанную услугу за период. Выпускать его на пополнение
  // значило бы написать неправду; какой документ нужен на аванс — решение
  // владельца и бухгалтера (см. .agent/tasks/balance-reviews-topup).
  if (isTopupOrder(order)) return { ok: false, reason: "advance" };
  if (order.isTest) return { ok: false, reason: "test" };
  if (Number(order.amountRub) <= 0) return { ok: false, reason: "zero" };
  if (order.refundedAt) return { ok: false, reason: "refunded" };
  if (!isRequisitesComplete(requisites)) return { ok: false, reason: "requisites" };
  return { ok: true };
}

function legalProfileOf(raw: unknown): LegalProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  return typeof record.inn === "string" ? (raw as LegalProfile) : null;
}

async function loadOrder(orderId: number): Promise<OrderForClosing | null> {
  return db.paymentOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      isTest: true,
      amountRub: true,
      pointsSpent: true,
      paidAt: true,
      createdAt: true,
      description: true,
      tariffKey: true,
      bundleConfig: true,
      organizationId: true,
      refundedAt: true,
      promoCode: true,
      discountRub: true,
      promotionPercent: true,
      promotionDiscountRub: true,
    },
  });
}

async function loadOrganization(organizationId: string) {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { name: true, inn: true, address: true, legalProfileJson: true },
  });
  if (!org) return null;
  return {
    name: org.name,
    inn: org.inn,
    address: org.address,
    legalProfile: legalProfileOf(org.legalProfileJson),
  };
}

export async function loadClosingDocument(orderId: number): Promise<ClosingDocument | null> {
  return db.closingDocument.findUnique({ where: { orderId } });
}

export async function ensureClosingDocument(
  orderId: number,
  options: {
    subscriptionEnd?: Date | null;
    /**
     * Организация из результата исполнения заказа: у нового клиента она
     * создаётся при оплате, и на самом заказе её ещё может не быть.
     */
    organizationId?: string | null;
  } = {}
): Promise<{ document: ClosingDocument | null; eligibility: ClosingEligibility }> {
  const existing = await loadClosingDocument(orderId);
  if (existing) return { document: existing, eligibility: { ok: true } };

  const order = await loadOrder(orderId);
  const organizationId = order?.organizationId ?? options.organizationId ?? null;
  if (!order || !organizationId) return { document: null, eligibility: { ok: false, reason: "not-paid" } };
  const requisites = await readPlatformRequisites();
  const eligibility = closingEligibility(order, requisites);
  if (!eligibility.ok) return { document: null, eligibility };

  const [organization, tariff] = await Promise.all([
    loadOrganization(organizationId),
    readTariff(order.tariffKey),
  ]);
  if (!organization) return { document: null, eligibility: { ok: false, reason: "not-paid" } };

  const draft = buildClosingDocument({
    order: {
      id: order.id,
      amountRub: Number(order.amountRub),
      pointsSpent: order.pointsSpent,
      paidAt: order.paidAt ?? order.createdAt,
      description: order.description,
      bundleConfig: order.bundleConfig,
      promoCode: order.promoCode,
      discountRub: order.discountRub,
      promotionPercent: order.promotionPercent,
      promotionDiscountRub: order.promotionDiscountRub,
    },
    tariff: tariff ? { title: tariff.title, periodDays: tariff.periodDays } : null,
    subscriptionEnd: options.subscriptionEnd ?? null,
    organization,
    requisites,
  });

  // Две вкладки могли попросить документ одновременно — unique по orderId
  // сделает второй create ошибкой, и мы просто перечитаем.
  try {
    const document = await db.closingDocument.create({
      data: {
        orderId: draft.orderId,
        organizationId,
        number: draft.number,
        issuedAt: draft.issuedAt,
        seller: draft.seller as Prisma.InputJsonValue,
        buyer: draft.buyer as Prisma.InputJsonValue,
        lines: draft.lines as unknown as Prisma.InputJsonValue,
        totalRub: draft.totalRub,
        vatMode: draft.vatMode,
      },
    });
    return { document, eligibility };
  } catch (error) {
    const again = await loadClosingDocument(orderId);
    if (again) return { document: again, eligibility };
    throw error;
  }
}

export function draftFromRow(row: ClosingDocument): ClosingDocumentDraft {
  const seller = row.seller as unknown as PartySnapshot;
  const buyer = row.buyer as unknown as PartySnapshot;
  const date = row.issuedAt;
  const ru = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
  return {
    orderId: row.orderId,
    number: row.number,
    issuedAt: date,
    seller,
    buyer,
    lines: row.lines as unknown as ClosingLine[],
    totalRub: Number(row.totalRub),
    vatMode: "none",
    basis: `Договор-оферта (wesetup.ru/oferta), заказ № ${row.orderId} от ${ru}`,
    paymentDocument: `№ ${row.orderId} от ${ru}`,
  };
}

export async function renderPdf(row: ClosingDocument): Promise<Buffer> {
  const requisites = await readPlatformRequisites();
  const [facsimile, stamp] = await Promise.all([
    readLegalImage("facsimile", requisites),
    readLegalImage("stamp", requisites),
  ]);
  return renderClosingDocumentPdf(draftFromRow(row), { facsimile, stamp });
}

export async function voidClosingDocument(orderId: number): Promise<void> {
  await db.closingDocument.updateMany({
    where: { orderId, status: "issued" },
    data: { status: "voided", voidedAt: new Date() },
  });
}

/**
 * Вложение для письма «Оплата получена». Best-effort: без реквизитов
 * исполнителя, для тестового или закрытого баллами заказа и при сбое
 * рендера — null, письмо уходит как раньше, без вложения.
 */
export async function prepareClosingDocumentEmail(
  orderId: number,
  options: { subscriptionEnd?: Date | null; organizationId?: string | null } = {}
): Promise<{ number: string; pdf: Buffer } | null> {
  try {
    const { document } = await ensureClosingDocument(orderId, options);
    if (!document || document.status !== "issued") return null;
    return { number: document.number, pdf: await renderPdf(document) };
  } catch (error) {
    console.error(`[closing-documents] prepare for order ${orderId} failed`, error);
    return null;
  }
}

export async function markClosingDocumentEmailed(orderId: number): Promise<void> {
  await db.closingDocument.updateMany({ where: { orderId }, data: { emailedAt: new Date() } });
}

export async function refreshClosingDocumentBuyer(orderId: number): Promise<ClosingDocument | null> {
  const row = await loadClosingDocument(orderId);
  if (!row || !row.organizationId) return null;
  const organization = await loadOrganization(row.organizationId);
  if (!organization) return row;
  const buyer = buildBuyerSnapshot(organization);
  return db.closingDocument.update({
    where: { orderId },
    data: { buyer: buyer as Prisma.InputJsonValue },
  });
}

/** Образец для ROOT-страницы: наши реквизиты как есть, покупатель и строки условные. */
export async function renderSamplePdf(): Promise<Buffer> {
  const requisites = await readPlatformRequisites();
  const filled: PlatformRequisites = {
    ...EMPTY_REQUISITES,
    ...requisites,
    nameFull: requisites.nameFull || "Общество с ограниченной ответственностью «Название»",
    inn: requisites.inn || "0000000000",
    ogrn: requisites.ogrn || "0000000000000",
    address: requisites.address || "Юридический адрес не заполнен",
    head: {
      post: requisites.head.post || "Генеральный директор",
      name: requisites.head.name || "Фамилия И. О.",
    },
  };
  const paidAt = new Date();
  const draft = buildClosingDocument({
    order: {
      id: 100001,
      amountRub: 1990 + 3490 * 2,
      pointsSpent: 0,
      paidAt,
      description: "Подписка + оборудование",
      bundleConfig: { temp: 2 },
    },
    tariff: { title: "Подписка", periodDays: 30 },
    subscriptionEnd: null,
    organization: {
      name: "ООО «Ромашка»",
      inn: "7712345678",
      address: "г. Москва, ул. Ленина, д. 1",
      legalProfile: null,
    },
    requisites: filled,
  });
  const [facsimile, stamp] = await Promise.all([
    readLegalImage("facsimile", requisites),
    readLegalImage("stamp", requisites),
  ]);
  return renderClosingDocumentPdf(draft, { facsimile, stamp }, { sample: true });
}
