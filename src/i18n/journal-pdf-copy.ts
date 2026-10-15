import { createTranslator } from "use-intl/core";
import type { Locale } from "./locales";
import type { MessageContract } from "./message-contract";
import ru from "./messages/ru.json";
import en from "./messages/en.json";
import uz from "./messages/uz.json";

/** Synchronous document renderers receive a request-specific locale explicitly. */
export function journalPdfCopy(locale: Locale = "ru") {
  return createTranslator({ locale, messages: { ru, en, uz }[locale].journalPdf as MessageContract["journalPdf"] });
}
