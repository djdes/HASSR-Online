import type { Metadata, Viewport } from "next";
import { getSiteLocale } from "@/i18n/site-locale-server";
import { loadMessages, pickMessages } from "@/i18n/messages";
import { SiteLocaleProvider } from "@/components/i18n/site-locale-provider";
import { ScrollToTop } from "@/components/layout/scroll-to-top";
import localFont from "next/font/local";
import { ServiceWorkerRegister } from "@/components/layout/sw-register";
import { BuildVersionWatcher } from "@/components/layout/build-version-watcher";
import { YandexMetrika } from "@/components/layout/yandex-metrika";
import { CookieConsent } from "@/components/public/cookie-consent";
import { NativeStatusBar } from "@/app/mini/_components/native-status-bar";
import "./globals.css";
import "./app-theme.css";
import "./public-theme.css";
import { publicMetadataFor } from "@/i18n/public-metadata";
import { headers } from "next/headers";
import { isMobileAppUserAgent } from "@/lib/mobile-app";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Manrope — шрифт эталона (lk.haccp-online.ru). Подключаем как CSS-переменную
 * и НЕ ставим его на <body>: лендинг и публичные страницы должны остаться на
 * текущем системном стеке. Переменную потребляет только `.app-shell`
 * (см. `app-theme.css`), то есть дашборд и /root.
 *
 * Self-hosted (next/font/local): прод-сервер не имеет доступа к
 * fonts.gstatic.com, и next/font/google валил сборку («Failed to fetch
 * Manrope from Google Fonts»). Вариативный TTF (латиница + кириллица,
 * веса 200–800) лежит в репозитории — сборка не зависит от сети.
 */
const manrope = localFont({
  src: "./fonts/manrope-variable.ttf",
  weight: "200 800",
  variable: "--font-manrope",
  display: "swap",
  // Без preload: файл 68 КБ качается только там, где шрифт реально
  // используется (кабинет), а публичные QR-формы на системном шрифте
  // не ждут его на медленной сети.
  preload: false,
});

export async function generateMetadata(): Promise<Metadata> {
  return publicMetadataFor(await getSiteLocale());
}

/**
 * Явный viewport вместо неявного Next-дефолта: раньше поведение
 * масштаба на телефоне было «как получится», и разбираться с
 * самопроизвольным зумом приходилось вслепую.
 *
 * maximumScale намеренно НЕ ставим: жёсткий запрет зума ломает
 * WCAG 1.4.4 (слабовидящие не смогут увеличить текст). Причина
 * авто-зума — шрифты полей меньше 16px, они подняты до 16px.
 */
const BASE_VIEWPORT: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Владелец дважды просил убрать самопроизвольное увеличение на
  // iPhone. Причину (поля меньше 16px) починили, но Safari умеет
  // зумить и по двойному тапу, поэтому фиксируем масштаб.
  //
  // `userScalable: false` НЕ ставим: iOS всё равно оставляет ручной
  // pinch-zoom при одном лишь maximumScale, и слабовидящий человек
  // сможет увеличить текст пальцами. Полный запрет отрезал бы его от
  // сайта совсем.
  maximumScale: 1,
};

/**
 * В приложении WeSetup страница рисуется под строкой состояния и полоской
 * «домой» (Android 15+ всегда во весь экран, на iOS отступов нет).
 * `viewport-fit=cover` включает env(safe-area-inset-*), и отступы берёт
 * сама вёрстка. Только для приложения: в Telegram, браузере и на
 * домашнем экране всё как раньше.
 */
export async function generateViewport(): Promise<Viewport> {
  const inApp = isMobileAppUserAgent((await headers()).get("user-agent"));
  return inApp ? { ...BASE_VIEWPORT, viewportFit: "cover" } : BASE_VIEWPORT;
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getSiteLocale();
  const messages = pickMessages(await loadMessages(locale), ["common", "language", "journals", "auth", "navigation", "journalControls", "notifications", "landingComponents", "publicSupport", "publicUi", "errorSurface", "loadingSurfaces", "layoutUi", "sharedUi"]);
  return (
    <html lang={locale}>
      <head>
        {/* Иконки вкладки и домашнего экрана берёт App Router из
            src/app/icon.png и src/app/apple-icon.png — ручные <link>
            здесь дублировали бы их и расходились при замене. */}
        <meta name="theme-color" content="#0b1024" />
        {/* Манифест и apple-mobile-web-app-* переехали в
            src/app/mini/layout.tsx (2026-09-08). Устанавливается на
            домашний экран рабочий кабинет сотрудника, а не витрина: с
            манифестом в корне лендинг предлагал «установить приложение»,
            которое открывается на /mini и постороннему посетителю
            бесполезно. */}
      </head>
      {/* suppressHydrationWarning: на публичных страницах inline-скрипт
          темы вешает на body класс и data-атрибут до гидрации. */}
      <body
        className={`${manrope.variable} antialiased overflow-x-clip`}
        suppressHydrationWarning
      >
        <SiteLocaleProvider locale={locale} messages={messages}>
        <ScrollToTop />
        {/* Приложение WeSetup: значки строки состояния под цвет шапки на
            страницах вне оболочки (QR, удаление аккаунта, политика). */}
        <NativeStatusBar />
        {children}
        <ServiceWorkerRegister />
        <BuildVersionWatcher />
        <YandexMetrika />
        <CookieConsent />
        </SiteLocaleProvider>
      </body>
    </html>
  );
}
