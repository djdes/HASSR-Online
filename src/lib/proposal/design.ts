import { formatPhone } from "@/lib/brand-docs/phone";
import { EMPTY_REQUISITES, type PlatformRequisites } from "@/lib/closing-documents/types";
import { bundleTotal, HARDWARE_BUNDLES } from "@/lib/hardware-pricing";
import { JOURNALS_TOTAL } from "@/lib/journal-catalog";
import { COMPARISON_GROUPS, POINTS_DISCOUNT_LINE, TIER_NAMES, VIP_HOTLINE_HOURS, type ComparisonCell } from "@/lib/plan-catalog";
import { promotionEndLabel } from "@/lib/promo/promotions";
import { formalGreeting } from "@/lib/russian-names";
import {
  DEFAULT_PLAN_RATES,
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
 *   • «Дополнительно» — ППК «от» (услуга «ppk-development»), в «Премиуме» ещё
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
type TierPair = readonly [PaidTier, PaidTier];
/**
 * Два тарифа в «Что входит»: выбранный и соседний. Для «ВИП» — «Премиум»
 * рядом, иначе — «Стандарт» и «Премиум» (лист рассчитан на две колонки).
 */
export function proposalTierPair(plan: PaidTier): TierPair {
  return plan === "vip" ? ["premium", "vip"] : ["standard", "premium"];
}

function formatPhoneOrNull(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? formatPhone(text) : null;
}

/** Самый дешёвый готовый пакет оборудования — «датчики с установкой от …». */
export function equipmentFromRub(): number {
  return Math.min(...HARDWARE_BUNDLES.map(bundleTotal));
}

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
export function proposalComparisonRows(
  tiers: TierPair = proposalTierPair("standard"),
): Array<{ label: string; cells: [ProposalDesignCell, ProposalDesignCell] }> {
  const both = (make: (tier: PaidTier) => ProposalDesignCell): [ProposalDesignCell, ProposalDesignCell] => [make(tiers[0]), make(tiers[1])];
  if (tiers[1] === "vip") {
    // «Премиум» и «ВИП» различаются сопровождением — его и показываем, общие
    // ряды сокращены, чтобы таблица осталась той же высоты.
    return [
      {
        label: "Журналы",
        cells: both((tier) => (cellOf("journals", tier)?.kind === "text" ? { kind: "text", text: `все ${JOURNALS_TOTAL}` } : { kind: "no" })),
      },
      { label: "Заполнение с телефона", cells: both((tier) => yesNo("telegram", tier)) },
      { label: "Сотрудников на одну точку", cells: both((tier) => ({ kind: "text", text: `до ${SEATS_PER_POINT[tier]}` })) },
      { label: "Место для документов", cells: both((tier) => ({ kind: "text", text: storageLabel(tier) })) },
      { label: "Подключение датчиков", cells: both((tier) => yesNo("equipmentConnect", tier)) },
      { label: "Ветсправки в «Меркурии»", cells: both((tier) => yesNo("mercury", tier)) },
      {
        label: "Горячая линия",
        cells: both((tier) => (cellOf("hotline", tier)?.kind === "text" ? { kind: "text", text: `${VIP_HOTLINE_HOURS}${NBSP}ч/мес` } : { kind: "no" })),
      },
      { label: "Расширенный банк данных", cells: both((tier) => yesNo("dataBank", tier)) },
      { label: "Личный консультант", cells: both((tier) => yesNo("consultant", tier)) },
    ];
  }
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
  const plan: PaidTier = vars.plan === "premium" || vars.plan === "vip" ? vars.plan : "standard";
  const tiers = proposalTierPair(plan);
  const rates = input.rates ?? DEFAULT_PLAN_RATES;
  const planName = TIER_NAMES[plan];

  const monthBase = planPeriodPriceRub(rates, plan, "month");
  const yearBase = planPeriodPriceRub(rates, plan, "year");
  const month = computeProposalPrice({ baseRub: monthBase, promotion: input.promotion, promo: vars.promo, now: input.now });
  const year = computeProposalPrice({ baseRub: yearBase, promotion: input.promotion, promo: vars.promo, now: input.now });
  const savingRub = Math.max(0, month.priceRub * 12 - year.priceRub);

  const extrasWanted = { ppk: vars.extras?.ppk !== false, equipment: vars.extras?.equipment !== false };
  const extras: ProposalDesign["price"]["extras"] = [];
  if (plan !== "standard" && extrasWanted.equipment) {
    extras.push({
      key: "equipment",
      label: "Дополнительно: датчики температуры с установкой",
      price: `от ${formatProposalRub(input.equipmentFromRub ?? equipmentFromRub())}`,
    });
  }
  if (extrasWanted.ppk) {
    extras.push({
      key: "ppk",
      label: "Дополнительно: разработка программы производственного контроля",
      price: `от ${formatProposalRub(input.ppkFromRub ?? PPK_INDIVIDUAL_FROM_RUB)}`,
    });
  }

  const note = [
    `Цены за одну точку (один адрес), без НДС. Каждая следующая точка оплачивается так же; скидка на все точки: ${POINTS_DISCOUNT_LINE.replace(/ %/g, `${NBSP}%`)}.`,
    plan !== "standard" ? `Более ${SEATS_PER_POINT[plan]} сотрудников на точку — по согласованию.` : null,
    input.invoiceReady ? `Условия оплаты: 100${NBSP}% предоплата по счёту.` : `Условия оплаты: 100${NBSP}% предоплата банковской картой на сайте.`,
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
      "Предлагаем заключить договор на предоставление доступа к сервису WeSetup для ведения журналов СанПиН и ХАССП в электронном виде.",
      "Стоимость, состав тарифа и порядок подключения приведены ниже.",
    ],
    price: {
      title: "Стоимость за одну точку",
      columns: ["Период оплаты", "В месяц", "Экономия", "К оплате"],
      month: {
        label: "Оплата за месяц",
        monthly: formatProposalRub(month.priceRub),
        saving: "—",
        total: `${formatProposalRub(month.priceRub)} в${NBSP}месяц`,
      },
      year: {
        label: "Оплата за год",
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
      columns: [TIER_NAMES[tiers[0]], TIER_NAMES[tiers[1]]],
      current: plan === tiers[0] ? 0 : 1,
      rows: proposalComparisonRows(tiers),
      priceRow: {
        label: "В месяц при оплате за год",
        values: [formatProposalRub(planMonthlyRub(rates, tiers[0], "year")), formatProposalRub(planMonthlyRub(rates, tiers[1], "year"))],
      },
    },
    steps: {
      title: "Порядок подключения",
      items: [
        { title: "Пробный период", text: `${TRIAL_DAYS}${NBSP}дней бесплатно.` },
        { title: "Договор", text: "Подписание по ЭДО или сканами." },
        { title: input.invoiceReady ? "Оплата по счёту" : "Оплата банковской картой", text: `100${NBSP}% предоплата за месяц или за год.` },
        { title: "Доступ к сервису", text: "1 рабочий день после оплаты." },
      ],
    },
    sender: { displayName, initials: initials(displayName), position, signature: senderSignature(sender.name) },
    contact: {
      lines: ["Контакты", "Договор, счёт, подключение:"],
      phone: formatPhoneOrNull(sender.phone) ?? formatPhoneOrNull(input.sellerPhone),
      email: sender.email?.trim() || input.sellerEmail,
      qrUrl: input.ctaUrl,
      qrCaption: input.promoCode ? `Промокод ${input.promoCode}` : "Регистрация в сервисе",
    },
    disclaimer: `Предложение не является публичной офертой. Цены на ${input.dateLabel}${NBSP}г., подробнее — wesetup.ru/pricing.`,
    seller: input.requisites ?? { ...EMPTY_REQUISITES, nameShort: "WeSetup" },
  };
}
