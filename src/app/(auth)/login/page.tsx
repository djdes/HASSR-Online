import LoginClient from "./login-client";
import { MiniShellReset } from "@/components/layout/mini-shell-reset";
import {
  DEFAULT_OG_IMAGES,
  DEFAULT_TWITTER_CARD,
  DEFAULT_TWITTER_IMAGES,
} from "@/lib/meta-defaults";

const TITLE = "Вход в кабинет";
const DESC =
  "Вход в личный кабинет WeSetup. Электронные журналы СанПиН и ХАССП для общепита и пищевых производств.";
const URL = "https://wesetup.ru/login";

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

export default function LoginPage() {
  return (
    <>
      {/* Дошли до формы с паролем — значит это обычный браузер, а не
          Telegram: режим мобильной оболочки снимаем. */}
      <MiniShellReset />
      <LoginClient />
    </>
  );
}
