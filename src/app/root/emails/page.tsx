import { getTranslations } from "next-intl/server";

import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import type { Locale } from "@/i18n/locales";
import { loadMessages } from "@/i18n/messages";
import { getSiteLocale } from "@/i18n/site-locale-server";
import { requireRoot } from "@/lib/auth-helpers";
import { EMAIL_CATALOG, EMAIL_CATALOG_GROUPS, renderCatalogEmail } from "@/lib/email-catalog.server";

import { EmailsCatalogClient, type CatalogGroupView, type SelectedEmailView } from "./emails-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata() {
  const t = await getTranslations("rootEmails");
  return { title: t("title") };
}

const LOCALES: readonly Locale[] = ["ru", "en", "uz"];

type TemplateTexts = Record<string, { title: string; when: string }>;

/**
 * ROOT → «Платформа» → «Письма»: все письма сайта клиентам на примерах —
 * как их увидят в почте, текстовая версия, строка во входящих и «Прислать
 * мне» (спека emails-preheader-text-root-catalog-2026-11-21). Письмо
 * собирается на сервере настоящими функциями под перехватом — ничего не
 * отправляется, пока не нажали «Прислать мне».
 */
export default async function RootEmailsPage({ searchParams }: { searchParams: Promise<{ id?: string; locale?: string }> }) {
  await requireRoot();
  const t = await getTranslations("rootEmails");
  const params = await searchParams;
  const entry = EMAIL_CATALOG.find((item) => item.id === params.id) ?? EMAIL_CATALOG[0];
  const locale = LOCALES.find((value) => value === params.locale) ?? "ru";
  const email = await renderCatalogEmail(entry.id, locale);
  if (!email) throw new Error(`email catalog: «${entry.id}» не собралось`);

  // Названия писем — целым словарём языка интерфейса: id писем — строки, не литералы ключей.
  const templates: TemplateTexts = (await loadMessages(await getSiteLocale())).rootEmails.templates;
  const groups: CatalogGroupView[] = EMAIL_CATALOG_GROUPS.map((group) => ({
    key: group,
    title: t(`groups.${group}`),
    items: EMAIL_CATALOG.filter((item) => item.group === group).map((item) => ({
      id: item.id,
      title: templates[item.id]?.title ?? item.id,
      localized: item.locales.length > 1,
    })),
  }));
  const selected: SelectedEmailView = {
    id: entry.id,
    title: templates[entry.id]?.title ?? entry.id,
    when: templates[entry.id]?.when ?? "",
    locale: email.locale,
    locales: [...entry.locales],
    subject: email.subject,
    preheader: email.preheader,
    html: email.html,
    text: email.text,
    attachments: email.attachments.map((attachment) => attachment.filename),
  };

  return (
    <DomainMessagesBoundary namespaces={["rootEmails"]}>
      <div className="space-y-5">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">{t("title")}</h1>
          <p className="mt-1 max-w-[760px] text-[14px] leading-relaxed text-[#6f7282]">{t("description")}</p>
          <p className="mt-1 max-w-[760px] text-[13px] leading-relaxed text-[#9b9fb3]">{t("note")}</p>
        </div>
        {/* key: другое письмо — свежее состояние (вид, ширина, ответ «Прислать мне»). */}
        <EmailsCatalogClient key={`${selected.id}:${selected.locale}`} groups={groups} selected={selected} />
      </div>
    </DomainMessagesBoundary>
  );
}
