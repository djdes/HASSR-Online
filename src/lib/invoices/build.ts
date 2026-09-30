import { amountInWords, formatRuDate } from "@/lib/closing-documents/build";
import {
  requisitesChecklist,
  type ClosingLine,
  type PartySnapshot,
  type PlatformRequisites,
} from "@/lib/closing-documents/types";
import { HARDWARE_DEVICES, normalizeHardwareConfig } from "@/lib/hardware-pricing";

/**
 * Счёт на оплату по безналу — чистая сборка.
 *
 * Счёт — не закрывающий документ: он предшествует оплате, период
 * подписки начнётся с даты поступления денег. Поэтому в строке услуги
 * не даты, а длительность («30 дн. с даты оплаты»), а строки
 * оборудования — по каталогу, как в УПД. Сумма счёта = полная цена без
 * баллов: баллы списываются только при оплате картой из кабинета.
 */
export const INVOICE_VALID_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Для счёта картинки не обязательны: нужны реквизиты, банк и подписант. */
export function invoiceRequisitesReady(r: PlatformRequisites): boolean {
  return requisitesChecklist(r)
    .filter((item) => item.key !== "facsimileFile" && item.key !== "stampFile")
    .every((item) => item.ok);
}

export type InvoiceDraft = {
  number: string;
  issuedAt: Date;
  dueAt: Date;
  seller: PartySnapshot;
  buyer: PartySnapshot;
  lines: ClosingLine[];
  totalRub: number;
  basis: string;
  /** Что произойдёт после оплаты — строка в примечании счёта; нет — как у подписки. */
  afterPayment?: string;
};

/** Счёт на подписку или на пополнение баланса деньгами. */
export type InvoicePurpose = "subscription" | "topup";

/**
 * Строка счёта на пополнение. Пополнение — предоплата: услуга будет
 * оказана, когда баллы потратят на подписку, поэтому в счёте нет периода.
 */
export const TOPUP_INVOICE_LINE_TITLE =
  "Пополнение баланса в сервисе WeSetup (предоплата за доступ к сервису)";

export const INVOICE_AFTER_PAYMENT: Record<InvoicePurpose, string> = {
  subscription:
    "После поступления средств подписка продлевается автоматически, закрывающие документы появляются в кабинете: «Настройки → Подписка → История оплат».",
  topup:
    "После поступления средств баланс организации пополняется на сумму счёта (1 ₽ = 1 балл) — баллы расходуются на оплату подписки. Промокоды и акции к пополнению не применяются.",
};

export type InvoiceBuildInput = {
  order: {
    id: number;
    createdAt: Date;
    amountRub: number;
    bundleConfig: unknown;
  };
  tariff: { title: string; periodDays: number; priceRub: number } | null;
  seller: PartySnapshot;
  buyer: PartySnapshot;
  /** По умолчанию — подписка. */
  purpose?: InvoicePurpose;
};

export function buildInvoiceLines(input: InvoiceBuildInput): ClosingLine[] {
  const total = round2(Math.max(0, input.order.amountRub));
  if (input.purpose === "topup") {
    return [
      { title: TOPUP_INVOICE_LINE_TITLE, unit: "усл. ед.", unitCode: "876", qty: 1, priceRub: total, sumRub: total },
    ];
  }
  const config = normalizeHardwareConfig(input.order.bundleConfig);
  const hardware: ClosingLine[] = HARDWARE_DEVICES.filter((d) => (config[d.id] ?? 0) > 0).map(
    (d) => ({
      title: d.title,
      unit: d.mode === "flat" ? "усл. ед." : "шт",
      unitCode: d.mode === "flat" ? "876" : "796",
      qty: config[d.id],
      priceRub: d.price,
      sumRub: round2(d.price * config[d.id]),
    })
  );
  const hardwareSum = round2(hardware.reduce((sum, line) => sum + line.sumRub, 0));
  const serviceSum = round2(Math.max(0, total - hardwareSum));
  const title = input.tariff?.title?.trim() || "Подписка";
  const days = input.tariff?.periodDays ?? 30;
  const service: ClosingLine = {
    title: `Доступ к сервису WeSetup, тариф «${title}», ${days} дн. (период — с даты оплаты)`,
    unit: "усл. ед.",
    unitCode: "876",
    qty: 1,
    priceRub: serviceSum,
    sumRub: serviceSum,
  };
  return serviceSum > 0 || hardware.length === 0 ? [service, ...hardware] : hardware;
}

export function buildInvoiceDraft(input: InvoiceBuildInput): InvoiceDraft {
  const lines = buildInvoiceLines(input);
  return {
    number: String(input.order.id),
    issuedAt: input.order.createdAt,
    dueAt: new Date(input.order.createdAt.getTime() + INVOICE_VALID_DAYS * DAY_MS),
    seller: input.seller,
    buyer: input.buyer,
    lines,
    totalRub: round2(lines.reduce((sum, line) => sum + line.sumRub, 0)),
    basis: "Договор-оферта (wesetup.ru/oferta)",
    afterPayment: INVOICE_AFTER_PAYMENT[input.purpose ?? "subscription"],
  };
}

export function invoiceFilename(number: string): { ascii: string; utf8: string } {
  const safe = number.replace(/[^0-9A-Za-z_-]/g, "");
  return { ascii: `Invoice-${safe}.pdf`, utf8: `Счёт-${safe}.pdf` };
}

export { amountInWords, formatRuDate };
