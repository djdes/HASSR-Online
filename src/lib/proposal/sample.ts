/**
 * Образец данных КП для тестов и скриптов проверки (без базы): тариф
 * 1 990 ₽ (как дефолт `PlatformTariff`), бесплатный период по умолчанию
 * (`DEFAULT_FREE_PERIOD`), условные реквизиты («ООО «Пример»») и условный
 * отправитель. В приложении не используется — реальные реквизиты и
 * отправитель берутся из ROOT (`/root/requisites`, `/root/proposals`).
 */
import { DEFAULT_FREE_PERIOD } from "@/lib/billing-period";
import { EMPTY_REQUISITES } from "@/lib/closing-documents/types";
import type { ProposalContext } from "@/lib/proposal/content";
import type { ProposalPromo } from "@/lib/proposal/types";

export const SAMPLE_NOW = new Date("2026-09-29T12:00:00+03:00");

export const SAMPLE_PROMO_LIFETIME: ProposalPromo = {
  code: "ROMASHKA10",
  kind: "percent",
  value: 10,
  lifetime: true,
  endsAt: null,
};

export const SAMPLE_PROMO_UNTIL: ProposalPromo = {
  code: "OKTYABR10",
  kind: "percent",
  value: 10,
  lifetime: false,
  // 1 ноября 00:00 МСК — «до 31 октября».
  endsAt: new Date("2026-10-31T21:00:00.000Z"),
};

export const SAMPLE_PROMO_FIXED: ProposalPromo = {
  code: "MINUS500",
  kind: "fixed",
  value: 500,
  lifetime: false,
  endsAt: null,
};

export function sampleProposalContext(overrides: Partial<ProposalContext> = {}): ProposalContext {
  return {
    now: SAMPLE_NOW,
    tariffPriceRub: 1990,
    tariffActive: true,
    promotion: null,
    freePeriod: DEFAULT_FREE_PERIOD,
    requisites: {
      ...EMPTY_REQUISITES,
      nameFull: "Общество с ограниченной ответственностью «Пример»",
      nameShort: "ООО «Пример»",
      inn: "7700000000",
      kpp: "770001001",
      ogrn: "1027700000000",
      address: "123000, г. Москва, ул. Примерная, д. 1",
      bank: { name: "АО «Банк»", bik: "044525000", account: "40702810000000000000", corrAccount: "30101810000000000000" },
      head: { post: "Генеральный директор", name: "Иванов Иван Иванович" },
      email: "support@wesetup.ru",
      phone: "",
    },
    invoiceReady: true,
    defaultSender: {
      name: "Анна Петрова, менеджер WeSetup",
      phone: "+7 900 000-00-00",
      email: "support@wesetup.ru",
      telegram: "example_manager",
    },
    ...overrides,
  };
}
