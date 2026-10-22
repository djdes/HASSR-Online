import type { Locale } from "@/i18n/locales";
import baseManifest from "../../public/manifest.json";

export type PwaManifestCopy = {
  name: string;
  description: string;
  todayName: string;
  todayDescription: string;
  journalsName: string;
  journalsDescription: string;
};

export function pwaManifestHref(locale: Locale = "ru") {
  return locale === "ru" ? "/manifest.json" : `/manifest-${locale}.json`;
}

export function buildLocalizedPwaManifest(locale: Locale, copy: PwaManifestCopy) {
  const result = structuredClone(baseManifest);
  result.lang = locale;
  result.name = copy.name;
  result.description = copy.description;
  result.shortcuts = result.shortcuts.map(shortcut => {
    if (shortcut.url === "/mini/today?src=pwa") {
      return { ...shortcut, name: copy.todayName, short_name: copy.todayName, description: copy.todayDescription };
    }
    if (shortcut.url === "/mini?src=pwa") {
      return { ...shortcut, name: copy.journalsName, short_name: copy.journalsName, description: copy.journalsDescription };
    }
    return shortcut;
  });
  return result;
}
