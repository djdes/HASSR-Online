import { createTranslator } from "use-intl/core";
import { loadMessages } from "./messages";
import type { Locale } from "./locales";
import type { MessageContract } from "./message-contract";

/** Explicit locale for email, bot, exports and jobs without a Next.js request. */
export async function translatorFor(locale: Locale) {
  // Catalog validation verifies identical parameter contracts in every language.
  return createTranslator({ locale, messages: await loadMessages(locale) as MessageContract });
}
