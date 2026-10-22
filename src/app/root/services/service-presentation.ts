import type { useTranslations } from "next-intl";
import type { PlatformServiceItem } from "@/lib/services/constants";

export type ServiceCopy = ReturnType<typeof useTranslations<"rootServices">>;
const CATEGORY_KEYS = {
  setup: "categorySetup", consult: "categoryConsult", audit: "categoryAudit", docs: "categoryDocs",
} as const;
const ERROR_KEYS = {
  "Услуга не найдена": "notFound",
  "Нечего менять": "noChanges",
  "Некорректный запрос": "invalidRequest",
} as const;

export function serviceCategoryLabel(category: string, t: ServiceCopy): string {
  return Object.hasOwn(CATEGORY_KEYS, category)
    ? t(CATEGORY_KEYS[category as keyof typeof CATEGORY_KEYS]) : category;
}

/** Editable units have no built-in provenance and remain literal. */
export function servicePriceLabel(
  service: Pick<PlatformServiceItem, "priceRub" | "priceFrom" | "unit">,
  t: ServiceCopy,
): string {
  if (service.priceRub === null) return t("priceOnRequest");
  return t("priceAmount", {
    amount: service.priceRub.toLocaleString("ru-RU"),
    from: service.priceFrom ? "yes" : "no",
    hasUnit: service.unit ? "yes" : "no",
    unit: service.unit ?? "",
  });
}

export function serviceSaveError(error: unknown, t: ServiceCopy): string {
  return typeof error === "string" && Object.hasOwn(ERROR_KEYS, error)
    ? t(ERROR_KEYS[error as keyof typeof ERROR_KEYS]) : t("saveFailed");
}
