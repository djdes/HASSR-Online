/**
 * Расчёт партнёрских вознаграждений — чистые функции без БД.
 *
 * Правила версионируются (`PartnerRewardRule`): начисление помнит
 * `ruleVersion`, поэтому новая версия правил не меняет старые строки.
 * Суммы в рублях с копейками: считаем в копейках целыми числами и
 * возвращаем число с двумя знаками (17 750 × 15 % = 2 662.50).
 */

export const ACCRUAL_KINDS = [
  "subscription",
  "hardware",
  "bonus",
  "subscription_reversal",
  "hardware_reversal",
  "bonus_reversal",
] as const;
export type AccrualKind = (typeof ACCRUAL_KINDS)[number];

export const ACCRUAL_STATUSES = ["accrued", "payable", "paid"] as const;
export type AccrualStatus = (typeof ACCRUAL_STATUSES)[number];

export const ACCRUAL_KIND_LABELS: Record<AccrualKind, string> = {
  subscription: "Платёж клиента",
  hardware: "Оборудование",
  bonus: "Бонус",
  subscription_reversal: "Сторно: платёж клиента",
  hardware_reversal: "Сторно: оборудование",
  bonus_reversal: "Сторно: бонус",
};

export const ACCRUAL_STATUS_LABELS: Record<AccrualStatus, string> = {
  accrued: "Начислено",
  payable: "К выплате",
  paid: "Выплачено",
};

/** Снимок правил: то, что лежит в строке `PartnerRewardRule`. */
export type RewardRule = {
  version: number;
  /** Доля от платежа за подписку, %. */
  subscriptionPercent: number;
  /** Сколько месяцев с первого платежа клиента действует доля. */
  subscriptionMonths: number;
  /** Доля от стоимости оборудования, %. */
  hardwarePercent: number;
  /** Разовый бонус, ₽. */
  bonusAmountRub: number;
  /** После какого по счёту успешного платежа за подписку выдаётся бонус. */
  bonusAfterPayments: number;
  /** Минимальная сумма к выплате, ₽; меньше — переносится. */
  minPayoutRub: number;
};

/** Значения по умолчанию из ТЗ — версия 1, создаётся при первом обращении. */
export const DEFAULT_REWARD_RULE: RewardRule = {
  version: 1,
  subscriptionPercent: 20,
  subscriptionMonths: 12,
  hardwarePercent: 15,
  bonusAmountRub: 3000,
  bonusAfterPayments: 2,
  minPayoutRub: 1000,
};

export type AccrualDraft = {
  kind: AccrualKind;
  /** База расчёта (сумма платежа клиента по этому основанию), ₽. */
  baseAmountRub: number;
  /** Ставка, %; для бонуса — null. */
  ratePercent: number | null;
  /** Начислено партнёру, ₽ (для сторно — отрицательное). */
  amountRub: number;
};

/** Факты об оплаченном заказе, нужные для расчёта. */
export type PaymentFacts = {
  paidAt: Date;
  /** Часть платежа за подписку, ₽ (для комплекта — без оборудования). */
  subscriptionRub: number;
  /**
   * Первый успешный платёж клиента за подписку (до текущего). null —
   * текущий платёж и есть первый.
   */
  firstPaymentAt: Date | null;
  /** Сколько успешных платежей за подписку было ДО текущего. */
  paidSubscriptionPaymentsBefore: number;
  /**
   * Может ли этот платёж дать бонус «за N-й платёж». false — пополнение
   * баланса: иначе бонус 3 000 ₽ выбивался бы пополнением на 500 ₽.
   * Не задано — может (прежнее поведение).
   */
  bonusEligible?: boolean;
};

/** Округление до копеек без накопления ошибок плавающей точки. */
export function roundRub(value: number): number {
  return Math.round(value * 100 + Number.EPSILON * Math.sign(value)) / 100;
}

export function percentOf(amountRub: number, percent: number): number {
  const kopecks = Math.round(amountRub * 100);
  return roundRub((kopecks * percent) / 100 / 100);
}

/**
 * Окно «первые N месяцев с первого платежа»: платёж входит, если он не
 * позже даты первого платежа + N календарных месяцев.
 */
export function isWithinSubscriptionWindow(
  rule: Pick<RewardRule, "subscriptionMonths">,
  firstPaymentAt: Date | null,
  paidAt: Date,
): boolean {
  if (!firstPaymentAt) return true;
  const windowEnd = new Date(firstPaymentAt);
  windowEnd.setUTCMonth(windowEnd.getUTCMonth() + rule.subscriptionMonths);
  return paidAt.getTime() <= windowEnd.getTime();
}

export function computeSubscriptionAccrual(
  rule: RewardRule,
  facts: PaymentFacts,
): AccrualDraft | null {
  if (facts.subscriptionRub <= 0) return null;
  if (!isWithinSubscriptionWindow(rule, facts.firstPaymentAt, facts.paidAt)) {
    return null;
  }
  return {
    kind: "subscription",
    baseAmountRub: roundRub(facts.subscriptionRub),
    ratePercent: rule.subscriptionPercent,
    amountRub: percentOf(facts.subscriptionRub, rule.subscriptionPercent),
  };
}

export function computeBonusAccrual(
  rule: RewardRule,
  facts: PaymentFacts,
): AccrualDraft | null {
  if (facts.subscriptionRub <= 0) return null;
  if (facts.bonusEligible === false) return null;
  if (rule.bonusAmountRub <= 0) return null;
  const ordinal = facts.paidSubscriptionPaymentsBefore + 1;
  if (ordinal !== rule.bonusAfterPayments) return null;
  return {
    kind: "bonus",
    baseAmountRub: roundRub(facts.subscriptionRub),
    ratePercent: null,
    amountRub: roundRub(rule.bonusAmountRub),
  };
}

export function computeHardwareAccrual(
  rule: RewardRule,
  hardwareRub: number,
): AccrualDraft | null {
  if (hardwareRub <= 0) return null;
  return {
    kind: "hardware",
    baseAmountRub: roundRub(hardwareRub),
    ratePercent: rule.hardwarePercent,
    amountRub: percentOf(hardwareRub, rule.hardwarePercent),
  };
}

/** Все начисления за оплаченный заказ (подписка + бонус). Оборудование — отдельно, после отгрузки. */
export function computePaymentAccruals(
  rule: RewardRule,
  facts: PaymentFacts,
): AccrualDraft[] {
  const drafts: AccrualDraft[] = [];
  const subscription = computeSubscriptionAccrual(rule, facts);
  if (subscription) drafts.push(subscription);
  const bonus = computeBonusAccrual(rule, facts);
  if (bonus) drafts.push(bonus);
  return drafts;
}

export function reversalKindOf(kind: AccrualKind): AccrualKind | null {
  switch (kind) {
    case "subscription":
      return "subscription_reversal";
    case "hardware":
      return "hardware_reversal";
    case "bonus":
      return "bonus_reversal";
    default:
      return null;
  }
}

export function isReversalKind(kind: AccrualKind): boolean {
  return kind.endsWith("_reversal");
}

/**
 * Сторно: на каждое положительное начисление заказа — зеркальная строка
 * с отрицательной суммой. Уже сторнированные пропускаем.
 */
export function computeReversals(
  existing: Array<{ kind: AccrualKind; baseAmountRub: number; ratePercent: number | null; amountRub: number }>,
): AccrualDraft[] {
  const reversed = new Set(
    existing.filter((row) => isReversalKind(row.kind)).map((row) => row.kind),
  );
  const drafts: AccrualDraft[] = [];
  for (const row of existing) {
    const kind = reversalKindOf(row.kind);
    if (!kind || reversed.has(kind)) continue;
    drafts.push({
      kind,
      baseAmountRub: row.baseAmountRub,
      ratePercent: row.ratePercent,
      amountRub: roundRub(-row.amountRub),
    });
  }
  return drafts;
}

/** Ключ месяца «YYYY-MM» в часовом поясе Москвы — по нему закрывается ведомость. */
export function periodMonthOf(date: Date, timeZone = "Europe/Moscow"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value ?? "1970";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${year}-${month}`;
}

/** Предыдущий месяц относительно даты (для закрытия 1-го числа). */
export function previousPeriodMonth(date: Date, timeZone = "Europe/Moscow"): string {
  const [year, month] = periodMonthOf(date, timeZone).split("-").map(Number);
  const prev = new Date(Date.UTC(year, month - 2, 1));
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type PayoutLine = {
  partnerId: string;
  payableRub: number;
};

/**
 * Ведомость: партнёры, у которых сумма «к выплате» достигла минимума.
 * Остальные переносятся на следующий месяц (строка помечена carryOver).
 */
export function buildPayoutSheet(
  lines: PayoutLine[],
  minPayoutRub: number,
): Array<PayoutLine & { carryOver: boolean }> {
  return lines
    .map((line) => ({
      ...line,
      payableRub: roundRub(line.payableRub),
      carryOver: roundRub(line.payableRub) < minPayoutRub,
    }))
    .sort((a, b) => b.payableRub - a.payableRub);
}

export function formatRubFixed(value: number): string {
  return `${roundRub(value).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ₽`;
}
