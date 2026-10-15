import { toast } from "sonner";
import { useTranslations } from "next-intl";

import { BILLING_LIMIT_CODE, BILLING_PAY_HREF } from "@/lib/billing-period";
import { isInsideMobileApp } from "@/lib/mobile-app";
import { FREE_MAX_USERS } from "@/lib/plan-limits";

/**
 * Ошибка API в toast. Лимит бесплатного тарифа (402 +
 * `code: "billing_free_limit"`) — с кнопкой «Оплатить», чтобы из отказа
 * был понятный следующий шаг. В приложении WeSetup к оплате не зовём
 * (правила сторов): там только факт — «Бесплатный тариф — 1 сотрудник».
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
    const presentation = billingErrorPresentation(data, fallback, {
      limit: t("limit", { count: FREE_MAX_USERS }),
      limitAction: t("limitAction", { count: FREE_MAX_USERS }), pay: t("pay"),
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
