/**
 * Константы системы баллов. Client-safe: файл импортируют и серверные
 * модули, и виджеты кабинета, поэтому здесь нет ни prisma, ни node-api.
 *
 * 1 балл = 1 ₽. Баллами оплачивается только подписка — оборудование
 * физический товар с себестоимостью, и его цена из списания исключена.
 */

/** Доля подписочной части первого оплаченного заказа приглашённого. */
export const REFERRAL_REWARD_PERCENT = 30;

/** Тарифы отзывов по виду вложения. */
export const REVIEW_REWARD_RUB = {
  text: 300,
  photo: 750,
  video: 1990,
} as const;

export type ReviewKind = keyof typeof REVIEW_REWARD_RUB;

export const REVIEW_KINDS: ReviewKind[] = ["text", "photo", "video"];

/**
 * Анонимный отзыв (без имени и заведения на сайте) стоит на 20 % меньше:
 * 300 → 240, 750 → 600, 1990 → 1592. Округление вниз до рубля.
 */
export const ANONYMOUS_REVIEW_FACTOR = 0.8;

/**
 * Пополнение баланса деньгами: 1 ₽ = 1 балл, целыми рублями. Баллами
 * по-прежнему оплачивается только подписка.
 */
export const TOPUP_MIN_RUB = 500;
export const TOPUP_MAX_RUB = 300_000;
/** Быстрые суммы в блоке «Пополнить баланс»: месяц подписки и круглые. */
export const TOPUP_PRESETS_RUB = [1990, 5000, 10000] as const;

/** Сколько живёт холд баллов на неоплаченном заказе. */
export const POINTS_HOLD_HOURS = 24;

/** Cookie реферальной метки клиент → клиент (не путать с партнёрской). */
export const REFERRAL_COOKIE = "wesetup.ref";
export const REFERRAL_COOKIE_MAX_AGE_SEC = 30 * 24 * 60 * 60;

/** Организация «новая» для атрибуции, если моложе этого возраста. */
export const REFERRAL_MAX_ORG_AGE_DAYS = 30;

/** Длина реферального кода. Алфавит без 0/O/1/I — код диктуют голосом. */
export const REFERRAL_CODE_LENGTH = 8;
export const REFERRAL_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Максимум приглашений на организацию в сутки — заслон от открытого релея. */
export const REFERRAL_INVITES_PER_DAY = 20;
/** Повтор приглашения на тот же адрес не раньше, чем через столько часов. */
export const REFERRAL_INVITE_REPEAT_HOURS = 24;

export const REVIEW_TEXT_MAX_LENGTH = 1000;
/** Отзыв короче — «пара предложений» не набирается. */
export const REVIEW_TEXT_MIN_LENGTH = 30;

/** Что принимаем вложением к отзыву. HEIC отклоняем — не отрисуется на лендинге. */
export const PHOTO_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;
export const VIDEO_MIMES = ["video/mp4", "video/quicktime"] as const;

/** Значение для input[accept] в форме отзыва. */
export const REVIEW_ACCEPT_ATTRIBUTE = [...PHOTO_MIMES, ...VIDEO_MIMES].join(",");

export type BalanceTransactionKind =
  | "referral_reward"
  | "review_reward"
  | "order_spend"
  | "order_release"
  | "service_spend"
  | "manual_adjust"
  | "topup";

/** Подписи видов транзакций для истории в кабинете и у ROOT. */
export const TRANSACTION_KIND_LABELS: Record<BalanceTransactionKind, string> = {
  referral_reward: "Приглашённый друг",
  review_reward: "Отзыв",
  order_spend: "Оплата заказа",
  order_release: "Возврат баллов",
  service_spend: "Оплата услуги",
  manual_adjust: "Корректировка",
  topup: "Пополнение",
};

export function transactionKindLabel(kind: string): string {
  return (
    TRANSACTION_KIND_LABELS[kind as BalanceTransactionKind] ?? "Операция"
  );
}

/** Сколько баллов спишется за заказ: не больше баланса и не больше цены тарифа. */
export function pointsToSpend(input: {
  balanceRub: number;
  subscriptionRub: number;
  usePoints: boolean;
}): number {
  if (!input.usePoints) return 0;
  const cap = Math.max(0, Math.floor(input.subscriptionRub));
  const available = Math.max(0, Math.floor(input.balanceRub));
  return Math.min(cap, available);
}

/** 30 % от базы, округляя до рубля. */
export function referralRewardFor(baseRub: number): number {
  if (!Number.isFinite(baseRub) || baseRub <= 0) return 0;
  return Math.round((baseRub * REFERRAL_REWARD_PERCENT) / 100);
}

/** Вид отзыва по MIME вложения. Неизвестный тип → null (отклоняем). */
export function reviewKindFromMime(mime: string | null | undefined): ReviewKind | null {
  if (!mime) return "text";
  const normalized = mime.split(";")[0].trim().toLowerCase();
  if ((PHOTO_MIMES as readonly string[]).includes(normalized)) return "photo";
  if ((VIDEO_MIMES as readonly string[]).includes(normalized)) return "video";
  return null;
}

/**
 * Сколько начислить за отзыв. Анонимный — × ANONYMOUS_REVIEW_FACTOR,
 * вниз до рубля. Считаем в сотых долях процента целыми числами: в
 * плавающей точке 1990 × 0,8 = 1592.0000000000002, а 0,1 × 3 — меньше
 * 0,3, и «вниз» съело бы рубль.
 *
 * Сумму всегда считает сервер по виду вложения и флагу из БД — от
 * клиента сумма не принимается.
 */
export function reviewRewardFor(kind: ReviewKind, anonymous = false): number {
  const base = REVIEW_REWARD_RUB[kind];
  return anonymous ? anonymousRewardRub(base) : base;
}

/** Сумма × ANONYMOUS_REVIEW_FACTOR, вниз до рубля (999 → 799). */
export function anonymousRewardRub(baseRub: number): number {
  if (!Number.isFinite(baseRub) || baseRub <= 0) return 0;
  const basisPoints = Math.round(ANONYMOUS_REVIEW_FACTOR * 10_000);
  return Math.floor((Math.floor(baseRub) * basisPoints) / 10_000);
}

export type TopupAmountCheck =
  | { ok: true; amountRub: number }
  | { ok: false; error: string };

/**
 * Сумма пополнения: целые рубли от TOPUP_MIN_RUB до TOPUP_MAX_RUB.
 * Принимает число или строку из поля ввода («5 000»); копейки, ноль,
 * отрицательные и всё нечисловое — отказ с понятной фразой. Одна
 * функция на подсказку в форме и на проверку сервера.
 */
export function parseTopupAmount(value: unknown): TopupAmountCheck {
  let amount: number;
  if (typeof value === "number") {
    amount = value;
  } else if (typeof value === "string") {
    const compact = value.replace(/[\s  ]/g, "").replace(",", ".").replace(/₽$/, "");
    if (!compact) return { ok: false, error: "Укажите сумму пополнения" };
    if (!/^-?\d+(\.\d+)?$/.test(compact)) {
      return { ok: false, error: "Сумма — числом, в рублях" };
    }
    amount = Number(compact);
  } else {
    return { ok: false, error: "Укажите сумму пополнения" };
  }
  if (!Number.isFinite(amount)) return { ok: false, error: "Сумма — числом, в рублях" };
  if (!Number.isInteger(amount)) {
    return { ok: false, error: "Сумма — целыми рублями, без копеек" };
  }
  if (amount < TOPUP_MIN_RUB) {
    return { ok: false, error: `Минимальная сумма — ${formatPoints(TOPUP_MIN_RUB)}` };
  }
  if (amount > TOPUP_MAX_RUB) {
    return { ok: false, error: `Максимальная сумма — ${formatPoints(TOPUP_MAX_RUB)}` };
  }
  return { ok: true, amountRub: amount };
}

export function isReviewKind(value: unknown): value is ReviewKind {
  return typeof value === "string" && (REVIEW_KINDS as string[]).includes(value);
}

/** «1 490 ₽» — единый формат для всех витрин баллов. */
export function formatPoints(value: number): string {
  return `${new Intl.NumberFormat("ru-RU").format(value)} ₽`;
}

/** Разбор cookie из заголовка запроса. Обобщение readPartnerRefFromRequest. */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      const raw = rest.join("=");
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return null;
}
