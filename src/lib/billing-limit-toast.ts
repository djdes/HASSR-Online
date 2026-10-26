import { toast } from "sonner";
import { useTranslations } from "next-intl";

import {
  BILLING_LIMIT_CODE,
  BILLING_PAY_HREF,
  FEATURE_LOCKED_CODE,
  JOURNAL_LIMIT_CODE,
  POINT_LIMIT_CODE,
  STORAGE_LIMIT_CODE,
} from "@/lib/billing-period";
import { isInsideMobileApp } from "@/lib/mobile-app";
import { FREE_MAX_USERS } from "@/lib/plan-limits";
import { contactSupport } from "@/lib/support-chat-bus";
import { SEATS_PER_POINT } from "@/lib/tariff-plans";

/**
 * Ошибка API в toast. Места тарифа заняты (402 +
 * `code: "billing_free_limit"`) — текст с лимитом и следующим тарифом
 * и кнопка с его названием («Подключить «Стандарт»», «Перейти на
 * «Премиум»»); у «Премиума» — «больше по согласованию» и «Связаться» (чат
 * поддержки). Никаких «добавьте точку»: точка — новое место работы, а не
 * способ докупить сотрудников. В приложении WeSetup к оплате не зовём
 * (правила сторов): там только факт — «Все места тарифа заняты».
 * Число мест — из ответа сервера (`limit`), куда звать — `nextTier`.
 */
export function isBillingLimitError(data: unknown): boolean {
  return Boolean(
    data && typeof data === "object" && (data as { code?: unknown }).code === BILLING_LIMIT_CODE
  );
}

/**
 * Куда звать из отказа по местам: поле `nextTier` ответа 402 — следующий
 * тариф, `null` — «Премиум», больше по согласованию; нет поля (старый
 * ответ) — общий текст «перейдите на тариф выше».
 */
export type SeatOffer = "standard" | "premium" | "contact" | "generic";

export function seatOfferFrom(data: unknown): SeatOffer {
  const d = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  if (!d || !("nextTier" in d)) return "generic";
  if (d.nextTier === "standard" || d.nextTier === "premium") return d.nextTier;
  return d.nextTier === null ? "contact" : "generic";
}

/** Тексты отказа по местам со следующим тарифом; нет — общий `limitAction`. */
type SeatOfferCopy = {
  toStandard?: string;
  toPremium?: string;
  /** Кнопки со следующим тарифом; нет — общая `pay`. */
  payStandard?: string;
  payPremium?: string;
  contact?: string;
  contactLabel?: string;
};

type BillingErrorCopy = { limit: string; limitAction: string; pay: string } & SeatOfferCopy;

export type BillingErrorPresentation = {
  message: string;
  id?: string;
  href?: string;
  actionLabel?: string;
  /** Кнопка «Связаться» — чат поддержки вместо страницы тарифа. */
  contact?: true;
};

export function billingErrorPresentation(
  data: unknown,
  fallback: string,
  copy: BillingErrorCopy,
  inApp: boolean
): BillingErrorPresentation {
  const d = (data && typeof data === "object" ? data : null) as {
    error?: unknown;
    payUrl?: unknown;
  } | null;
  if (!isBillingLimitError(data)) {
    return { message: fallback };
  }
  if (inApp) {
    return { message: copy.limit, id: "billing-limit" };
  }
  const offer = seatOfferFrom(data);
  if (offer === "contact" && copy.contact && copy.contactLabel) {
    return { message: copy.contact, id: "billing-limit", actionLabel: copy.contactLabel, contact: true };
  }
  const href = safePayHref(d?.payUrl);
  if (offer === "standard" && copy.toStandard) {
    return { message: copy.toStandard, id: "billing-limit", href, actionLabel: copy.payStandard ?? copy.pay };
  }
  if (offer === "premium" && copy.toPremium) {
    return { message: copy.toPremium, id: "billing-limit", href, actionLabel: copy.payPremium ?? copy.pay };
  }
  return { message: copy.limitAction, id: "billing-limit", href, actionLabel: copy.pay };
}

/** Сколько мест у тарифа — из ответа 402; нет — бесплатный тариф. */
export function seatLimitFrom(data: unknown): number {
  const limit = data && typeof data === "object" ? (data as { limit?: unknown }).limit : null;
  return typeof limit === "number" && Number.isInteger(limit) && limit > 0 ? limit : FREE_MAX_USERS;
}

/** Ссылка на тариф из ответа — только свой путь, иначе страница тарифа. */
function safePayHref(payUrl: unknown): string {
  return typeof payUrl === "string" && payUrl.startsWith("/") && !payUrl.startsWith("//") && !payUrl.includes("\\")
    ? payUrl
    : BILLING_PAY_HREF;
}

/** Тексты отказов по лимитам тарифа (тарифы 2026-10), уже в языке интерфейса. */
export type TariffLimitCopy = {
  /** Общий текст, когда сервер не сказал, куда звать. */
  seats: (count: number) => string;
  /** Со следующим тарифом и «по согласованию» у «Премиума». */
  seatsToStandard?: (count: number) => string;
  seatsToPremium?: (count: number) => string;
  seatsContact?: (count: number) => string;
  /** Кнопки со следующим тарифом; нет — общая `pay`. */
  payStandard?: string;
  payPremium?: string;
  contact?: string;
  points: (count: number) => string;
  journals: (count: number) => string;
  storageFull: string;
  storageClosed: string;
  feature: string;
  /** Приложение WeSetup: без призыва к оплате (правила сторов). */
  seatsInApp: (count: number) => string;
  unavailableInApp: string;
  pay: string;
};

const TARIFF_LIMIT_CODES: ReadonlySet<string> = new Set([
  BILLING_LIMIT_CODE,
  POINT_LIMIT_CODE,
  JOURNAL_LIMIT_CODE,
  STORAGE_LIMIT_CODE,
  FEATURE_LOCKED_CODE,
]);

/**
 * Отказ 402 по лимиту тарифа (места, точки, журналы, хранилище, возможность
 * «Премиума») → текст в языке интерфейса и кнопка на страницу тарифа (у мест —
 * с названием следующего тарифа). Текст ответа сервера не показываем: он на
 * русском. null — это не отказ тарифа.
 */
export function tariffLimitPresentation(
  data: unknown,
  copy: TariffLimitCopy,
  inApp: boolean
): { message: string; href?: string; actionLabel?: string; contact?: true } | null {
  const d = data && typeof data === "object" ? (data as { code?: unknown; limit?: unknown; payUrl?: unknown }) : null;
  const code = typeof d?.code === "string" ? d.code : null;
  if (!code || !TARIFF_LIMIT_CODES.has(code)) return null;
  const limit = typeof d?.limit === "number" && Number.isInteger(d.limit) && d.limit >= 0 ? d.limit : null;
  if (inApp) {
    return { message: code === BILLING_LIMIT_CODE ? copy.seatsInApp(limit || FREE_MAX_USERS) : copy.unavailableInApp };
  }
  if (code === BILLING_LIMIT_CODE) {
    const count = limit || FREE_MAX_USERS;
    const offer = seatOfferFrom(data);
    if (offer === "contact" && copy.seatsContact && copy.contact) {
      return { message: copy.seatsContact(count), actionLabel: copy.contact, contact: true };
    }
    const href = safePayHref(d?.payUrl);
    if (offer === "standard" && copy.seatsToStandard) {
      return { message: copy.seatsToStandard(count), href, actionLabel: copy.payStandard ?? copy.pay };
    }
    if (offer === "premium" && copy.seatsToPremium) {
      return { message: copy.seatsToPremium(count), href, actionLabel: copy.payPremium ?? copy.pay };
    }
    return { message: copy.seats(count), href, actionLabel: copy.pay };
  }
  const message =
    code === POINT_LIMIT_CODE
        ? copy.points(limit || 1)
        : code === JOURNAL_LIMIT_CODE
          ? copy.journals(limit || 1)
          : code === STORAGE_LIMIT_CODE
            ? limit === 0
              ? copy.storageClosed
              : copy.storageFull
            : copy.feature;
  return { message, href: safePayHref(d?.payUrl), actionLabel: copy.pay };
}

/**
 * Для `if (!res.ok)`: отказ тарифа — toast с кнопкой на страницу тарифа и
 * `true` (вызывающий дальше ничего не показывает), иначе `false`.
 */
export function useTariffLimitToast(): (data: unknown) => boolean {
  const t = useTranslations("common.billing");
  return (data: unknown) => {
    const presentation = tariffLimitPresentation(
      data,
      {
        seats: (count) => t("limitAction", { count }),
        seatsToStandard: (count) => t("limitToStandard", { count, seats: SEATS_PER_POINT.standard }),
        seatsToPremium: (count) => t("limitToPremium", { count, seats: SEATS_PER_POINT.premium }),
        seatsContact: (count) => t("limitContact", { count, seats: SEATS_PER_POINT.premium }),
        payStandard: t("payStandard"),
        payPremium: t("payPremium"),
        contact: t("contact"),
        points: (count) => t("pointLimit", { count }),
        journals: (count) => t("journalLimit", { count }),
        storageFull: t("storageFull"),
        storageClosed: t("storageClosed"),
        feature: t("featureLocked"),
        seatsInApp: (count) => t("limit", { count }),
        unavailableInApp: t("unavailable"),
        pay: t("pay"),
      },
      isInsideMobileApp()
    );
    if (!presentation) return false;
    showBillingToast(presentation, "billing-limit", t("contactSubject"));
    return true;
  };
}

/** Toast отказа: кнопка — страница тарифа или «Связаться» (чат поддержки). */
function showBillingToast(
  presentation: { message: string; href?: string; actionLabel?: string; contact?: true },
  id: string | undefined,
  contactSubject: string
): void {
  const { message, href, actionLabel, contact } = presentation;
  const onClick = contact ? () => contactSupport(contactSubject) : href ? () => window.location.assign(href) : null;
  toast.error(message, {
    ...(id ? { id } : {}),
    ...(onClick && actionLabel ? { duration: 12000, action: { label: actionLabel, onClick } } : {}),
  });
}

/** Ошибка `fetch` с телом ответа — чтобы вызывающий мог прочитать `code`. */
export class ApiError extends Error {
  data: unknown;
  constructor(message: string, data: unknown) {
    super(message);
    this.name = "ApiError";
    this.data = data;
  }
}

/** Для `catch (error)`: ApiError → toast с кодом, остальное — текстом. */
export function useBillingError() {
  const t = useTranslations("common.billing");
  function toastApiError(data: unknown, fallback: string): void {
    const limit = seatLimitFrom(data);
    const presentation = billingErrorPresentation(data, fallback, {
      limit: t("limit", { count: limit }),
      limitAction: t("limitAction", { count: limit }),
      pay: t("pay"),
      toStandard: t("limitToStandard", { count: limit, seats: SEATS_PER_POINT.standard }),
      toPremium: t("limitToPremium", { count: limit, seats: SEATS_PER_POINT.premium }),
      payStandard: t("payStandard"),
      payPremium: t("payPremium"),
      contact: t("limitContact", { count: limit, seats: SEATS_PER_POINT.premium }),
      contactLabel: t("contact"),
    }, isInsideMobileApp());
    showBillingToast(presentation, presentation.id, t("contactSubject"));
  }
  function toastCaughtError(error: unknown, fallback: string): void {
    if (error instanceof ApiError) {
      // ApiError.message is already localized by the caller; legacy response text is not.
      toastApiError(error.data, error.message || fallback);
      return;
    }
    toast.error(error instanceof Error && error.message ? error.message : fallback);
  }
  return { toastApiError, toastCaughtError };
}
