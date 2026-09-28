import RegisterClient from "./register-client";
import {
  DEFAULT_OG_IMAGES,
  DEFAULT_TWITTER_CARD,
  DEFAULT_TWITTER_IMAGES,
} from "@/lib/meta-defaults";
import { JOURNALS_TOTAL_ELECTRONIC_LABEL } from "@/lib/journal-catalog";
import { FREE_SEATS_LABEL } from "@/lib/plan-catalog";

const TITLE = "Регистрация организации";
const DESC =
  `Создайте бесплатный аккаунт WeSetup за 5 минут. ${FREE_SEATS_LABEL} — бесплатно навсегда. Все ${JOURNALS_TOTAL_ELECTRONIC_LABEL} СанПиН и ХАССП включены.`;
const URL = "https://wesetup.ru/register";

export const metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: URL },
  openGraph: {
    type: "website",
    locale: "ru_RU",
    siteName: "WeSetup",
    url: URL,
    title: TITLE,
    description: DESC,
    images: DEFAULT_OG_IMAGES,
  },
  twitter: {
    card: DEFAULT_TWITTER_CARD,
    title: TITLE,
    description: DESC,
    images: DEFAULT_TWITTER_IMAGES,
  },
};

export default function RegisterPage() {
  return <RegisterClient />;
}
