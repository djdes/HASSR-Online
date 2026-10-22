import type { useTranslations } from "next-intl";
import { FREE_MAX_USERS } from "@/lib/plan-limits";
import { SUBSCRIPTION_MAX_USERS } from "@/lib/plan-catalog";
import type { BillingPeriodSettingsJson } from "./billing-period-card";

type TariffCopy = ReturnType<typeof useTranslations<"rootTariffs">>;

export function billingPhaseLabel(t: TariffCopy, settings: BillingPeriodSettingsJson, now = Date.now()): string {
  const starts = new Date(settings.startsAt).getTime();
  const ends = new Date(settings.endsAt).getTime();
  if (now < starts) return t("phaseBefore");
  if (now < ends) return t("phaseDuring", { count: SUBSCRIPTION_MAX_USERS });
  return settings.transitionEnabled ? t("phaseAfterEnabled") : t("phaseAfterDisabled");
}

export function billingExplanation(t: TariffCopy): string {
  return t("explanation", { subscriptionCount: SUBSCRIPTION_MAX_USERS, freeCount: FREE_MAX_USERS });
}
