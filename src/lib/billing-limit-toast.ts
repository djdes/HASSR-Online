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

/**
 * Ошибка API в toast. Места тарифа заняты (402 +
 * `code: "billing_free_limit"`) — с кнопкой «Выбрать тариф», чтобы из
 * отказа был понятный следующий шаг. В приложении WeSetup к оплате не
 * зовём (правила сторов): там только факт — «Все места тарифа заняты».
 * Число мест — из ответа сервера (`limit`): у «Стандарта» это 25 на точку.
 */
export function isBillingLimitError(data: unknown): boolean {
  return Boolean(
    data && typeof data === "object" && (data as { code?: unknown }).code === BILLING_LIMIT_CODE
  );
}

type BillingErrorCopy = { limit: string; limitAction: string; pay: string };

export function billingErrorPresentation(data: unknown, fallback: string, copy: BillingErrorCopy, inApp: boolean) {
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
  const href =
    typeof d?.payUrl === "string" && d.payUrl.startsWith("/") && !d.payUrl.startsWith("//") && !d.payUrl.includes("\\") ? d.payUrl : BILLING_PAY_HREF;
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
  seats: (count: number) => string;
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
 * «Премиума») → текст в языке интерфейса и кнопка «Выбрать тариф». Текст
 * ответа сервера не показываем: он на русском. null — это не отказ тарифа.
 */
export function tariffLimitPresentation(
  data: unknown,
  copy: TariffLimitCopy,
  inApp: boolean
): { message: string; href?: string; actionLabel?: string } | null {
  const d = data && typeof data === "object" ? (data as { code?: unknown; limit?: unknown; payUrl?: unknown }) : null;
  const code = typeof d?.code === "string" ? d.code : null;
  if (!code || !TARIFF_LIMIT_CODES.has(code)) return null;
  const limit = typeof d?.limit === "number" && Number.isInteger(d.limit) && d.limit >= 0 ? d.limit : null;
  if (inApp) {
    return { message: code === BILLING_LIMIT_CODE ? copy.seatsInApp(limit || FREE_MAX_USERS) : copy.unavailableInApp };
  }
  const message =
    code === BILLING_LIMIT_CODE
      ? copy.seats(limit || FREE_MAX_USERS)
      : code === POINT_LIMIT_CODE
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
 * Для `if (!res.ok)`: отказ тарифа — toast с кнопкой «Выбрать тариф» и
 * `true` (вызывающий дальше ничего не показывает), иначе `false`.
 */
export function useTariffLimitToast(): (data: unknown) => boolean {
  const t = useTranslations("common.billing");
  return (data: unknown) => {
    const presentation = tariffLimitPresentation(
      data,
      {
        seats: (count) => t("limitAction", { count }),
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
    const { message, href, actionLabel } = presentation;
    toast.error(message, {
      id: "billing-limit",
      ...(href ? { duration: 12000, action: { label: actionLabel!, onClick: () => window.location.assign(href) } } : {}),
    });
    return true;
  };
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
      limitAction: t("limitAction", { count: limit }), pay: t("pay"),
    }, isInsideMobileApp());
    const { message, id, href, actionLabel } = presentation;
    toast.error(message, {
      ...(id ? { id } : {}),
      ...(href ? { duration: 12000, action: { label: actionLabel!, onClick: () => window.location.assign(href) } } : {}),
    });
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
