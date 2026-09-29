import type { PlatformRequisites } from "@/lib/closing-documents/types";
import {
  SUBSCRIPTION_QUOTED_NAME,
  billingPhase,
  freePeriodRangeLabel,
  type FreePeriodSettings,
} from "@/lib/billing-period";
import { ACTIVE_JOURNAL_CATALOG, JOURNALS_TOTAL_LABEL } from "@/lib/journal-catalog";
import type { OrgSphere } from "@/lib/org-profile";
import {
  EXTRA_USER_PRICE_RUB,
  SUBSCRIPTION_MAX_USERS,
  SUBSCRIPTION_SEATS_LABEL,
  employeesGenitiveLabel,
} from "@/lib/plan-catalog";
import { FREE_MAX_USERS } from "@/lib/plan-limits";
import { pluralRu } from "@/lib/plural-ru";
import { promotionEndLabel, type AppliedPromotion } from "@/lib/promo/promotions";
import { rulesFor, type RuleBasis } from "@/lib/sphere-journal-rules";

import { displayUrl, proposalCta, type ProposalCtaKind } from "./cta";
import { computeProposalPrice, formatProposalRub, type ProposalPrice } from "./price";
import { proposalAlsoPhone, proposalSphereCopy, proposalSteps, type ProposalStep } from "./spheres";
import type { ProposalSender, ProposalVars } from "./types";
import { normalizeProposalVars } from "./vars";

/**
 * Модель одной страницы КП — общий источник для PDF, письма и
 * веб-версии: тексты собираются здесь один раз, отрисовщики только
 * раскладывают. Чистая функция: всё, что читается из базы (тариф, акция,
 * бесплатный период, реквизиты, отправитель по умолчанию), приходит в
 * `ProposalContext` (`context.server.ts`).
 *
 * Правила честности (спека proposal-kp, п. 2):
 *   • числа — только из констант и тарифа (`JOURNALS_TOTAL`,
 *     `FREE_MAX_USERS`, `SUBSCRIPTION_MAX_USERS`, `PlatformTariff`);
 *   • «обязательные» — только `electronicRequired` сферы, с условием
 *     («при наличии фритюра»); остальное — «рекомендуем»;
 *   • «по счёту для юрлиц» — только если счёт реально выставляется
 *     (реквизиты заполнены, `invoiceRequisitesReady`);
 *   • фото термометра — «на подписке» (автоввод только на платном тарифе);
 *   • про магазины приложений — ни слова.
 */

export type ProposalContext = {
  now: Date;
  /** Цена тарифа «Подписка» (`PlatformTariff` monthly), ₽ за период. */
  tariffPriceRub: number;
  /** Тариф в продаже (иначе ROOT-генератор предупреждает). */
  tariffActive: boolean;
  /** Действующая акция на подписку или null. */
  promotion: AppliedPromotion | null;
  /** Настройки бесплатного периода (1–10 октября и т. п.). */
  freePeriod: FreePeriodSettings | null;
  /** Реквизиты нашей организации (`/root/requisites`). */
  requisites: PlatformRequisites | null;
  /** Счёт по безналу выставляется (реквизиты для счёта заполнены). */
  invoiceReady: boolean;
  /** Отправитель по умолчанию (`PlatformSetting` `proposal.sender`). */
  defaultSender: ProposalSender | null;
};

export type ProposalJournalItem = {
  code: string;
  name: string;
  /**
   * Пояснение к обязательному журналу — как на публичной странице сферы:
   * условие («при наличии фритюра») и основание, если это не санитарные
   * правила («спрашивают при проверках», «запись по ХАССП»).
   */
  note: string | null;
};

export type ProposalOfferRow = {
  key: "free" | "team";
  title: string;
  /** «0 ₽», «1 791 ₽». */
  price: string;
  /** «/мес» или пусто. */
  unit: string;
  /** Зачёркнутая цена или null. */
  oldPrice: string | null;
  /** Плашка скидки: «−10 % навсегда». */
  badge: string | null;
  text: string;
};

export type ProposalContactLine = {
  kind: "phone" | "email" | "telegram";
  label: string;
  value: string;
  href: string;
};

export type ProposalContent = {
  sphere: OrgSphere;
  sphereLabel: string;
  /** «29 сентября 2026». */
  dateLabel: string;
  eyebrow: string;
  /** Компания и имя адресата одной строкой или null. */
  addressee: string | null;
  companyName: string | null;
  recipientName: string | null;
  /** «Электронные журналы ХАССП и СанПиН» — первая часть заголовка. */
  titleLead: string;
  /** «для ресторана» — вторая часть (выделяется цветом); «для» не отрывается от слова. */
  titleFor: string;
  title: string;
  lead: string;
  steps: [ProposalStep, ProposalStep, ProposalStep];
  /** Под шагами: остальные журналы, напоминания, проверяющий. */
  stepsNote: string;
  benefitsTitle: string;
  benefits: Array<{ title: string; text: string }>;
  journalsTitle: string;
  journalsRequired: ProposalJournalItem[];
  journalsRecommended: ProposalJournalItem[];
  /** «и ещё 8 рекомендуемых» или null. */
  journalsMore: string | null;
  /** «Всего в каталоге — 41 журнал: любой включается в настройках.» */
  journalsTotal: string;
  offer: {
    title: string;
    rows: [ProposalOfferRow, ProposalOfferRow];
    /** Пояснения: бесплатный период, конец акции, истёкший промокод. */
    notes: string[];
    howTo: string;
    /** То же для письма: на телефоне QR в письме скрыт — главное действие кнопка. */
    howToEmail: string;
    payment: string;
    promoCode: string | null;
    ctaUrl: string;
    ctaKind: ProposalCtaKind;
    ctaLabel: string;
    /** Подпись под QR: промокод или короткий адрес. */
    qrCaption: string;
  };
  sender: { title: string; name: string; lines: ProposalContactLine[] } | null;
  /** Реквизиты строками (как на /root/requisites) или null, если не заполнены. */
  requisites: string[] | null;
  site: string;
  price: ProposalPrice;
  subject: string;
  preheader: string;
};

const NBSP = "\u00a0";
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const MONTHS_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

/** «29 сентября 2026» по Москве. */
export function proposalDateLabel(date: Date): string {
  const shifted = new Date(date.getTime() + MSK_OFFSET_MS);
  return `${shifted.getUTCDate()}${NBSP}${MONTHS_GENITIVE[shifted.getUTCMonth()]} ${shifted.getUTCFullYear()}`;
}

const NAME_BY_CODE = new Map<string, string>(ACTIVE_JOURNAL_CATALOG.map((item) => [item.code, item.name]));

function journalName(code: string): string {
  return NAME_BY_CODE.get(code) ?? code;
}

/** «нужен при наличии фритюра» → «при наличии фритюра». */
export function shortCondition(condition: string | undefined): string | null {
  if (!condition) return null;
  const text = condition.replace(/^нужен,?\s*/i, "").trim();
  return text || null;
}

/**
 * Основание не из санитарных правил — называем честно, как на публичной
 * странице сферы (`BASIS_LABEL` в sphere-public-content.ts): бракераж в
 * детском саду СанПиН не требует, его «спрашивают при проверках».
 */
const BASIS_NOTE: Partial<Record<RuleBasis, string>> = {
  practice: "спрашивают при проверках",
  haccp: "запись по ХАССП",
};

function requiredNote(rule: { condition?: string; basis?: RuleBasis }): string | null {
  const condition = shortCondition(rule.condition);
  const basis = rule.basis ? BASIS_NOTE[rule.basis] ?? null : null;
  // «если в плане ХАССП есть контроль металлопримесей» — про ХАССП уже сказано.
  const parts = [condition, basis && !(rule.basis === "haccp" && condition?.includes("ХАССП")) ? basis : null].filter(Boolean);
  return parts.length > 0 ? parts.join("; ") : null;
}

/** Сколько названий журналов показываем (спека: 6–8) и потолок обязательных. */
export const JOURNALS_SHOWN = 7;
export const JOURNALS_SHOWN_MAX = 8;

export function proposalJournals(sphere: OrgSphere): {
  required: ProposalJournalItem[];
  recommended: ProposalJournalItem[];
  more: number;
} {
  const rules = rulesFor(sphere);
  const requiredAll = rules.electronicRequired.map((rule) => ({
    code: rule.code,
    name: journalName(rule.code),
    note: requiredNote(rule),
  }));
  const requiredCodes = new Set(requiredAll.map((item) => item.code));
  const recommendedAll = rules.electronicRecommended
    .filter((code) => !requiredCodes.has(code) && NAME_BY_CODE.has(code))
    .map((code) => ({ code, name: journalName(code), note: null }));
  const required = requiredAll.slice(0, JOURNALS_SHOWN_MAX);
  const recommended = recommendedAll.slice(0, Math.max(0, JOURNALS_SHOWN - required.length));
  const more = requiredAll.length + recommendedAll.length - required.length - recommended.length;
  return { required, recommended, more };
}

function contactLines(sender: ProposalSender): ProposalContactLine[] {
  const lines: ProposalContactLine[] = [];
  if (sender.phone) {
    const digits = sender.phone.replace(/[^\d+]/g, "");
    lines.push({ kind: "phone", label: "Телефон", value: sender.phone, href: `tel:${digits}` });
  }
  if (sender.email) {
    lines.push({ kind: "email", label: "Почта", value: sender.email, href: `mailto:${sender.email}` });
  }
  if (sender.telegram) {
    lines.push({
      kind: "telegram",
      label: "Telegram",
      value: `@${sender.telegram}`,
      href: `https://t.me/${sender.telegram}`,
    });
  }
  return lines;
}

/** Реквизиты строками: «ООО «…»», «ИНН … · КПП … · ОГРН …», адрес. */
export function requisitesLines(r: PlatformRequisites | null): string[] | null {
  if (!r) return null;
  const name = (r.nameShort || r.nameFull).trim();
  const inn = r.inn.trim();
  if (!name || !inn) return null;
  const ids = [`ИНН${NBSP}${inn}`];
  if (r.kpp.trim()) ids.push(`КПП${NBSP}${r.kpp.trim()}`);
  const ogrn = r.ogrn.replace(/\D/g, "");
  if (ogrn) ids.push(`${ogrn.length === 15 ? "ОГРНИП" : "ОГРН"}${NBSP}${ogrn}`);
  const lines = [name, ids.join(" · ")];
  if (r.address.trim()) lines.push(r.address.trim());
  return lines;
}

/** Отправитель без настройки ROOT: «Команда WeSetup» и контакты из реквизитов. */
export function fallbackSender(r: PlatformRequisites | null): ProposalSender {
  return {
    name: "Команда WeSetup",
    email: r?.email?.trim() || "support@wesetup.ru",
    phone: r?.phone?.trim() || null,
    telegram: null,
  };
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function buildProposalContent(input: ProposalVars, ctx: ProposalContext): ProposalContent {
  const vars = normalizeProposalVars(input);
  const copy = proposalSphereCopy(vars.sphere);
  const price = computeProposalPrice({
    baseRub: ctx.tariffPriceRub,
    promotion: ctx.promotion,
    promo: vars.promo,
    now: ctx.now,
  });
  const cta = proposalCta(vars, ctx.now);

  const titleLead = copy.food ? "Электронные журналы ХАССП и СанПиН" : "Электронные журналы СанПиН";
  const titleFor = `для${NBSP}${copy.forWhom}`;

  const legal = copy.food
    ? "СанПиН 2.3/2.4.4282-26 прямо разрешает вести их в электронном виде."
    : copy.sphere === "beauty"
      ? "Вести их можно в электронном виде и распечатать к проверке."
      : "Все записи — в одном кабинете, журнал к проверке распечатывается в любой момент.";
  const greeting = vars.recipientName ? `${vars.recipientName}, здравствуйте! ` : "";
  const lead = `${greeting}Предлагаем перевести журналы ${copy.your} на телефон: без бумажных тетрадей и переписывания перед проверкой. ${legal}`;

  const stepsNote = `Так же с телефона — ${proposalAlsoPhone(copy.sphere).text} и остальные журналы: у каждого свой QR-плакат. Не заполнили — руководителю придёт напоминание в Telegram и на почту. Проверяющему — журналы по форме СанПиН на печать или QR для просмотра без входа.`;

  const journals = proposalJournals(copy.sphere);
  const journalsMore =
    journals.more > 0
      ? `и ещё ${journals.more} ${pluralRu(journals.more, "рекомендуемый", "рекомендуемых", "рекомендуемых")}`
      : null;

  // ---- предложение
  const free: ProposalOfferRow = {
    key: "free",
    title: `Бесплатно — все ${JOURNALS_TOTAL_LABEL} для ${employeesGenitiveLabel(FREE_MAX_USERS)}`,
    price: formatProposalRub(0),
    unit: "",
    oldPrice: null,
    badge: null,
    text: "Без оплаты и без срока. Один сотрудник ведёт все журналы, записей — сколько угодно.",
  };

  let badge: string | null = null;
  if (price.promo && price.discountLabel) {
    badge = price.promoTerm ? `${price.discountLabel} ${price.promoTerm}` : `${price.discountLabel} по промокоду`;
  } else if (price.promotion) {
    badge = `−${price.promotion.percent}${NBSP}% по акции ${promotionEndLabel(price.promotion.endsAt)}`;
  }
  const team: ProposalOfferRow = {
    key: "team",
    title: `Команда ${SUBSCRIPTION_SEATS_LABEL}`,
    price: formatProposalRub(price.priceRub),
    unit: "/мес",
    oldPrice: price.oldRub !== null ? formatProposalRub(price.oldRub) : null,
    badge,
    // Автоввод с фото — только на платном тарифе (`hasPaidPlan` в /api/ocr/reading):
    // термометр, гигрометр, счётчик УФ-лампы.
    text: `Журналы заполняют ${copy.team} — каждый со своего телефона. На подписке показание можно снять фото ${
      copy.food ? "термометра" : "дисплея прибора"
    } — число подставится само. Каждый сотрудник сверх ${SUBSCRIPTION_MAX_USERS} — ${formatProposalRub(EXTRA_USER_PRICE_RUB)}/мес.`,
  };

  const notes: string[] = [];
  if (price.promotion && price.promo) {
    notes.push(
      price.afterPromotionRub !== null
        ? `Цена с акцией ${promotionEndLabel(price.promotion.endsAt)}, дальше — ${formatProposalRub(price.afterPromotionRub)}/мес: скидка по промокоду остаётся навсегда.`
        : `Цена с учётом акции ${promotionEndLabel(price.promotion.endsAt)}.`,
    );
  }
  if (ctx.freePeriod && ctx.freePeriod.transitionEnabled) {
    const phase = billingPhase(ctx.freePeriod, ctx.now);
    if (phase === "before" || phase === "free_period") {
      notes.push(`${freePeriodRangeLabel(ctx.freePeriod)} подписка ${SUBSCRIPTION_QUOTED_NAME} бесплатна для всех.`);
    }
  }
  if (price.promoExpired && vars.promo) {
    notes.push(`Срок промокода ${vars.promo.code} истёк — цены указаны без скидки.`);
  }

  let howTo: string;
  let howToEmail: string;
  let ctaLabel: string;
  let qrCaption: string;
  if (cta.kind === "promo" && price.promo) {
    howTo = `Отсканируйте QR — промокод применится сам. Или введите ${price.promo.code} при оплате на wesetup.ru.`;
    howToEmail = `Нажмите кнопку — промокод применится сам. Или введите ${price.promo.code} при оплате на wesetup.ru.`;
    ctaLabel = "Применить промокод";
    qrCaption = `Промокод ${price.promo.code}`;
  } else if (cta.kind === "custom") {
    howTo = price.promo
      ? `Отсканируйте QR или перейдите по ссылке. Промокод ${price.promo.code} введите при оплате на wesetup.ru.`
      : "Отсканируйте QR или перейдите по ссылке — там подробности и регистрация.";
    howToEmail = price.promo
      ? `Нажмите кнопку. Промокод ${price.promo.code} введите при оплате на wesetup.ru.`
      : "Нажмите кнопку — там подробности и регистрация.";
    ctaLabel = "Подробнее";
    qrCaption = displayUrl(cta.url);
  } else {
    const where =
      copy.sphere === "other" ? "откроется регистрация на wesetup.ru." : `откроется страница для ${copy.forWhom}: подробности и регистрация.`;
    howTo = `Отсканируйте QR — ${where}`;
    howToEmail = `Нажмите кнопку — ${where}`;
    ctaLabel = "Попробовать бесплатно";
    qrCaption = displayUrl(cta.url);
  }

  const payment = ctx.invoiceReady ? "Оплата картой или по счёту для юрлиц." : "Оплата картой на сайте.";

  const senderData = vars.sender ?? ctx.defaultSender ?? fallbackSender(ctx.requisites);
  const sender = senderData
    ? { title: "Контакты", name: senderData.name, lines: contactLines(senderData) }
    : null;

  const addressee = [vars.companyName, vars.recipientName].filter(Boolean).join(" · ") || null;

  const subjectCompany = vars.companyName ? truncate(vars.companyName, 40) : null;
  const subject = subjectCompany
    ? `${subjectCompany}: журналы СанПиН с телефона`
    : `Журналы СанПиН с телефона для ${copy.forWhom}`;
  const teamPrice = price.oldRub !== null
    ? `${formatProposalRub(price.priceRub)}/мес вместо ${formatProposalRub(price.oldRub)}`
    : `${formatProposalRub(price.priceRub)}/мес`;
  const preheader = `Бесплатно для ${employeesGenitiveLabel(FREE_MAX_USERS)}. Команда ${SUBSCRIPTION_SEATS_LABEL} — ${teamPrice}${
    price.promo && price.promoTerm ? `, скидка ${price.discountLabel?.replace("−", "")} ${price.promoTerm}` : ""
  }.`;

  return {
    sphere: copy.sphere,
    sphereLabel: copy.label,
    dateLabel: proposalDateLabel(ctx.now),
    eyebrow: "Коммерческое предложение",
    addressee,
    companyName: vars.companyName ?? null,
    recipientName: vars.recipientName ?? null,
    titleLead,
    titleFor,
    title: `${titleLead} ${titleFor}`,
    lead,
    steps: proposalSteps(copy),
    stepsNote,
    benefitsTitle: `Что получит ${copy.yourNom}`,
    benefits: copy.benefits.map((item) => ({ title: item.title, text: item.text })),
    journalsTitle: `Журналы для ${copy.forWhom}`,
    journalsRequired: journals.required,
    journalsRecommended: journals.recommended,
    journalsMore,
    journalsTotal: `Всего в каталоге — ${JOURNALS_TOTAL_LABEL}: любой включается в настройках.`,
    offer: {
      title: "Специальное предложение",
      rows: [free, team],
      notes,
      howTo,
      howToEmail,
      payment,
      promoCode: price.promo?.code ?? null,
      ctaUrl: cta.url,
      ctaKind: cta.kind,
      ctaLabel,
      qrCaption,
    },
    sender,
    requisites: requisitesLines(ctx.requisites),
    site: "wesetup.ru",
    price,
    subject,
    preheader,
  };
}
