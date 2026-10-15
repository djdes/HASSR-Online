import { createTranslator } from "use-intl/core";
import { isLocale, type Locale } from "./locales";
import { SITE_LOCALE_COOKIE } from "./site-locale";
import ru from "./messages/errors/ru.json";
import en from "./messages/errors/en.json";
import uz from "./messages/errors/uz.json";
import type { MessageContract } from "./message-contract";

/** Root-layout failures cannot rely on session loading or the normal provider. */
export function emergencyLocale(path: string, cookie: string, documentLanguage: string): Locale {
  const prefix = /^\/(en|uz)(?:\/|$)/.exec(path)?.[1];
  if (isLocale(prefix)) return prefix;
  const saved = cookie.split(";").map(part => part.trim()).find(part => part.startsWith(`${SITE_LOCALE_COOKIE}=`))?.slice(SITE_LOCALE_COOKIE.length + 1);
  if (isLocale(saved)) return saved;
  return isLocale(documentLanguage) ? documentLanguage : "ru";
}

export function emergencyTranslator(locale: Locale) {
  return createTranslator({ locale, messages: { ru, en, uz }[locale] as Pick<MessageContract, "errorSurface">, namespace: "errorSurface" });
}
