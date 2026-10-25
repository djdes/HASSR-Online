import type { useTranslations } from "next-intl";
import { FORMAT_LOCALES, type Locale } from "@/i18n/locales";
import { normalizeUserRole } from "@/lib/user-roles";
import { normalizeSphere } from "@/lib/org-profile";

export type OrganizationCopy = ReturnType<typeof useTranslations<"rootOrganizationManagement">>;
type RoleCopy = ReturnType<typeof useTranslations<"staffManagement.roleLabels">>;
type ProfileCopy = ReturnType<typeof useTranslations<"settingsManagement.organizationProfile.form">>;
type LegacyPlanCopy = ReturnType<typeof useTranslations<"rootMetrics.plans">>;

export function organizationDate(value: string | Date, locale: Locale, dateOnly = false) {
  const date = new Date(value);
  return dateOnly ? date.toLocaleDateString(FORMAT_LOCALES[locale]) : date.toLocaleString(FORMAT_LOCALES[locale]);
}

export function organizationRole(role: string | null | undefined, t: RoleCopy) {
  const normalized = normalizeUserRole(role);
  return normalized === "manager" || normalized === "head_chef" || normalized === "cook" || normalized === "waiter" ? t(normalized) : normalized;
}

export function organizationSphere(type: string, t: ProfileCopy) {
  const normalized = normalizeSphere(type);
  // Unknown customer values must not become the generic default sector.
  return normalized === "other" && type !== "other" ? type : t(`spheres.${normalized}`);
}

export function organizationPlan(plan: string, t: OrganizationCopy, legacy: LegacyPlanCopy) {
  if (plan === "free" || plan === "standard" || plan === "premium" || plan === "paid" || plan === "paused" || plan === "cancelled") return t(`plans.${plan}`);
  return plan === "trial" || plan === "pro" ? legacy(plan) : plan;
}

export function organizationOrderStatus(order: { status: string; paymentMethod?: string | null; heldAt?: Date | null }, t: OrganizationCopy) {
  // Оплачен, но к тарифу не применён: подписка изменилась после оформления.
  if (order.status === "paid" && order.heldAt) return t("orders.held");
  if (order.status === "paid" || order.status === "completed") return t("orders.paid");
  if (order.status === "expired") return t("orders.expired");
  if (order.status === "cancelled") return t("orders.cancelled");
  if (order.status === "pending") return t(order.paymentMethod === "invoice" ? "orders.pendingInvoice" : "orders.pending");
  return order.status;
}

export function organizationKind(kind: string, t: OrganizationCopy) {
  const known = { referral_reward: "kinds.referral_reward", review_reward: "kinds.review_reward", order_spend: "kinds.order_spend", order_release: "kinds.order_release", service_spend: "kinds.service_spend", manual_adjust: "kinds.manual_adjust", topup: "kinds.topup" } as const;
  return Object.hasOwn(known, kind) ? t(known[kind as keyof typeof known]) : t("kinds.unknown");
}

const errors = {
  ORG_NOT_FOUND: "errors.organizationMissing", ORG_NAME_SHORT: "errors.nameShort", ORG_PLAN_UNKNOWN: "errors.planUnknown", ORG_DATE_INVALID: "errors.dateInvalid", ORG_POINTS_INVALID: "errors.pointsInvalid", ORG_NO_ACCOUNT: "errors.noAccount", ORG_PLATFORM_PROTECTED: "errors.platformProtected", ORG_BALANCE_INVALID: "errors.invalidRequest", ORG_BALANCE_READ_FAILED: "errors.readRequest", ROOT_ORDER_NOT_FOUND: "errors.orderMissing", ROOT_ORDER_CANCEL_UNPAID_ONLY: "errors.cancelUnpaidOnly", ROOT_ORDER_NOT_HELD: "errors.notHeld", ORG_FREE_WITH_END: "errors.freeWithEnd",
} as const;

/** Structured descriptors only; arbitrary backend prose is never reflected. */
export function organizationError(data: unknown, t: OrganizationCopy, fallback: "settings.failed" | "impersonate.failed" | "delete.failed" | "balance.failed" | "invoice.failed" | "held.failed") {
  if (!data || typeof data !== "object") return t(fallback);
  const body = data as { errorCode?: unknown; errorParams?: unknown };
  if (body.errorCode === "ORG_BALANCE_INSUFFICIENT" && body.errorParams && typeof body.errorParams === "object") {
    const amount = (body.errorParams as { amount?: unknown }).amount;
    if (typeof amount === "number" && Number.isFinite(amount)) return t("errors.insufficientBalance", { amount });
  }
  return typeof body.errorCode === "string" && Object.hasOwn(errors, body.errorCode) ? t(errors[body.errorCode as keyof typeof errors]) : t(fallback);
}
