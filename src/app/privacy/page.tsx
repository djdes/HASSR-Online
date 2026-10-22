import type { Metadata } from "next";
import { createTranslator } from "use-intl/core";
import { getSiteLocale } from "@/i18n/site-locale-server";
import { loadMessages } from "@/i18n/messages";
import { localizedHref, siteLanguageAlternates } from "@/i18n/site-locale";
import { ogImages, twitterImages } from "@/lib/og-image";
import { LegalArticle, LegalRequisites } from "@/components/public/legal-article";
import {
  DEFAULT_OG_IMAGES,
  DEFAULT_TWITTER_CARD,
  DEFAULT_TWITTER_IMAGES,
} from "@/lib/meta-defaults";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getSiteLocale();
  const messages = await loadMessages(locale);
  const t = createTranslator({ locale, messages, namespace: "publicPrivacy" });
  const title = t("metadata.title");
  const description = t("metadata.description");
  const url = `https://wesetup.ru${localizedHref("/privacy", locale)}`;
  const image = { title, subtitle: description, kind: "page" as const, locale };
  return {
    title,
    description,
    alternates: { canonical: url, languages: siteLanguageAlternates("/privacy") },
    openGraph: { type: "website", locale: { ru: "ru_RU", en: "en_GB", uz: "uz_UZ" }[locale], siteName: "WeSetup", url, title, description, images: locale === "ru" ? [...DEFAULT_OG_IMAGES] : ogImages(image) },
    twitter: { card: DEFAULT_TWITTER_CARD, title, description, images: locale === "ru" ? [...DEFAULT_TWITTER_IMAGES] : twitterImages(image) },
  };
}

export default async function PrivacyPage() {
  const locale = await getSiteLocale();
  const messages = await loadMessages(locale);
  const t = createTranslator({ locale, messages, namespace: "publicPrivacy" });
  const legal = createTranslator({ locale, messages, namespace: "publicLegalRequisites" });
  return (
    <LegalArticle
      title={t("document.title")}
      revision={t("document.revision")}
      intro={t("document.intro")}
    >
      <h2>{t("section1.title")}</h2>
      <p>{t("clause1_1")}</p>
      <p>{t("clause1_2")}</p>
      <p>{t("clause1_3")}</p>
      <p>{t("clause1_4")}</p>
      <p>{t("clause1_5")}</p>
      <p>{t("clause1_6")}</p>

      <h2>{t("section2.title")}</h2>
      <p>{t.rich("clause2_1", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
      <p>{t.rich("clause2_2", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
      <p>{t.rich("clause2_3", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
      <p>{t.rich("clause2_4", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
      <p>{t.rich("clause2_5", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
      <p>{t.rich("clause2_6", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
      <p>{t.rich("clause2_7", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
      <p>{t.rich("clause2_8", { strong: (chunks) => <strong>{chunks}</strong> })}</p>

      <h2>{t("section3.title")}</h2>
      <p>{t("clause3_1")}</p>
      <ul>
        <li>{t("section3.item1")}</li>
        <li>{t("section3.item2")}</li>
        <li>{t("section3.item3")}</li>
        <li>{t("section3.item4")}</li>
        <li>{t("section3.item5")}</li>
      </ul>
      <p>{t("clause3_2")}</p>

      <h2>{t("section4.title")}</h2>
      <p>{t("clause4_1")}</p>
      <p>{t("clause4_1_1")}</p>
      <p>{t("clause4_1_2")}</p>
      <p>{t("clause4_1_3")}</p>
      <p>{t("clause4_1_4")}</p>
      <p>{t("clause4_1_5")}</p>
      <p>{t.rich("clause4_1_6", { supportLink: (chunks) => <a href="mailto:support@wesetup.ru">{chunks}</a> })}</p>
      <p>{t("clause4_1_7")}</p>
      <p>{t("clause4_1_8")}</p>
      <p>{t("clause4_1_9")}</p>
      <p>{t("clause4_2")}</p>

      <h2>{t("section5.title")}</h2>
      <p>{t.rich("clause5_1", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
      <p>{t.rich("clause5_2", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
      <p>{t.rich("clause5_3", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
      <p>{t.rich("clause5_4", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
      <p>{t.rich("clause5_5", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
      <p>{t.rich("clause5_6", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
      <p>{t.rich("clause5_7", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
      <p>{t.rich("clause5_8", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
      <p>{t("clause5_9")}</p>
      <p>{t("clause5_10")}</p>

      <h2>{t("section6.title")}</h2>
      <p>{t("clause6_1")}</p>
      <p>{t("clause6_2")}</p>
      <p>{t("clause6_3")}</p>
      <ul>
        <li>{t("section6.item1")}</li>
        <li>{t("section6.item2")}</li>
        <li>{t("section6.item3")}</li>
        <li>{t("section6.item4")}</li>
      </ul>
      <p>{t("clause6_4")}</p>
      <p>{t("clause6_5")}</p>

      <h2>{t("section7.title")}</h2>
      <p>{t("clause7_1")}</p>
      <p>{t("clause7_2")}</p>
      <p>{t("clause7_3")}</p>

      <h2>{t("section8.title")}</h2>
      <p>{t("clause8_1")}</p>
      <p>{t("clause8_2")}</p>
      <p>{t.rich("clause8_2_1", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
      <p>{t.rich("clause8_2_2", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
      <p>{t.rich("clause8_2_3", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
      <p>{t.rich("clause8_2_4", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
      <p>{t.rich("clause8_2_5", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
      <p>{t.rich("clause8_2_6", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
      <p>{t("clause8_3")}</p>
      <p>{t.rich("clause8_4", { strong: (chunks) => <strong>{chunks}</strong> })}</p>

      <h2>{t("section9.title")}</h2>
      <p>{t.rich("clause9_1", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
      <p>{t("clause9_2")}</p>
      <p>{t("clause9_3")}</p>
      <p>{t("clause9_4")}</p>
      <p>{t("clause9_5")}</p>
      <p>{t("clause9_6")}</p>

      <h2>{t("section10.title")}</h2>
      <p>{t("clause10_1")}</p>
      <p>{t("clause10_2")}</p>
      <p>{t.rich("clause10_2_1", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
      <p>{t.rich("clause10_2_2", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
      <p>{t.rich("clause10_2_3", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
      <p>{t.rich("clause10_3", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
      <p>{t.rich("clause10_4", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
      <ul>
        <li>{t.rich("section10.item1", { strong: (chunks) => <strong>{chunks}</strong> })}</li>
        <li>{t.rich("section10.item2", { strong: (chunks) => <strong>{chunks}</strong> })}</li>
        <li>{t.rich("section10.item3", { strong: (chunks) => <strong>{chunks}</strong> })}</li>
        <li>{t.rich("section10.item4", { strong: (chunks) => <strong>{chunks}</strong> })}</li>
        <li>{t.rich("section10.item5", { strong: (chunks) => <strong>{chunks}</strong> })}</li>
      </ul>
      <p>{t("clause10_5")}</p>
      <p>{t("clause10_6")}</p>
      <p>{t("clause10_7")}</p>

      <h2>{t("section11.title")}</h2>
      <p>{t("clause11_1")}</p>
      <p>{t("clause11_2")}</p>
      <ul>
        <li>{t("section11.item1")}</li>
        <li>{t("section11.item2")}</li>
        <li>{t("section11.item3")}</li>
        <li>{t("section11.item4")}</li>
        <li>{t("section11.item5")}</li>
        <li>{t("section11.item6")}</li>
        <li>{t("section11.item7")}</li>
        <li>{t("section11.item8")}</li>
        <li>{t("section11.item9")}</li>
        <li>{t("section11.item10")}</li>
        <li>{t("section11.item11")}</li>
        <li>{t("section11.item12")}</li>
      </ul>
      <p>{t("clause11_3")}</p>
      <p>{t("clause11_4")}</p>
      <p>{t("clause11_5")}</p>

      <h2>{t("section12.title")}</h2>
      <p>{t("clause12_1")}</p>
      <p>{t("clause12_1_1")}</p>
      <p>{t("clause12_1_2")}</p>
      <p>{t("clause12_1_3")}</p>
      <p>{t("clause12_1_4")}</p>
      <p>{t("clause12_1_5")}</p>
      <p>{t("clause12_1_6")}</p>
      <p>{t.rich("clause12_2", { strong: (chunks) => <strong>{chunks}</strong>, supportLink: (chunks) => <a href="mailto:support@wesetup.ru">{chunks}</a> })}</p>
      <p>{t("clause12_3")}</p>
      <p>{t.rich("clause12_4", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
      <p>{t("clause12_5")}</p>
      <p>{t("clause12_6")}</p>
      <p>{t("clause12_7")}</p>

      <h2>{t("section13.title")}</h2>
      <p>{t("clause13_1")}</p>
      <p>{t("clause13_2")}</p>
      <p>{t("clause13_3")}</p>
      <p>{t("clause13_4")}</p>
      <p>{t("clause13_5")}</p>
      <p>{t("clause13_6")}</p>

      <h2>{t("section14.title")}</h2>
      <LegalRequisites copy={{
        heading: legal("heading"),
        taxIds: legal("taxIds", { inn: "5018215599", kpp: "501801001" }),
        registrationId: legal("registrationId", { ogrn: "1235000105306" }),
        address: legal("address", { address: "141065, Московская область, г. Королёв, ул. Ленина, д. 10/6" }),
        telephone: legal.rich("telephone", { phoneLink: (chunks) => <a href="tel:+79996341612" className="text-[#3848c7] transition-colors hover:text-[#0b1024]">{chunks}</a> }),
        email: legal.rich("email", { emailLink: (chunks) => <a href="mailto:support@wesetup.ru" className="break-all text-[#3848c7] transition-colors hover:text-[#0b1024]">{chunks}</a> }),
        website: legal.rich("website", { siteLink: (chunks) => <a href="https://wesetup.ru" className="text-[#3848c7] transition-colors hover:text-[#0b1024]">{chunks}</a> }),
      }} />
      <p>{t.rich("clause14_contact", { supportLink: (chunks) => <a href="mailto:support@wesetup.ru">{chunks}</a> })}</p>
    </LegalArticle>
  );
}
