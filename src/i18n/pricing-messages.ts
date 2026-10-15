import { createTranslator } from "use-intl/core";
import type { Locale } from "./locales";
import type { PricingMessageContract } from "./pricing-message-contract";
import ruMessages from "./messages/pricing/ru.json";
import enMessages from "./messages/pricing/en.json";
import uzMessages from "./messages/pricing/uz.json";

const catalogs: Record<Locale, PricingMessageContract> = {
  ru: ruMessages as PricingMessageContract,
  en: enMessages as PricingMessageContract,
  uz: uzMessages as PricingMessageContract,
};

/** Standalone translations for reusable price UI and server-side price labels. */
export function pricingTranslator(locale: Locale) {
  return createTranslator({ locale, messages: catalogs[locale] });
}
