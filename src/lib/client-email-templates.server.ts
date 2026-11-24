import { narratedVideoFor, presentationPdfFor } from "@/components/landing/qr-player/narrated-video";
import { COMPANY_PHONE, COMPANY_TELEGRAM } from "@/lib/company-contacts";
import { readServices } from "@/lib/services/catalog";
import { TRIAL_DAYS } from "@/lib/tariff-plans";
import { readPlanPricing } from "@/lib/tariffs";
import type { ClientEmailTemplateContext, ClientEmailTemplateTariff } from "@/lib/client-email-templates";

/** Ссылки в письмах — всегда на боевой сайт, даже из dev. */
const SITE = "https://wesetup.ru";
const TIERS: readonly ClientEmailTemplateTariff["tier"][] = ["standard", "premium", "vip"];

function botUrl(): string {
  const username = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "") || "wesetupbot";
  return `https://t.me/${username}`;
}

/**
 * Данные шаблонов «Писем клиенту»: видеопрезентация и PDF — те же файлы, что
 * на главной (расширенная версия, если лежит), цены тарифов и услуг — текущие.
 */
export async function clientEmailTemplateContext(company: string): Promise<ClientEmailTemplateContext> {
  const [pricing, services] = await Promise.all([
    readPlanPricing(),
    readServices().catch((error) => {
      console.error("[client-email-templates] services read failed", error);
      return [];
    }),
  ]);
  const video = narratedVideoFor("ru");
  const pdf = presentationPdfFor("ru", "food");
  const tariffs = TIERS.flatMap((tier) => {
    const month = pricing.available[tier].month ? pricing.rates[tier].month : null;
    const year = pricing.available[tier].year ? pricing.rates[tier].year : null;
    return month === null && year === null ? [] : [{ tier, month, year }];
  });
  return {
    company,
    links: {
      video: video ? `${SITE}${video.src}` : `${SITE}/#qr`,
      pdf: pdf ? `${SITE}${pdf}` : `${SITE}/#qr`,
      site: SITE,
      register: `${SITE}/register`,
      pricing: `${SITE}/pricing`,
      services: `${SITE}/uslugi`,
      login: `${SITE}/login`,
      knowledge: `${SITE}/baza-znaniy`,
      bot: botUrl(),
    },
    supportPhone: COMPANY_PHONE.display,
    supportTelegram: COMPANY_TELEGRAM.handle,
    trialDays: TRIAL_DAYS,
    tariffs,
    services: services
      .filter((service) => service.active)
      .map((service) => ({ title: service.title, priceRub: service.priceRub, priceFrom: service.priceFrom, unit: service.unit })),
  };
}
