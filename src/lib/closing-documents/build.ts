import { HARDWARE_DEVICES, normalizeHardwareConfig } from "@/lib/hardware-pricing";
import type { LegalProfile } from "@/lib/org-legal-profile";

import type {
  ClosingDocumentDraft,
  ClosingLine,
  PartySnapshot,
  PlatformRequisites,
} from "./types";

/**
 * Сборка снимка УПД из заказа — чистая функция, без базы.
 *
 * Правила (решения владельца, 2026-09-09):
 * - номер = номер заказа, дата = дата оплаты;
 * - сумма документа = то, что пришло деньгами (`amountRub`); баллы —
 *   скидка, о ней сказано в описании строки;
 * - оборудование из комплекта — строками в том же документе по каталогу
 *   `hardware-pricing`; услуга получает остаток денег. Если деньгами
 *   не покрыто даже оборудование (часть закрыта баллами), строки
 *   оборудования пропорционально уменьшаются, чтобы итог документа
 *   равнялся оплате: закрывающий документ сверяют с выпиской банка.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MOSCOW_TZ = "Europe/Moscow";

export function formatRuDate(date: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: MOSCOW_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export type BuildInput = {
  order: {
    id: number;
    amountRub: number;
    pointsSpent: number;
    paidAt: Date;
    description: string;
    bundleConfig: unknown;
    promoCode?: string | null;
    discountRub?: number;
    /** Акция при оформлении: процент и скидка в рублях (снимок из заказа). */
    promotionPercent?: number | null;
    promotionDiscountRub?: number;
  };
  tariff: { title: string; periodDays: number } | null;
  /** Конец оплаченного периода, известен при оплате; иначе считаем от даты оплаты. */
  subscriptionEnd: Date | null;
  organization: {
    name: string;
    inn: string | null;
    address: string | null;
    legalProfile: LegalProfile | null;
  };
  requisites: PlatformRequisites;
};

/** Покупатель: юрпрофиль по ДаДате точнее, фолбэк — то, что ввели руками. */
export function buildBuyerSnapshot(org: BuildInput["organization"]): PartySnapshot {
  const profile = org.legalProfile;
  const name = profile?.nameFull?.trim() || profile?.nameShort?.trim() || org.name.trim();
  const inn = profile?.inn?.trim() || org.inn?.trim() || null;
  return {
    name,
    inn: inn || null,
    kpp: profile?.kpp?.trim() || null,
    ogrn: profile?.ogrn?.trim() || null,
    address: profile?.address?.trim() || org.address?.trim() || null,
    head: profile?.management?.name
      ? { post: profile.management.post ?? "Руководитель", name: profile.management.name }
      : null,
  };
}

export function buildSellerSnapshot(r: PlatformRequisites): PartySnapshot {
  return {
    name: r.nameFull.trim(),
    inn: r.inn.trim() || null,
    kpp: r.kpp.trim() || null,
    ogrn: r.ogrn.trim() || null,
    address: r.address.trim() || null,
    head: { post: r.head.post.trim(), name: r.head.name.trim() },
    bank: { ...r.bank },
  };
}

/** Оплаченный период: конец известен — начало на periodDays раньше. */
export function subscriptionPeriod(input: {
  paidAt: Date;
  periodDays: number;
  subscriptionEnd: Date | null;
}): { from: Date; to: Date } {
  const to = input.subscriptionEnd ?? new Date(input.paidAt.getTime() + input.periodDays * DAY_MS);
  const from = new Date(to.getTime() - input.periodDays * DAY_MS);
  return { from, to };
}

export function buildClosingLines(input: BuildInput): ClosingLine[] {
  const money = round2(Math.max(0, input.order.amountRub));
  const points = Math.max(0, input.order.pointsSpent);
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

  // Деньгами не покрыто даже оборудование — уменьшаем его строки
  // пропорционально, услуга остаётся без денег и в документ не попадает.
  if (hardwareSum > money && hardwareSum > 0) {
    const factor = money / hardwareSum;
    let acc = 0;
    hardware.forEach((line, index) => {
      const isLast = index === hardware.length - 1;
      const sum = isLast ? round2(money - acc) : round2(line.sumRub * factor);
      acc = round2(acc + sum);
      line.sumRub = sum;
      line.priceRub = round2(sum / line.qty);
    });
    return hardware;
  }

  const serviceSum = round2(money - hardwareSum);
  const period = subscriptionPeriod({
    paidAt: input.order.paidAt,
    periodDays: input.tariff?.periodDays ?? 30,
    subscriptionEnd: input.subscriptionEnd,
  });
  const tariffTitle = input.tariff?.title?.trim() || input.order.description.trim() || "Подписка";
  const promotionNote =
    (input.order.promotionDiscountRub ?? 0) > 0 && input.order.promotionPercent
      ? ` Скидка по акции (−${input.order.promotionPercent} %): ${formatRub(input.order.promotionDiscountRub ?? 0)}.`
      : "";
  const promoNote =
    input.order.promoCode && (input.order.discountRub ?? 0) > 0
      ? ` Промокод ${input.order.promoCode}: −${formatRub(input.order.discountRub ?? 0)}.`
      : "";
  const discount =
    promotionNote + promoNote + (points > 0 ? ` Скидка баллами: ${formatRub(points)}.` : "");
  const service: ClosingLine = {
    title: `Доступ к сервису WeSetup, тариф «${tariffTitle}», период ${formatRuDate(period.from)} — ${formatRuDate(period.to)}.${discount}`,
    unit: "усл. ед.",
    unitCode: "876",
    qty: 1,
    priceRub: serviceSum,
    sumRub: serviceSum,
  };

  // Услуга без денег (всё ушло на оборудование) — строка не нужна.
  return serviceSum > 0 || hardware.length === 0 ? [service, ...hardware] : hardware;
}

export function buildClosingDocument(input: BuildInput): ClosingDocumentDraft {
  const lines = buildClosingLines(input);
  const totalRub = round2(lines.reduce((sum, line) => sum + line.sumRub, 0));
  const date = formatRuDate(input.order.paidAt);
  return {
    orderId: input.order.id,
    number: String(input.order.id),
    issuedAt: input.order.paidAt,
    seller: buildSellerSnapshot(input.requisites),
    buyer: buildBuyerSnapshot(input.organization),
    lines,
    totalRub,
    vatMode: input.requisites.vatMode,
    basis: `Договор-оферта (wesetup.ru/oferta), заказ № ${input.order.id} от ${date}`,
    paymentDocument: `№ ${input.order.id} от ${date}`,
  };
}

export function formatRub(value: number): string {
  return `${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value)} ₽`;
}

/** Сумма прописью для строки «Всего к оплате» — рубли и копейки. */
export function amountInWords(value: number): string {
  const rub = Math.floor(value + 1e-9);
  const kop = Math.round((value - rub) * 100);
  return `${numberToWords(rub)} ${plural(rub, ["рубль", "рубля", "рублей"])} ${String(kop).padStart(2, "0")} ${plural(kop, ["копейка", "копейки", "копеек"])}`;
}

function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}

const ONES = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const ONES_F = ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const TEENS = [
  "десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать",
  "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать",
];
const TENS = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"];
const HUNDREDS = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"];

function triad(n: number, feminine: boolean): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const o = n % 10;
  if (h) parts.push(HUNDREDS[h]);
  if (t === 1) parts.push(TEENS[o]);
  else {
    if (t) parts.push(TENS[t]);
    if (o) parts.push((feminine ? ONES_F : ONES)[o]);
  }
  return parts.join(" ");
}

export function numberToWords(n: number): string {
  if (n === 0) return "ноль";
  const groups: Array<{ forms: [string, string, string] | null; feminine: boolean }> = [
    { forms: null, feminine: false },
    { forms: ["тысяча", "тысячи", "тысяч"], feminine: true },
    { forms: ["миллион", "миллиона", "миллионов"], feminine: false },
    { forms: ["миллиард", "миллиарда", "миллиардов"], feminine: false },
  ];
  const parts: string[] = [];
  let rest = Math.floor(n);
  let index = 0;
  while (rest > 0 && index < groups.length) {
    const chunk = rest % 1000;
    if (chunk) {
      const group = groups[index];
      const words = triad(chunk, group.feminine);
      parts.unshift(group.forms ? `${words} ${plural(chunk, group.forms)}` : words);
    }
    rest = Math.floor(rest / 1000);
    index += 1;
  }
  return parts.join(" ");
}
