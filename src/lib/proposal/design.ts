import { formatPhone } from "@/lib/brand-docs/phone";
import { EMPTY_REQUISITES, type PlatformRequisites } from "@/lib/closing-documents/types";
import { bundleTotal, HARDWARE_BUNDLES } from "@/lib/hardware-pricing";
import { JOURNALS_TOTAL } from "@/lib/journal-catalog";
import { COMPARISON_GROUPS, TIER_NAMES, type ComparisonCell } from "@/lib/plan-catalog";
import { promotionEndLabel } from "@/lib/promo/promotions";
import { formalGreeting } from "@/lib/russian-names";
import {
  DEFAULT_PLAN_RATES,
  POINTS_DISCOUNT_FROM,
  POINTS_DISCOUNT_PERCENT,
  PPK_INDIVIDUAL_FROM_RUB,
  SEATS_PER_POINT,
  STORAGE_BYTES,
  TRIAL_DAYS,
  planMonthlyRub,
  planPeriodPriceRub,
  type PaidTier,
  type PlanRates,
} from "@/lib/tariff-plans";

import { computeProposalPrice, formatProposalRub } from "./price";
import type { ProposalPromo, ProposalSender, ProposalVars } from "./types";
import type { AppliedPromotion } from "@/lib/promo/promotions";

/**
 * КП в дизайне «WeSetup - КП и счета (новый дизайн)» (2026-10-30): тексты
 * образца, числа — живые. Чистая функция: цены тарифов, цена ППК и пакета
 * оборудования, акция и реквизиты приходят из контекста (`context.server.ts`).
 *
 *   • стоимость «Каждый месяц / Сразу за год» — `PlanRates` (ROOT → тарифы),
 *     акция и промокод — тем же порядком, что на оплате (`computeProposalPrice`);
 *   • «Дополнительно» — ППК «от» (`readPpkIndividualPrice`), в «Премиуме» ещё
 *     датчики с установкой «от» (самый дешёвый пакет оборудования); каждую
 *     строку можно выключить (`vars.extras`);
 *   • «Что входит» — строки из `COMPARISON_GROUPS` и лимитов `tariff-plans.ts`;
 *   • слово «бланк» в текстах для человека запрещено (no-blank-word) —
 *     «готовые бланки» образца у нас «готовые шаблоны документов».
 */

export type ProposalDesignCell = { kind: "yes" } | { kind: "no" } | { kind: "text"; text: string };

export type ProposalDesign = {
  plan: PaidTier;
  planName: string;
  title: string;
  /** «для ООО «Ромашка»» или null. */
  forLine: string | null;
  /** «Электронные журналы WeSetup, тариф «Стандарт» · 29 октября 2026 г.» */
  metaLine: string;
  /** «Генеральному директору Куликовой Виктории Викторовне» или null. */
  addressee: string | null;
  greeting: string;
  lead: [string, string];
  price: {
    title: string;
    columns: [string, string, string, string];
    month: { label: string; monthly: string; saving: string; total: string };
    year: { label: string; monthly: string; saving: string; total: string };
    extras: Array<{ key: "ppk" | "equipment"; label: string; price: string }>;
    /** Скидка по промокоду или акции — одной фразой; null — цены без скидок. */
    discountNote: string | null;
    note: string;
  };
  comparison: {
    title: string;
    columns: [string, string];
    current: 0 | 1;
    rows: Array<{ label: string; cells: [ProposalDesignCell, ProposalDesignCell] }>;
    priceRow: { label: string; values: [string, string] };
  };
  steps: { title: string; items: Array<{ title: string; text: string }> };
  sender: { displayName: string; initials: string; position: string; signature: string | null };
  contact: { lines: [string, string]; phone: string | null; email: string | null; qrUrl: string; qrCaption: string };
  disclaimer: string;
  /** Продавец для шапки и подвала листа (реквизиты из ROOT; пустые поля — пустые строки). */
  seller: PlatformRequisites;
};

export type ProposalDesignInput = {
  vars: ProposalVars;
  now: Date;
  dateLabel: string;
  requisites: PlatformRequisites | null;
  rates?: PlanRates;
  ppkFromRub?: number;
  equipmentFromRub?: number;
  promotion: AppliedPromotion | null;
  invoiceReady: boolean;
  sellerShort: string;
  sellerPhone: string | null;
  sellerEmail: string | null;
  sender: ProposalSender;
  ctaUrl: string;
  promoCode: string | null;
};

const NBSP = String.fromCharCode(0xa0);
const TIERS: readonly [PaidTier, PaidTier] = ["standard", "premium"];

function formatPhoneOrNull(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? formatPhone(text) : null;
}

/** Самый дешёвый готовый пакет оборудования — «датчики с установкой от …». */
export function equipmentFromRub(): number {
  return Math.min(...HARDWARE_BUNDLES.map(bundleTotal));
}

const NUMBER_GENITIVE: Record<number, string> = { 2: "двух", 3: "трёх", 4: "четырёх", 5: "пяти" };

function cellOf(rowKey: string, tier: PaidTier): ComparisonCell | null {
  for (const group of COMPARISON_GROUPS) {
    const row = group.rows.find((item) => item.key === rowKey);
    if (row) return row.cells[tier];
  }
  return null;
}

function yesNo(rowKey: string, tier: PaidTier): ProposalDesignCell {
  const cell = cellOf(rowKey, tier);
  return cell?.kind === "yes" ? { kind: "yes" } : { kind: "no" };
}

function storageLabel(tier: PaidTier): string {
  const mb = STORAGE_BYTES[tier] / (1024 * 1024);
  return mb >= 1024 ? `${Math.round(mb / 1024)}${NBSP}ГБ` : `${Math.round(mb)}${NBSP}МБ`;
}

/** Ряды «Что входит» — подписи образца, значения из каталога тарифов. */
export function proposalComparisonRows(): Array<{ label: string; cells: [ProposalDesignCell, ProposalDesignCell] }> {
  const both = (make: (tier: PaidTier) => ProposalDesignCell): [ProposalDesignCell, ProposalDesignCell] => [make(TIERS[0]), make(TIERS[1])];
  return [
    {
      label: "Журналы",
      cells: both((tier) => (cellOf("journals", tier)?.kind === "text" ? { kind: "text", text: `все ${JOURNALS_TOTAL}` } : { kind: "no" })),
    },
    { label: "Заполнение с телефона", cells: both((tier) => yesNo("telegram", tier)) },
    { label: "Печать журналов для проверки", cells: both((tier) => yesNo("pdf", tier)) },
    { label: "Сотрудников на одну точку", cells: both((tier) => ({ kind: "text", text: `до ${SEATS_PER_POINT[tier]}` })) },
    { label: "Место для документов", cells: both((tier) => ({ kind: "text", text: storageLabel(tier) })) },
    { label: "Готовые шаблоны документов", cells: both((tier) => yesNo("typicalPackage", tier)) },
    { label: "Показания по фото термометра", cells: both((tier) => yesNo("photoAutofill", tier)) },
    { label: "Подключение датчиков", cells: both((tier) => yesNo("equipmentConnect", tier)) },
    { label: "Ветсправки в «Меркурии»", cells: both((tier) => yesNo("mercury", tier)) },
  ];
}

/** «Волков Денис Владимирович» → «Денис Волков»; прочее — как есть. */
export function senderDisplayName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 3 && /^[А-ЯЁ][а-яё-]+$/.test(parts[0]) && /(ич|вна|чна)$/.test(parts[2])) return `${parts[1]} ${parts[0]}`;
  return name.trim();
}

/** «Волков Д. В.» — только для полного ФИО «Фамилия Имя Отчество». */
export function senderSignature(name: string): string | null {
  const parts = name.trim().split(/\s+/);
  if (parts.length !== 3 || !/(ич|вна|чна)$/.test(parts[2])) return null;
  return `${parts[0]}${NBSP}${parts[1].charAt(0)}.${NBSP}${parts[2].charAt(0)}.`;
}

function initials(displayName: string): string {
  const letters = displayName
    .split(/[\s,]+/)
    .filter((part) => /^[A-Za-zА-Яа-яЁё]/.test(part))
    .slice(0, 2)
    .map((part) => part.charAt(0).toLocaleUpperCase("ru-RU"));
  return letters.join("") || "WS";
}

function discountNote(price: ReturnType<typeof computeProposalPrice>, promo: ProposalPromo | null | undefined): string | null {
  if (price.promo && price.discountLabel) {
    return `Цены с${NBSP}учётом промокода ${price.promo.code}: ${price.discountLabel}${price.promoTerm ? ` ${price.promoTerm}` : ""}.`;
  }
  if (price.promotion) return `Цены с${NBSP}учётом акции −${price.promotion.percent}${NBSP}% ${promotionEndLabel(price.promotion.endsAt)}.`;
  if (price.promoExpired && promo) return `Срок промокода ${promo.code} истёк — цены без скидки.`;
  return null;
}

export function buildProposalDesign(input: ProposalDesignInput): ProposalDesign {
  const { vars } = input;
  const plan: PaidTier = vars.plan === "premium" ? "premium" : "standard";
  const rates = input.rates ?? DEFAULT_PLAN_RATES;
  const planName = TIER_NAMES[plan];

  const monthBase = planPeriodPriceRub(rates, plan, "month");
  const yearBase = planPeriodPriceRub(rates, plan, "year");
  const month = computeProposalPrice({ baseRub: monthBase, promotion: input.promotion, promo: vars.promo, now: input.now });
  const year = computeProposalPrice({ baseRub: yearBase, promotion: input.promotion, promo: vars.promo, now: input.now });
  const savingRub = Math.max(0, month.priceRub * 12 - year.priceRub);

  const extrasWanted = { ppk: vars.extras?.ppk !== false, equipment: vars.extras?.equipment !== false };
  const extras: ProposalDesign["price"]["extras"] = [];
  if (plan === "premium" && extrasWanted.equipment) {
    extras.push({
      key: "equipment",
      label: "Дополнительно: датчики температуры с установкой",
      price: `от ${formatProposalRub(input.equipmentFromRub ?? equipmentFromRub())}`,
    });
  }
  if (extrasWanted.ppk) {
    extras.push({
      key: "ppk",
      label: "Дополнительно: программа производственного контроля под ваше заведение",
      price: `от ${formatProposalRub(input.ppkFromRub ?? PPK_INDIVIDUAL_FROM_RUB)}`,
    });
  }

  const from = NUMBER_GENITIVE[POINTS_DISCOUNT_FROM] ?? String(POINTS_DISCOUNT_FROM);
  const note = [
    `Цены за одну точку (один адрес), без НДС. Каждая следующая точка оплачивается так же, от ${from} точек — скидка ${POINTS_DISCOUNT_PERCENT}${NBSP}% на каждую.`,
    plan === "premium" ? `Больше ${SEATS_PER_POINT.premium} сотрудников на точку — по договорённости.` : null,
    input.invoiceReady ? "Счёт выставим на любой вариант — выберите удобный." : "Оплата картой на сайте.",
  ]
    .filter(Boolean)
    .join(" ");

  const sender = input.sender;
  const displayName = senderDisplayName(sender.name);
  const position = [sender.position?.trim() || null, input.sellerShort || null].filter(Boolean).join(" ") || "WeSetup";

  const greeting = vars.greeting?.trim() || (vars.recipientName ? formalGreeting(vars.recipientName) : "Добрый день!");

  return {
    plan,
    planName,
    title: "Коммерческое предложение",
    forLine: vars.companyName ? `для ${vars.companyName}` : null,
    metaLine: `Электронные журналы WeSetup, тариф «${planName}»  ·  ${input.dateLabel}${NBSP}г.`,
    addressee: vars.addressee?.trim() || null,
    greeting,
    lead: [
      "Спасибо за интерес к WeSetup! Сотрудники заполняют журналы с телефона, а вы видите всё в одном месте.",
      "Бумажные тетради больше не нужны.",
    ],
    price: {
      title: "Стоимость за одну точку",
      columns: ["Как платить", "В месяц", "Экономия", "К оплате"],
      month: {
        label: "Каждый месяц",
        monthly: formatProposalRub(month.priceRub),
        saving: "—",
        total: `${formatProposalRub(month.priceRub)} в${NBSP}месяц`,
      },
      year: {
        label: "Сразу за год — выгоднее",
        monthly: formatProposalRub(Math.round(year.priceRub / 12)),
        saving: savingRub > 0 ? formatProposalRub(savingRub) : "—",
        total: `${formatProposalRub(year.priceRub)} за${NBSP}год`,
      },
      extras,
      discountNote: discountNote(year, vars.promo),
      note,
    },
    comparison: {
      title: "Что входит",
      columns: [TIER_NAMES.standard, TIER_NAMES.premium],
      current: plan === "standard" ? 0 : 1,
      rows: proposalComparisonRows(),
      priceRow: {
        label: "В месяц при оплате за год",
        values: [formatProposalRub(planMonthlyRub(rates, "standard", "year")), formatProposalRub(planMonthlyRub(rates, "premium", "year"))],
      },
    },
    steps: {
      title: "Как начать",
      items: [
        { title: "Пробуете бесплатно", text: `${TRIAL_DAYS}${NBSP}дней, без банковской карты.` },
        { title: "Подключаете сотрудников", text: "Заполняют журналы с телефона." },
        { title: input.invoiceReady ? "Оплачиваете по счёту" : "Оплачиваете картой", text: "Каждый месяц или сразу за год." },
        { title: "Спокойно проходите проверку", text: "Журналы всегда готовы к печати." },
      ],
    },
    sender: { displayName, initials: initials(displayName), position, signature: senderSignature(sender.name) },
    contact: {
      lines: ["Есть вопросы?", "Поможем подключиться."],
      phone: formatPhoneOrNull(sender.phone) ?? formatPhoneOrNull(input.sellerPhone),
      email: sender.email?.trim() || input.sellerEmail,
      qrUrl: input.ctaUrl,
      qrCaption: input.promoCode ? `Промокод ${input.promoCode}` : "Попробовать бесплатно",
    },
    disclaimer: `Предложение не является публичной офертой. Цены на ${input.dateLabel}${NBSP}г., подробнее — wesetup.ru/pricing.`,
    seller: input.requisites ?? { ...EMPTY_REQUISITES, nameShort: "WeSetup" },
  };
}
