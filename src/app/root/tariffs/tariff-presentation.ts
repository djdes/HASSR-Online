import type { useTranslations } from "next-intl";
import { FREE_MAX_JOURNALS } from "@/lib/tariff-plans";
import { FREE_MAX_USERS } from "@/lib/plan-limits";
import type { TrialSettingsJson } from "./trial-settings-card";

type TariffCopy = ReturnType<typeof useTranslations<"rootTariffs">>;

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

/** «26.10.2026, 00:00» по Москве — без Intl-часовых поясов (сервер = браузер). */
function mskStamp(iso: string): string {
  const d = new Date(new Date(iso).getTime() + MSK_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Строка под заголовком карточки: до запуска, после запуска, переход выключен. */
export function trialPhaseLabel(t: TariffCopy, settings: TrialSettingsJson, now = Date.now()): string {
  const launched = new Date(settings.launchedAt).getTime();
  if (now < launched) return t("phaseBeforeLaunch", { date: mskStamp(settings.launchedAt) });
  return settings.transitionEnabled
    ? t("phaseActive", { trialDays: settings.trialDays })
    : t("phaseTransitionOff", { trialDays: settings.trialDays });
}

export function trialExplanation(t: TariffCopy, settings: TrialSettingsJson): string {
  return t("trialExplanation", {
    trialDays: settings.trialDays,
    freeEmployees: FREE_MAX_USERS,
    freeJournals: FREE_MAX_JOURNALS,
  });
}
