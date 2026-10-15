import type { Locale } from "@/i18n/locales";
import type { MessageContract } from "@/i18n/message-contract";

declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: MessageContract;
  }
}
