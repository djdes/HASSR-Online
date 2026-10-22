import { createTranslator } from "use-intl/core";
import type { Locale } from "./locales";
import { loadMessages } from "./messages";

/** Capture one explicit render locale; no request-global mutable language. */
export async function journalDocxCopy(locale: Locale = "ru") {
  const messages = await loadMessages(locale);
  return {
    t: createTranslator({ locale, messages: messages.docxSample }),
    status: createTranslator({ locale, messages: messages.journalControls.walkthroughs.previews }),
  };
}
