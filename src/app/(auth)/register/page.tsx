import RegisterClient from "./register-client";
import {
  DEFAULT_OG_IMAGES,
  DEFAULT_TWITTER_CARD,
  DEFAULT_TWITTER_IMAGES,
} from "@/lib/meta-defaults";
import { JOURNALS_TOTAL_ELECTRONIC_LABEL } from "@/lib/journal-catalog";
import { FREE_SEATS_LABEL } from "@/lib/plan-catalog";
import { discountLabel } from "@/lib/promo/discounts";
import { promoLinkStatus } from "@/lib/promo/personal-codes";
import { linkSphere } from "@/lib/promo/personal-link";

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

/**
 * Пришли по ссылке с промокодом (/promo/CODE?s=cafe → /register?promo=…&s=…):
 * сферу подставляем в форму, промокод показываем плашкой — применится на
 * оплате после регистрации. Код проверяем здесь (адресу не доверяем):
 * не действует — плашки нет.
 */
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const pick = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const sphere = linkSphere(pick("s"));
  const code = pick("promo")?.trim();
  const status = code ? await promoLinkStatus(code).catch(() => null) : null;
  const promo =
    status?.ok === true
      ? {
          code: status.promo.code,
          label: discountLabel({ source: "code", ...status.promo }),
        }
      : null;
  if (code || sphere) {
    console.info(
      `[promo] register page: promo=${code ?? "-"} (${status ? (status.ok ? "ok" : status.reason) : "none"}) sphere=${sphere ?? "-"}`
    );
  }
  return <RegisterClient promo={promo} sphere={sphere} />;
}
