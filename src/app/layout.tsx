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
import "./view-prefs.css";
// Last: light theme repaints the old indigo classes to black and greys.
import "./neutral-palette.css";
import { publicMetadataFor } from "@/i18n/public-metadata";
import { headers } from "next/headers";
import { isMobileAppUserAgent } from "@/lib/mobile-app";
import { PARTNER_HEADER_PATH } from "@/lib/partners/request-context";
import { isPublicCacheablePage } from "@/lib/robots-txt";
import { readViewPrefs } from "@/lib/view-prefs.server";
import { viewPrefsBootstrapCode, viewPrefsHtmlAttributes } from "@/lib/view-prefs";
import { ViewPrefsProvider } from "@/components/view-prefs/view-prefs-provider";

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
  return inApp ? { ...BASE_VIEWPORT, maximumScale: 1, viewportFit: "cover" } : BASE_VIEWPORT;
}

const PUBLIC_ROOT_NAMESPACES = [
  "common",
  "language",
  "auth",
  "landingComponents",
  "publicSupport",
  "publicUi",
  "errorSurface",
  "loadingSurfaces",
  "layoutUi",
  "sharedUi",
] as const;

const APP_ROOT_NAMESPACES = [
  ...PUBLIC_ROOT_NAMESPACES,
  "journals",
  "navigation",
  "journalControls",
  "notifications",
] as const;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getSiteLocale();
  const reqHeaders = await headers();
  const requestPath = reqHeaders.get(PARTNER_HEADER_PATH);
  const rootNamespaces =
    requestPath && isPublicCacheablePage(requestPath)
      ? PUBLIC_ROOT_NAMESPACES
      : APP_ROOT_NAMESPACES;
  const messages = pickMessages(await loadMessages(locale), rootNamespaces);
  // «Удобство чтения» этого устройства (размер текста, контраст, анимация,
  // пояснения) — атрибуты на <html> с первого кадра, без мигания.
  const viewPrefs = await readViewPrefs();
  return (
    // suppressHydrationWarning: скрипт ниже до гидрации ставит флаги «как в
    // системе» (высокий контраст, без анимации) по настройкам устройства.
    <html lang={locale} {...viewPrefsHtmlAttributes(viewPrefs)} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: viewPrefsBootstrapCode() }} />
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
        <ViewPrefsProvider initial={viewPrefs}>
        <ScrollToTop />
        {/* Приложение WeSetup: значки строки состояния под цвет шапки на
            страницах вне оболочки (QR, удаление аккаунта, политика). */}
        <NativeStatusBar />
        {children}
        <ServiceWorkerRegister />
        <BuildVersionWatcher />
        <YandexMetrika />
        <CookieConsent />
        </ViewPrefsProvider>
        </SiteLocaleProvider>
      </body>
    </html>
  );
}
