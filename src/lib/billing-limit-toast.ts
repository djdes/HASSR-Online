import { toast } from "sonner";

import { BILLING_LIMIT_CODE, BILLING_PAY_HREF } from "@/lib/billing-period";
import { isInsideMobileApp } from "@/lib/mobile-app";
import { FREE_MAX_USERS } from "@/lib/plan-limits";
import { employeesLabel } from "@/lib/plan-catalog";

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

export function toastApiError(data: unknown, fallback: string): void {
  const d = (data && typeof data === "object" ? data : null) as {
    error?: unknown;
    payUrl?: unknown;
  } | null;
  const message = typeof d?.error === "string" && d.error.trim() ? d.error : fallback;
  if (!isBillingLimitError(data)) {
    toast.error(message);
    return;
  }
  if (isInsideMobileApp()) {
    toast.error(`Бесплатный тариф — ${employeesLabel(FREE_MAX_USERS)}.`, { id: "billing-limit" });
    return;
  }
  const href =
    typeof d?.payUrl === "string" && d.payUrl.startsWith("/") ? d.payUrl : BILLING_PAY_HREF;
  toast.error(message, {
    id: "billing-limit",
    duration: 12000,
    action: { label: "Оплатить", onClick: () => window.location.assign(href) },
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
export function toastCaughtError(error: unknown, fallback: string): void {
  if (error instanceof ApiError) {
    toastApiError(error.data ?? { error: error.message }, fallback);
    return;
  }
  toast.error(error instanceof Error && error.message ? error.message : fallback);
}
