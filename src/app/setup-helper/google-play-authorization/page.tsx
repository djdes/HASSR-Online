import type { Metadata } from "next";
import Link from "next/link";

import { GooglePlayAuthorizationCard } from "@/components/public/google-play-authorization-card";
import { LegalArticle, LegalRequisites } from "@/components/public/legal-article";
import { DEFAULT_TWITTER_CARD } from "@/lib/meta-defaults";
import { ogImages, twitterImages } from "@/lib/og-image";
import {
  GOOGLE_PLAY_AUTH_DATE_RU,
  GOOGLE_PLAY_AUTH_PACKAGE_ID,
  GOOGLE_PLAY_AUTH_PDF_PATH,
  GOOGLE_PLAY_AUTH_STATEMENT_EN,
  GOOGLE_PLAY_AUTH_STATEMENT_RU,
  GOOGLE_PLAY_AUTH_URL,
} from "@/lib/setup-helper-play-authorization";

const TITLE =
  "Разрешение ООО «БФС» на публикацию приложения «Сетап помощник» в Google Play";
const DESCRIPTION =
  "Официальное разрешение правообладателя ООО «БФС» на публикацию и обновление приложения «Сетап помощник» (app.wedo4u.setuphelper) в Google Play.";

const OG_IMAGE = {
  title: TITLE,
  subtitle: DESCRIPTION,
  kind: "page" as const,
  locale: "ru" as const,
};

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: GOOGLE_PLAY_AUTH_URL },
  openGraph: {
    type: "website",
    siteName: "WeSetup",
    url: GOOGLE_PLAY_AUTH_URL,
    title: TITLE,
    description: DESCRIPTION,
    images: ogImages(OG_IMAGE),
  },
  twitter: {
    card: DEFAULT_TWITTER_CARD,
    title: TITLE,
    description: DESCRIPTION,
    images: twitterImages(OG_IMAGE),
  },
};

export default function SetupHelperGooglePlayAuthorizationPage() {
  return (
    <LegalArticle
      title={TITLE}
      revision={`Исх. № БФС-GP-2026/11 от ${GOOGLE_PLAY_AUTH_DATE_RU}`}
      intro="Настоящая страница опубликована на официальном сайте правообладателя ООО «БФС» (wesetup.ru) для подтверждения прав интеллектуальной собственности и полномочий издателя в Google Play."
    >
      <h2>1. Официальное разрешение правообладателя</h2>
      <p>
        <strong>«{GOOGLE_PLAY_AUTH_STATEMENT_RU}»</strong>
      </p>
      <p>
        Разрешение выдано Генеральным директором Общества с ограниченной ответственностью «БФС» (ИНН 5018215599, КПП
        501801001, ОГРН 1235000105306) Волковым Денисом Владимировичем, действующим на основании Устава, и остаётся в
        силе бессрочно до письменного отзыва правообладателем.
      </p>

      <GooglePlayAuthorizationCard showPageLink={false} />

      <h2>2. Official Authorization Notice (English — for Google Play App Review)</h2>
      <p>
        <strong>&ldquo;{GOOGLE_PLAY_AUTH_STATEMENT_EN}&rdquo;</strong>
      </p>
      <ul>
        <li>
          <strong>Rightsholder / Owner:</strong> BFS LLC (Общество с ограниченной ответственностью «БФС»), INN
          5018215599, KPP 501801001, OGRN 1235000105306, Official Domain: <code>wesetup.ru</code>
        </li>
        <li>
          <strong>Authorized Google Play Publisher:</strong> Olga Karakyanova (Каракьянова Ольга)
        </li>
        <li>
          <strong>Application Title:</strong> Сетап помощник (Setup Helper)
        </li>
        <li>
          <strong>Google Play Package Name (Application ID):</strong> <code>{GOOGLE_PLAY_AUTH_PACKAGE_ID}</code>
        </li>
        <li>
          <strong>Signed Official Letterhead (PDF):</strong>{" "}
          <a href={GOOGLE_PLAY_AUTH_PDF_PATH} target="_blank" rel="noopener noreferrer">
            wesetup.ru{GOOGLE_PLAY_AUTH_PDF_PATH}
          </a>
        </li>
        <li>
          <strong>Application Privacy Policy:</strong>{" "}
          <Link href="/setup-helper/privacy">wesetup.ru/setup-helper/privacy</Link>
        </li>
      </ul>

      <h2>3. Связанные документы и проверка подлинности</h2>
      <p>
        Подлинность настоящего разрешения подтверждается его размещением непосредственно на официальном домене
        правообладателя{" "}
        <Link href="/">
          wesetup.ru
        </Link>
        , в разделе{" "}
        <Link href="/about#google-play-authorization">
          «О компании» (wesetup.ru/about)
        </Link>
        , в{" "}
        <Link href="/setup-helper/privacy#google-play-authorization">
          политике конфиденциальности приложения «Сетап помощник»
        </Link>{" "}
        и в{" "}
        <a href={GOOGLE_PLAY_AUTH_PDF_PATH} target="_blank" rel="noopener noreferrer">
          подписанном PDF-документе на бланке ООО «БФС»
        </a>
        . По вопросам проверки полномочий обращайтесь на{" "}
        <a href="mailto:admin@wesetup.ru">admin@wesetup.ru</a>.
      </p>

      <LegalRequisites showGooglePlayAuth={false} />
    </LegalArticle>
  );
}
