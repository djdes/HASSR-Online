/**
 * Шаблоны «Писем клиенту» в карточке клиента (спека client-mail-templates-2026-11-24).
 *
 * Тексты — в словарях `rootOrganizationManagement.mail.templates.items.*`
 * (ru/en/uz), здесь только состав групп и данные для подстановки: ссылки на
 * сайт, видеопрезентацию и PDF, контакты поддержки, текущие цены тарифов и
 * услуг. Цены приходят с сервера (`readPlanPricing`, `readServices`) — в
 * текстах их нет, поэтому шаблоны не устаревают после правки прайса.
 */

export const CLIENT_EMAIL_TEMPLATE_GROUPS = [
  { id: "followup", items: ["presentation", "noAnswer", "afterDemo", "reminder"] },
  { id: "billing", items: ["tariffs", "invoice", "trialEnding", "paymentThanks"] },
  { id: "services", items: ["services", "setup", "documents", "inspection"] },
  { id: "support", items: ["issueReceived", "issueFixed", "needDetails", "login", "staff"] },
] as const;

export type ClientEmailTemplateGroupId = (typeof CLIENT_EMAIL_TEMPLATE_GROUPS)[number]["id"];
export type ClientEmailTemplateId = (typeof CLIENT_EMAIL_TEMPLATE_GROUPS)[number]["items"][number];

export const CLIENT_EMAIL_TEMPLATE_IDS: readonly ClientEmailTemplateId[] = CLIENT_EMAIL_TEMPLATE_GROUPS.flatMap((group) => group.items);

export function isClientEmailTemplateId(value: string): value is ClientEmailTemplateId {
  return (CLIENT_EMAIL_TEMPLATE_IDS as readonly string[]).includes(value);
}

export type ClientEmailTemplateTariff = { tier: "standard" | "premium" | "vip"; month: number | null; year: number | null };
export type ClientEmailTemplateService = { title: string; priceRub: number | null; priceFrom: boolean; unit: string | null };

/** Данные для шаблонов, собранные на сервере для одной карточки клиента. */
export type ClientEmailTemplateContext = {
  company: string;
  links: {
    video: string;
    pdf: string;
    site: string;
    register: string;
    pricing: string;
    services: string;
    login: string;
    knowledge: string;
    bot: string;
  };
  supportPhone: string;
  supportTelegram: string;
  trialDays: number;
  tariffs: ClientEmailTemplateTariff[];
  services: ClientEmailTemplateService[];
};

/** Переводчик `rootOrganizationManagement.mail.templates` (подходит и next-intl, и тестовая заглушка). */
export type TemplateTranslator = (key: string, values?: Record<string, string | number>) => string;

/** Строки «• Стандарт — 2 990 ₽ в месяц, при оплате за год — 1 990 ₽ в месяц». */
export function tariffListText(t: TemplateTranslator, tariffs: readonly ClientEmailTemplateTariff[], locale: string): string {
  const nf = new Intl.NumberFormat(locale);
  return tariffs
    .flatMap((line) => {
      const tier = t(`tiers.${line.tier}`);
      if (line.month !== null && line.year !== null) return [t("tariffLine", { tier, month: nf.format(line.month), year: nf.format(line.year) })];
      if (line.month !== null) return [t("tariffLineMonth", { tier, month: nf.format(line.month) })];
      if (line.year !== null) return [t("tariffLineYear", { tier, year: nf.format(line.year) })];
      return [];
    })
    .join("\n");
}

/** Строки «• Обучение персонала — 10 000 ₽ за группу» / «от …» / «по запросу». */
export function serviceListText(t: TemplateTranslator, services: readonly ClientEmailTemplateService[], locale: string): string {
  const nf = new Intl.NumberFormat(locale);
  return services
    .map((service) => {
      const price =
        service.priceRub === null
          ? t("serviceOnRequest")
          : `${t(service.priceFrom ? "servicePriceFrom" : "servicePrice", { amount: nf.format(service.priceRub) })}${service.unit ? ` ${service.unit}` : ""}`;
      return t("serviceLine", { title: service.title, price });
    })
    .join("\n");
}

/** Тема и текст шаблона для получателя `name` (пустое имя — обращение без имени). */
export function fillClientEmailTemplate(
  t: TemplateTranslator,
  id: ClientEmailTemplateId,
  context: ClientEmailTemplateContext,
  recipientName: string | null | undefined,
  locale: string,
): { subject: string; message: string } {
  const name = recipientName?.replace(/\s+/g, " ").trim();
  const values = {
    greeting: name ? t("greetingNamed", { name }) : t("greeting"),
    company: context.company,
    videoUrl: context.links.video,
    pdfUrl: context.links.pdf,
    siteUrl: context.links.site,
    registerUrl: context.links.register,
    pricingUrl: context.links.pricing,
    servicesUrl: context.links.services,
    loginUrl: context.links.login,
    knowledgeUrl: context.links.knowledge,
    botUrl: context.links.bot,
    supportPhone: context.supportPhone,
    supportTelegram: context.supportTelegram,
    trialDays: context.trialDays,
    tariffList: tariffListText(t, context.tariffs, locale),
    serviceList: serviceListText(t, context.services, locale),
  };
  return { subject: t(`items.${id}.subject`), message: t(`items.${id}.body`, values) };
}
