/**
 * Строка входящей накладной (УПД) → строка журнала приёмки.
 *
 * Правило то же, что у Меркурия (`vsd-to-acceptance-row.ts`): из документа
 * берётся только то, что документ ЗНАЕТ — что, от кого, сколько, по какому
 * документу, «годен до», если поставщик его передал. Всё, что узнают,
 * только потрогав товар, — температура, упаковка, органолептика, решение —
 * остаётся пустым до формы приёмки.
 */
import { createAcceptanceRow, type AcceptanceRow } from "@/lib/acceptance-document";

import type { SupplyItem, SupplyParty } from "./upd";

export const SUPPLY_SOURCES = ["upload", "diadoc", "saby"] as const;
export type SupplySource = (typeof SUPPLY_SOURCES)[number];

export const SUPPLY_SOURCE_LABEL: Record<SupplySource, string> = {
  upload: "файл ЭДО",
  diadoc: "Диадок",
  saby: "СБИС",
};

export type SupplyDocumentRef = {
  id: string;
  source: SupplySource;
  number: string;
  /** YYYY-MM-DD */
  date: string;
  seller: SupplyParty;
  basis: string | null;
  shippedDate: string | null;
};

function ruDate(dateKey: string): string {
  const [y, m, d] = dateKey.slice(0, 10).split("-");
  return d && m && y ? `${d}.${m}.${y}` : dateKey;
}

/** «УПД № МД-1031 от 31.10.2026 (Диадок); Договор поставки № 12/26 от 10.01.2026» */
export function supplyAccompanyingDocs(doc: SupplyDocumentRef): string {
  const parts = [`УПД № ${doc.number} от ${ruDate(doc.date)} (${SUPPLY_SOURCE_LABEL[doc.source]})`];
  if (doc.basis) parts.push(doc.basis);
  return parts.join("; ");
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000).replace(".", ",");
}

/** «40 л», «5,5 кг», «12 шт» — колонка «Объём, партия». */
export function supplyBatchInfo(item: SupplyItem): string {
  if (item.quantity === null) return "";
  return `${formatQuantity(item.quantity)}${item.unit ? ` ${item.unit}` : ""}`;
}

export function supplyItemToAcceptanceRow(input: {
  doc: SupplyDocumentRef;
  item: SupplyItem;
  responsibleTitle?: string | null;
  responsibleUserId?: string | null;
}): AcceptanceRow {
  const { doc, item } = input;
  const supplier = doc.seller.inn ? `${doc.seller.name} (ИНН ${doc.seller.inn})` : doc.seller.name;
  return createAcceptanceRow({
    deliveryDate: (doc.shippedDate ?? doc.date).slice(0, 10),
    // Время приёмки документ не знает — его ставит приёмщик.
    deliveryHour: "",
    deliveryMinute: "",
    productName: item.name,
    supplier,
    manufacturerSupplier: supplier,
    accompanyingDocs: supplyAccompanyingDocs(doc),
    batchInfo: supplyBatchInfo(item),
    shelfLifeDate: item.expiryDate ?? "",
    expiryDate: item.expiryDate ?? "",
    responsibleTitle: input.responsibleTitle ?? "",
    responsibleUserId: input.responsibleUserId ?? "",
    supplyDocumentId: doc.id,
    supplyDocumentLine: String(item.line),
  });
}

export type SupplyDeliveryCheck = {
  /** YYYY-MM-DD; нет — дата отгрузки из документа. */
  deliveryDate?: string;
  deliveryHour?: string;
  deliveryMinute?: string;
  transportOk: boolean;
  documentsOk: boolean;
};

export type SupplyItemCheck = {
  decision: "accept" | "reject";
  packagingOk: boolean;
  organolepticOk: boolean;
  productTemperature?: string;
  /** YYYY-MM-DD — «годен до» с упаковки, если в документе не было. */
  expiryDate?: string;
  correctiveActions?: string;
};

/**
 * Дополнить строку проверкой человека. Отдельным шагом — чтобы в коде была
 * видна граница: до этого вызова в строке нет ни одного наблюдённого факта.
 */
export function applySupplyCheck(row: AcceptanceRow, delivery: SupplyDeliveryCheck, item: SupplyItemCheck): AcceptanceRow {
  const expiry = item.expiryDate?.trim() || row.shelfLifeDate;
  return {
    ...row,
    deliveryDate: delivery.deliveryDate?.trim() || row.deliveryDate,
    deliveryHour: delivery.deliveryHour ?? row.deliveryHour,
    deliveryMinute: delivery.deliveryMinute ?? row.deliveryMinute,
    transportCondition: delivery.transportOk ? "satisfactory" : "unsatisfactory",
    documentCompliance: delivery.documentsOk ? "Соответствует" : "Не соответствует",
    packagingCompliance: item.packagingOk ? "compliant" : "non_compliant",
    organolepticResult: item.organolepticOk ? "satisfactory" : "unsatisfactory",
    productTemperature: item.productTemperature?.trim() ?? row.productTemperature,
    shelfLifeDate: expiry,
    expiryDate: expiry,
    acceptanceDecision: item.decision,
    correctiveActions: item.correctiveActions?.trim() ?? row.correctiveActions,
  };
}
