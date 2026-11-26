import { createTranslator } from "use-intl/core";
import type { Locale } from "./locales";
import type { MessageContract } from "./message-contract";
import ru from "./messages/ru.json";
import en from "./messages/en.json";
import uz from "./messages/uz.json";
import { baseLocale } from "@/i18n/locales";

/** Synchronous document renderers receive a request-specific locale explicitly. */
export function journalPdfCopy(locale: Locale = "ru") {
  return createTranslator({ locale, messages: { ru, en, uz }[baseLocale(locale)].journalPdf as MessageContract["journalPdf"] });
}
