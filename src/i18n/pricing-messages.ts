import { createTranslator } from "use-intl/core";
import type { Locale } from "./locales";
import type { PricingMessageContract } from "./pricing-message-contract";
import ruMessages from "./messages/pricing/ru.json";
import enMessages from "./messages/pricing/en.json";
import uzMessages from "./messages/pricing/uz.json";
import tgMessages from "./messages/pricing/tg.json";
import hyMessages from "./messages/pricing/hy.json";
import kyMessages from "./messages/pricing/ky.json";
import deMessages from "./messages/pricing/de.json";
import frMessages from "./messages/pricing/fr.json";

const catalogs: Record<Locale, PricingMessageContract> = {
  ru: ruMessages as PricingMessageContract,
  en: enMessages as PricingMessageContract,
  uz: uzMessages as PricingMessageContract,
  tg: tgMessages as PricingMessageContract,
  hy: hyMessages as PricingMessageContract,
  ky: kyMessages as PricingMessageContract,
  de: deMessages as PricingMessageContract,
  fr: frMessages as PricingMessageContract,
};

/** Standalone translations for reusable price UI and server-side price labels. */
export function pricingTranslator(locale: Locale) {
  return createTranslator({ locale, messages: catalogs[locale] });
}
