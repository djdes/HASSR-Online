import Link from "@/components/i18n/localized-link";
import { getSiteLocale } from "@/i18n/site-locale-server";
import { translatorFor } from "@/i18n/translator";
import type { Messages } from "@/i18n/messages";
import { FORMAT_LOCALES } from "@/i18n/locales";
import { localizedHref, siteLanguageAlternates, type SiteLocale } from "@/i18n/site-locale";
import { LanguageSwitch } from "@/components/i18n/language-switch";
import { publicMetadataFor } from "@/i18n/public-metadata";
import {
  ArrowRight,
  BellRing,
  Check,
  Download,
  FileText,
  LogIn,
  Plug,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  Wand2,
} from "lucide-react";
import { HardwareStrip } from "@/components/landing/hardware-strip";
import { Testimonials } from "@/components/landing/testimonials";
import { LANDING_SECTION_CLASS, LandingSectionHeader } from "@/components/landing/landing-section";
import { listPublicReviews } from "@/lib/balance/reviews";
import { buildAggregateRating } from "@/lib/seo/aggregate-rating";
import { NICHES } from "@/content/niches";
import { BrandLogo } from "@/components/brand/logo";
import {
  HARDWARE_BUNDLES,
  bundleTotal,
} from "@/lib/hardware-pricing";
import { PublicFooter } from "@/components/public/public-chrome";
import { PublicThemeBootstrap, PublicThemeScope } from "@/components/theme/site-theme";
import { QrPlayer } from "@/components/landing/qr-player/qr-player";
import { InterfaceShowcase, type ShowcaseIcon } from "@/components/landing/interface-showcase";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { buildQrMatrix } from "@/components/landing/qr-player/qr-matrix";
import { narratedVideoFor } from "@/components/landing/qr-player/narrated-video";
import { QrSticker } from "@/components/landing/qr-player/qr-sticker";
import { LandingMotion } from "@/components/public/landing-motion";
import { CursorGlow } from "@/components/public/cursor-glow";
import { AnchorScrollLink } from "@/components/public/anchor-scroll-link";
import { HeroEmailStart } from "@/components/landing/hero-email-start";
import { NavStartButton } from "@/components/landing/nav-start-button";
import { getServerSession } from "@/lib/server-session";
import { redirect } from "next/navigation";
import { isMobileAppRequest, MOBILE_APP_HOME } from "@/lib/mobile-app-payments";
import { authOptions } from "@/lib/auth";
import { getWebHomeHref } from "@/lib/role-access";
import { jsonLdSafeString } from "@/lib/json-ld";
import { readPlanPricing } from "@/lib/tariffs";
import { TariffComparison } from "@/components/pricing/tariff-comparison";
import { PromoPrice, formatPriceRub } from "@/components/pricing/promo-price";
import { readActivePromotion } from "@/lib/promo/offer";
import { applyPromotion } from "@/lib/promo/promotions";
import { readPpkIndividualPrice } from "@/lib/services/catalog";
import { SEATS_PER_POINT, STORAGE_BYTES, TRIAL_DAYS, planMonthlyRub } from "@/lib/tariff-plans";
import { JOURNALS_TOTAL } from "@/lib/journal-catalog";

const MB = 1024 * 1024;

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata() {
  const locale = await getSiteLocale();
  const t = await translatorFor(locale);
  const base = await publicMetadataFor(locale);
  const title = t("landing.metadata.title");
  const description = t("landing.metadata.description", { journalCount: JOURNALS_TOTAL, trialDays: TRIAL_DAYS });
  const url = `https://wesetup.ru${localizedHref("/", locale)}`;
  const image = `https://wesetup.ru/og/landing/${locale}`;
  return {
    ...base, title: { absolute: title }, description,
    alternates: { ...base.alternates, canonical: url, languages: siteLanguageAlternates("/") },
    openGraph: { title, description, url, locale: { ru: "ru_RU", en: "en_GB", uz: "uz_UZ" }[locale], siteName: "WeSetup", images: [image] },
    twitter: { card: "summary_large_image" as const, title, description, images: [image] },
  };
}

/*
 * Главная «упакована» (спека .agent/tasks/landing-pack-2026-09): первый
 * экран → QR-ролик → что ещё умеет → журналы для сферы → тарифы → отзывы
 * → вопросы → финальный призыв → подвал. Убраны дубли: второй
 * интерактивный журнал и «планшет» (то же показывает QR-ролик), баннер
 * «Бесплатно навсегда» (третья форма почты подряд), карусель «было/стало»
 * и сетка сфер на два экрана (сферы — одной сеткой ссылок на /dlya-*),
 * галерея образцов (бланки — на /blanki), блок блога (он в шапке и
 * подвале). Восемь карточек «Что внутри» сжаты до четырёх строк.
 */

/**
 * Что сервис делает кроме QR — по одной строке. Карточки ведут на
 * /features/*, полный список возможностей есть в подвале.
 */
const CAPABILITIES = [
  {
    icon: BellRing,
    slug: "reminders",
    title: "landing.capabilities.reminders.title",
    text: "landing.capabilities.reminders.text",
  },
  {
    icon: Wand2,
    slug: "autofill",
    title: "landing.capabilities.autofill.title",
    text: "landing.capabilities.autofill.text",
  },
  {
    icon: FileText,
    slug: "paperless",
    title: "landing.capabilities.paperless.title",
    text: "landing.capabilities.paperless.text",
  },
  {
    icon: Plug,
    slug: "sync-iiko-1c",
    title: "landing.capabilities.syncIiko1c.title",
    text: "landing.capabilities.syncIiko1c.text",
  },
] as const;

/**
 * Экраны кабинета для слайдера «Кабинет руководителя». Снимки — настоящие
 * страницы на демо-данных (public/landing/screens: desktop 1440×900,
 * mobile 390×800 при плотности 2×). Порядок — от «что видно каждый день»
 * к «что нужно раз в квартал».
 */
const SHOWCASE_SLIDES: ReadonlyArray<{ id: "dashboard" | "journals" | "grid" | "qr" | "inspection" | "staff"; icon: ShowcaseIcon; address: string }> = [
  { id: "dashboard", icon: "dashboard", address: "wesetup.ru/dashboard" },
  { id: "journals", icon: "journals", address: "wesetup.ru/journals" },
  { id: "grid", icon: "grid", address: "wesetup.ru/journals/cold_equipment_control" },
  { id: "qr", icon: "qr", address: "wesetup.ru/settings/qr-posters" },
  { id: "inspection", icon: "inspection", address: "wesetup.ru/inspection" },
  { id: "staff", icon: "staff", address: "wesetup.ru/settings/users" },
];

/** Самые частые журналы — ссылками в строку под сферами. */
const POPULAR_JOURNALS = [
  { code: "hygiene", name: "landing.popularJournals.hygiene" },
  { code: "health_check", name: "landing.popularJournals.health_check" },
  { code: "cold_equipment_control", name: "landing.popularJournals.cold_equipment_control" },
  { code: "finished_product", name: "landing.popularJournals.finished_product" },
  { code: "cleaning", name: "landing.popularJournals.cleaning" },
  { code: "incoming_control", name: "landing.popularJournals.incoming_control" },
] as const;

/**
 * Вопросы — от возражений к справке. Было 12: «Можно попробовать
 * бесплатно?» отвечают тарифы прямо над блоком, «Где указано, что можно
 * вести журналы в электронном виде?» слит с «Что такое электронный
 * журнал» (оба цитировали один СанПиН), «Подходит ли для школ и больниц»
 * отвечает сетка сфер. Список уходит и в разметку FAQPage.
 */
const FAQ = [
  {
    q: "landing.faq.refund.question",
    a: "landing.faq.refund.answer",
  },
  {
    q: "landing.faq.employeeAccess.question",
    a: "landing.faq.employeeAccess.answer",
  },
  {
    q: "landing.faq.missedEntry.question",
    a: "landing.faq.missedEntry.answer",
  },
  {
    q: "landing.faq.qrSecurity.question",
    a: "landing.faq.qrSecurity.answer",
  },
  {
    q: "landing.faq.electronicLogs.question",
    a: "landing.faq.electronicLogs.answer",
  },
  {
    q: "landing.faq.inspection.question",
    a: "landing.faq.inspection.answer",
  },
  {
    q: "landing.faq.integrations.question",
    a: "landing.faq.integrations.answer",
  },
  {
    q: "landing.faq.offline.question",
    a: "landing.faq.offline.answer",
  },
  {
    q: "landing.faq.dataSecurity.question",
    a: "landing.faq.dataSecurity.answer",
  },
  {
    q: "landing.faq.import.question",
    a: "landing.faq.import.answer",
  },
] as const;

/**
 * Пункты первого экрана. Появляются по очереди — см. `.hero-point`.
 * Порядок не случайный: сверху то, ради чего сервис и покупают.
 * Пункта «Бесплатный доступ ко всем журналам» больше нет: строкой ниже
 * то же самое сказано с цифрами («1 сотрудник — бесплатно»).
 * На телефоне строки 16 px и могут переноситься — список выровнен по
 * левому краю, галочка стоит у первой строки.
 */
const HERO_POINTS = [
  "landing.heroPoints.scan",
  "landing.heroPoints.automation",
  "landing.heroPoints.paper",
] as const;

/**
 * `**слово**` → <strong>. На первом экране читают не строки, а ключевые
 * слова, поэтому суть выделена жирным. Markdown ради трёх строк не
 * тащим.
 */
function emphasize(text: string) {
  return text.split("**").map((part, index) =>
    index % 2 ? (
      <strong key={index} className="font-semibold text-[#0b1024]">
        {part}
      </strong>
    ) : (
      part
    ),
  );
}

/** «Сегодня» для бланков в QR-ролике — по Москве. */
function moscowSceneDay(now: Date, locale: SiteLocale) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const year = pick("year");
  const month = pick("month");
  const day = pick("day");
  const monthName = new Intl.DateTimeFormat(FORMAT_LOCALES[locale], { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 15))
  );
  return {
    day,
    month,
    year,
    daysInMonth: new Date(Date.UTC(year, month, 0)).getUTCDate(),
    monthLabel: `${monthName} ${year}`,
  };
}

/** Три шага финального блока: как завести QR у себя. */
const QR_START_STEPS = [
  { title: "landing.qrSteps.equipment.title", text: "landing.qrSteps.equipment.text" },
  { title: "landing.qrSteps.stickers.title", text: "landing.qrSteps.stickers.text" },
  { title: "landing.qrSteps.scan.title", text: "landing.qrSteps.scan.text" },
] as const;

/** Контурная кнопка-ссылка: 48 px на телефоне, как все кнопки главной. */
const OUTLINE_BUTTON_CLASS =
  "inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-5 text-[16px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] sm:text-[15px]";

export default async function LandingPage() {
  const locale = await getSiteLocale();
  const copy = await translatorFor(locale);
  const nicheLabel = (slug: string) => {
    const key = `publicNavigation.niches.${slug}` as `publicNavigation.niches.${keyof Messages["publicNavigation"]["niches"]}`;
    return copy(key);
  };
  const freePlanTitle = copy("landing.pricing.freePlanTitle", { trialDays: TRIAL_DAYS });
  // В приложении лендинг с тарифами и кнопками оплаты не показываем
  // (правила магазинов) — сразу главный экран приложения.
  if (await isMobileAppRequest()) redirect(MOBILE_APP_HOME);
  // Auth state — для адаптации nav/CTA. Лендинг остаётся публичным,
  // но залогиненный видит «Открыть кабинет» вместо «Войти/Начать».
  const session = await getServerSession(authOptions).catch(() => null);
  const isAuthed = Boolean(session?.user);
  const homeHref = isAuthed
    ? getWebHomeHref({
        role: session?.user?.role ?? "",
        isRoot: session?.user?.isRoot === true,
      })
    : "/dashboard";
  const userInitials = (session?.user?.name ?? "")
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .join("")
    .toUpperCase()
    .slice(0, 2);

  // Цены тарифов живут в БД и правятся ROOT'ом в /root/tariffs — карточки,
  // калькулятор и JSON-LD читают одно и то же значение, поэтому смена
  // цены не требует деплоя. Страница уже force-dynamic.
  // Отзывы клиентов: только одобренные модератором и разрешённые к
  // публикации. Пусто — секции на странице не будет.
  const publicReviews = await listPublicReviews().catch((error) => {
    console.error("[landing] Failed to load reviews", error);
    return [];
  });
  const rating = buildAggregateRating(publicReviews);

  // Тарифы 2026-10 (ROOT → «Тарифы»): цены месяц/год из `PlatformTariff`,
  // действующая акция (ROOT → «Акции») — в первом экране, колонках и JSON-LD.
  const [pricing, promotion, ppkFromRub] = await Promise.all([
    readPlanPricing(),
    readActivePromotion().catch(() => null),
    readPpkIndividualPrice(),
  ]);
  const standardFrom = applyPromotion(planMonthlyRub(pricing.rates, "standard", "year"), promotion);
  const premiumFrom = applyPromotion(planMonthlyRub(pricing.rates, "premium", "year"), promotion);
  const heroPricing = copy.rich("landing.pricing.heroPhrase", {
    trialDays: TRIAL_DAYS,
    amount: formatPriceRub(standardFrom.priceRub, locale),
    price: () => <PromoPrice locale={locale} price={standardFrom} />,
  });

  // «от N ₽» в карточке оборудования — самый дешёвый готовый комплект.
  // Считаем, а не хардкодим: состав комплектов меняется в
  // lib/hardware-pricing.ts, и цена на лендинге обязана идти следом.
  const hardwareFromRub = Math.min(...HARDWARE_BUNDLES.map(bundleTotal));

  // QR-ролик: дата «сегодня» по Москве считается здесь, чтобы первый кадр
  // на сервере и после гидрации совпадал. QR на наклейках ролика и CTA —
  // настоящий, ведёт на этот блок.
  const qrMatrix = await buildQrMatrix(`https://wesetup.ru${localizedHref("/#qr", locale)}`, locale);
  const sceneToday = moscowSceneDay(new Date(), locale);
  const narratedVideo = narratedVideoFor(locale);

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": "https://wesetup.ru/#org",
        name: "WeSetup",
        url: "https://wesetup.ru",
        logo: "https://wesetup.ru/icons/icon-512.png",
        sameAs: ["https://t.me/wesetupbot"],
      },
      {
        "@type": "WebSite",
        "@id": "https://wesetup.ru/#website",
        url: "https://wesetup.ru",
        name: "WeSetup",
        publisher: { "@id": "https://wesetup.ru/#org" },
        inLanguage: FORMAT_LOCALES[locale],
      },
      {
        "@type": "SoftwareApplication",
        name: "WeSetup",
        applicationCategory: "BusinessApplication",
        // Native iOS/Android apps пока не выпущены — у нас Web + Telegram
        // Mini App. Не врём в JSON-LD: «Telegram Mini App» — это Web,
        // фактически работает на iOS/Android внутри Telegram, но это не
        // отдельные native приложения. Когда они появятся, поменяем.
        operatingSystem: "Web",
        description:
          copy("landing.seo.softwareDescription", { journalCount: JOURNALS_TOTAL }),
        // image — required для SoftwareApplication rich result в Google.
        // Раньше отдавали icon-512 (квадрат), но Google рекомендует
        // landscape для product/app rich-результатов. /og-default —
        // 1200×630 brand-hero, лучше карточка в выдаче.
        image: [`https://wesetup.ru/og/landing/${locale}`],
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "RUB",
          description: freePlanTitle,
        },
        // Звёзды в выдаче: только из одобренных отзывов с оценкой, не меньше трёх.
        ...(rating ?? {}),
      },
      {
        "@type": "FAQPage",
        mainEntity: FAQ.map((item) => ({
          "@type": "Question",
          name: copy(item.q),
          acceptedAnswer: { "@type": "Answer", text: copy(item.a) },
        })),
      },
      {
        "@type": "Product",
        name: copy("landing.productName"),
        description:
          copy("landing.seo.productDescription", { journalCount: JOURNALS_TOTAL }),
        // image — required для Product rich result. Без него Google не
        // показывает Offer-карточку с ценой/доступностью в выдаче.
        // 1200×630 landscape лучше квадрата для Product rich snippet.
        image: [`https://wesetup.ru/og/landing/${locale}`],
        brand: { "@id": "https://wesetup.ru/#org" },
        offers: [
          {
            "@type": "Offer",
            name: copy("landing.freePlan"),
            price: "0",
            priceCurrency: "RUB",
            description: copy("landing.seo.freeOfferDescription", { trialDays: TRIAL_DAYS, journalCount: JOURNALS_TOTAL }),
            availability: "https://schema.org/InStock",
          },
          // Цена в разметке = цена на странице («от» — при оплате за год):
          // в период акции — со скидкой и с датой, до которой она действует.
          ...([
            {
              name: copy("landingComponents.tariffs.tiers.standard.name"),
              price: standardFrom,
              description: copy("landing.seo.standardDescription", { employees: SEATS_PER_POINT.standard, mb: STORAGE_BYTES.standard / MB }),
            },
            {
              name: copy("landingComponents.tariffs.tiers.premium.name"),
              price: premiumFrom,
              description: copy("landing.seo.premiumDescription", { employees: SEATS_PER_POINT.premium, gb: STORAGE_BYTES.premium / (1024 * MB) }),
            },
          ].map((tier) => ({
            "@type": "Offer",
            name: tier.name,
            price: String(tier.price.priceRub),
            ...(tier.price.promotion ? { priceValidUntil: tier.price.promotion.endsAt.slice(0, 10) } : {}),
            priceCurrency: "RUB",
            priceSpecification: {
              "@type": "UnitPriceSpecification",
              price: String(tier.price.priceRub),
              priceCurrency: "RUB",
              unitText: copy("landing.month"),
            },
            description: tier.description,
            availability: "https://schema.org/InStock",
          }))),
        ],
      },
    ],
  };

  return (
    <div className="landing-page min-h-screen bg-white text-[#0b1024]">
      {/* Ночная тема: скрипт до гидрации + хук, который держит её актуальной. */}
      <PublicThemeBootstrap />
      <PublicThemeScope />
      <LandingMotion />
      <CursorGlow />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdSafeString(jsonLd) }}
      />
      {/* NAV — solid white, sticky so hero blobs don't bleed through on scroll.
          На телефоне кнопки и «Тарифы» — 48 px в высоту: в них попадают
          пальцем, а не курсором. */}
      <div className="landing-nav sticky top-0 z-40 border-b border-[#ececf4] bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <nav className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-6 sm:py-5">
          <Link href="/" className="text-[#0b1024]" aria-label={copy("landing.homeLink")}>
            <BrandLogo height={30} className="sm:[--logo-h:26px]" title="" />
          </Link>
          <div className="ml-auto flex items-center gap-2 sm:gap-3 lg:gap-6">
            <LanguageSwitch />
            <Link
              href="/journals-info"
              className="hidden text-[14px] font-medium text-[#6f7282] transition-colors hover:text-[#0b1024] lg:inline"
            >
              {copy("landing.logsLink")}</Link>
            <Link
              href="/blog"
              className="hidden text-[14px] font-medium text-[#6f7282] transition-colors hover:text-[#0b1024] lg:inline"
            >
              {copy("landing.blogLink")}</Link>
            {/* «Сколько это стоит» спрашивают раньше всего остального —
                пункт стоит рядом с входом, а не в подвале. Якорь, а не
                отдельная страница: тарифы тут же, ниже по этой же. */}
            <AnchorScrollLink
              href="#pricing"
              className="nav-tariffs hidden h-12 items-center px-2 text-[16px] font-medium text-[#6f7282] transition-colors hover:text-[#0b1024] min-[400px]:inline-flex sm:h-auto sm:px-0 sm:text-[14px]"
            >
              {copy("landing.pricingLink")}</AnchorScrollLink>
            {isAuthed ? (
              <>
                <Link
                  href={homeHref}
                  className="inline-flex h-12 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[16px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] sm:h-10 sm:text-[14px]"
                >
                  {copy("landing.openWorkspace")}<ArrowRight className="size-4" />
                </Link>
                <Link
                  href={homeHref}
                  title={session?.user?.name ?? copy("landing.profile")}
                  aria-label={`${copy("landing.profile")} · ${session?.user?.name ?? ""}`}
                  className="hidden size-10 items-center justify-center rounded-full border border-[#dcdfed] bg-[#f5f6ff] text-[12px] font-semibold text-[#3848c7] transition-colors hover:border-[#5566f6]/50 hover:bg-[#eef1ff] sm:inline-flex"
                >
                  {userInitials}
                </Link>
              </>
            ) : (
              <>
                {/* Кнопка «Начать бесплатно» показывается, только когда hero
                    с формой ушёл из вьюпорта: на первом экране она бы
                    конкурировала с полем почты, а ниже по странице без
                    неё единственное действие в шапке — «Войти». */}
                <NavStartButton />
                <Link
                  href="/login"
                  className="inline-flex h-12 shrink-0 items-center gap-2 whitespace-nowrap rounded-2xl border border-[#dcdfed] bg-white px-4 text-[16px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] sm:h-10 sm:text-[14px]"
                >
                  {copy("landing.signIn")}<LogIn className="size-4 text-[#5566f6]" />
                </Link>
              </>
            )}
          </div>
        </nav>
      </div>

      {/* HERO. На телефоне — одна левая ось с остальными секциями
          (раньше заголовок стоял по центру, список — блоком по центру,
          согласие — от левого края, и первый экран читался вразнобой).
          С sm — прежняя центрированная композиция. overflow-x-clip держит
          фоновые пятна по горизонтали, не обрезая тени по вертикали. */}
      <section className="landing-hero relative overflow-x-clip pb-8 sm:pb-12">
        {/* Soft ambient gradient wash */}
        <div
          className="pointer-events-none absolute inset-0 -z-0"
          aria-hidden="true"
        >
          <div className="absolute left-[10%] top-[-8%] size-[720px] rounded-full bg-[#5566f6] opacity-[0.08] blur-[140px]" />
          <div className="absolute right-[5%] top-[40%] size-[620px] rounded-full bg-[#7a5cff] opacity-[0.07] blur-[140px]" />
          <div
            className="absolute inset-0 opacity-[0.35]"
            style={{
              backgroundImage:
                "radial-gradient(circle at 1px 1px, rgba(11,16,36,0.10) 1px, transparent 0)",
              backgroundSize: "28px 28px",
              maskImage:
                "radial-gradient(ellipse at 50% 40%, black 30%, transparent 75%)",
            }}
          />
          {/* Smooth fade to white at both ends so the hero "breathes" into
              the page instead of cutting abruptly */}
          <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-white" />
        </div>

        <div className="relative mx-auto max-w-[1100px] px-4 pt-6 sm:px-6 sm:pt-16 sm:text-center">
          {/* Отметка о реестре — рукописной заметкой со стрелкой на
              заголовок, а не пилюлей: пилюля на первом экране читалась
              как ещё одна кнопка и конкурировала с призывом к действию.
              Буквы запечены в контуры SVG, потому что прод не ходит в
              Google Fonts (см. layout.tsx) — держать ради одной строки
              ещё один self-hosted шрифт дороже, чем статика с кешем. */}
          <div className="hero-mark w-[210px] max-w-[64vw] sm:mx-auto sm:w-[340px]">
            {locale !== "ru" ? <p className="text-[13px] font-medium leading-snug text-[#3848c7] sm:text-[18px]">{copy("landing.registry.softwareRegistryLabel")}</p> : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src="/brand/registry-mark.svg"
              alt={copy("landing.softwareRegistry")}
              width={340}
              height={73}
              // Картинка стоит выше H1 и попадает в первый экран, поэтому
              // грузим её с высоким приоритетом: браузер иначе ставит её в
              // общую очередь и она успевает сдвинуть заголовок.
              // next/image здесь не нужен — это SVG фиксированного размера,
              // оптимизировать в нём нечего.
              fetchPriority="high"
              decoding="async"
              className="h-auto w-full"
            />
            )}
          </div>

          {/* Headline — fluid scale: 26 px at 320 → 30 px at 390 → 72 px
              on desktop. «Электронные журналы» на телефоне — одной
              строкой (≈10.9em в Segoe UI при tracking -0.02em). */}
          <h1 className="hero-title mt-3 max-w-[920px] text-[clamp(1.625rem,7.6vw,4.5rem)] font-semibold leading-[1.08] tracking-[-0.02em] text-[#0b1024] sm:mx-auto sm:mt-8">
            {copy.rich("landing.hero.title", { highlight: (chunks) => <span className="relative inline-block">
              <span className="relative z-10">{chunks}</span>
              <span
                aria-hidden="true"
                className="absolute inset-x-0 bottom-[0.08em] -z-0 h-[0.28em] bg-[#5566f6]/15"
              />
            </span> })}
          </h1>

          {/* Вместо абзаца — пункты, появляющиеся по очереди: человек на
              первом экране не читает, а сканирует. Анимация на чистом CSS
              тем же keyframe'ом, что и остальной hero. На десктопе список
              стоит по центру блоком (`w-fit`), строки внутри — от левого
              края: галочки в одну колонку, а не «лесенкой». */}
          <ul className="mt-5 flex flex-col items-start gap-2 text-left sm:mx-auto sm:mt-7 sm:w-fit sm:max-w-full">
            {HERO_POINTS.map((point, index) => (
              <li
                key={point}
                className="hero-point flex items-start gap-2.5 text-[16px] leading-[1.45] text-[#3c4053]"
                style={{ animationDelay: `${250 + index * 150}ms` }}
              >
                <span className="mt-px inline-flex size-[22px] shrink-0 items-center justify-center rounded-full bg-[#eef1ff] text-[#5566f6]">
                  <Check className="size-3" strokeWidth={3} />
                </span>
                <span>{emphasize(copy(point))}</span>
              </li>
            ))}
          </ul>

          {/* Цены — одной строкой: ответ на «сколько стоит» остаётся на
              первом экране, подробности — по клику в #pricing. Числа из
              тех же констант, что и тарифы. На телефоне — строка-ссылка
              от левого края (пилюля там переносилась на две строки и
              становилась овалом), с sm — прежняя пилюля. Два элемента, а
              не один с sm:-классами: ночная тема красит всё, в чьём
              классе есть «bg-white/», и на телефоне под строкой вылезала
              плашка. */}
          <AnchorScrollLink
            href="#pricing"
            ariaLabel={copy("landing.viewPricing")}
            className="group mt-4 flex min-h-12 max-w-full flex-wrap items-center gap-x-1.5 text-left text-[16px] leading-[1.45] text-[#3c4053] sm:hidden"
          >
            <span>{heroPricing}</span>
            <ArrowRight className="size-4 shrink-0 text-[#3848c7]" />
          </AnchorScrollLink>
          <AnchorScrollLink
            href="#pricing"
            ariaLabel={copy("landing.viewPricing")}
            className="group mx-auto mt-6 hidden w-fit max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-0.5 rounded-full border border-[#dcdfed] bg-white/80 px-4 py-2 text-[14px] text-[#3c4053] backdrop-blur transition-colors hover:border-[#5566f6]/45 hover:bg-white sm:flex"
          >
            <span>{heroPricing}</span>
            <ArrowRight className="size-3.5 shrink-0 text-[#3848c7] transition-transform group-hover:translate-x-0.5" />
          </AnchorScrollLink>

          {/* Single big CTA — для залогиненного «Открыть кабинет»,
              для анонимного — «Начать бесплатно» (регистрация) */}
          <div className="hero-cta mt-5 flex flex-col items-stretch gap-3 sm:mt-10 sm:items-center">
            {isAuthed ? (
              <>
                <Link
                  href={homeHref}
                  className="group inline-flex h-14 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-6 text-[16px] font-semibold text-white shadow-[0_20px_50px_-20px_rgba(85,102,246,0.55)] transition-all hover:-translate-y-0.5 hover:bg-[#4a5bf0] hover:shadow-[0_24px_55px_-18px_rgba(85,102,246,0.65)] sm:px-8"
                >
                  {copy("landing.openWorkspace")}<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                </Link>
                <div className="text-[16px] text-[#6f7282] sm:text-[13px]">
                  {copy("landing.account.signedInAs", { name: session?.user?.name ?? "" })}
                </div>
              </>
            ) : (
              <>
                {/* Почта спрашивается прямо здесь: так первый шаг —
                    одно поле, а не переход на отдельную страницу. */}
                <HeroEmailStart
                  place="hero"
                  layout="stack"
                  buttonLabel={copy("landing.tryFree")}
                  showLoginLink={false}
                />
                {/* Гарантия — прямо в первом экране: снимать риск нужно
                    там же, где просим действие, а не через два экрана. */}
                <div className="inline-flex items-center gap-2 text-[16px] font-medium text-[#116b2a] sm:text-[14px]">
                  <ShieldCheck className="size-4 shrink-0" />
                  {copy("landing.refundGuarantee")}</div>
              </>
            )}
          </div>

          <p className="hero-consultation-note mt-6 max-w-[72ch] text-[13px] leading-[1.6] text-[#6f7282] sm:mx-auto">
            {copy("landing.hero.consultationNote")}
          </p>
        </div>
      </section>

      {/* QR-РОЛИК — сразу после героя и отдельной секцией верхнего уровня:
          LandingMotion даёт ей data-inview, иначе stagger-правило
          globals.css спрятало бы детей. Внутри блока ничего не меняем
          (спека): только общий вертикальный ритм снаружи. */}
      <section id="qr" className={`${LANDING_SECTION_CLASS} scroll-mt-[72px] sm:scroll-mt-24`}>
        <div className="relative overflow-hidden rounded-3xl border border-[#ececf4] bg-[#0b1024] text-white shadow-[0_20px_60px_-30px_rgba(11,16,36,0.55)]">
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            <div className="absolute -left-24 -top-24 size-[420px] rounded-full bg-[#5566f6] opacity-40 blur-[120px]" />
            <div className="absolute -bottom-40 -right-32 size-[460px] rounded-full bg-[#7a5cff] opacity-30 blur-[140px]" />
            <div className="absolute left-1/3 top-1/2 size-[280px] rounded-full bg-[#3d4efc] opacity-25 blur-[100px]" />
          </div>
          <div className="relative z-10 p-4 pt-7 sm:p-8 md:p-10">
            <div className="max-w-[760px] px-1 sm:px-0">
              <div className="mb-3 inline-flex items-center gap-2 text-[13px] font-medium text-[#8b97ff]">
                <ScanLine className="size-4" />
                {copy("landing.qrEquipmentTitle")}</div>
              <h2 className="text-[clamp(1.625rem,2.4vw+1rem,2.5rem)] font-semibold leading-[1.1] tracking-[-0.02em]">
                {copy("landing.qrScanHeadline")}</h2>
              {/* Одно предложение: где наклейки и что бывает при пропуске
                  рассказывают сами главы ролика, дублировать текстом не надо. */}
              <p className="mt-3 text-[15px] leading-[1.6] text-white/75 sm:text-[16px]">
                {copy("landing.qrScanDescription")}</p>
            </div>
            <div className="mt-7 sm:mt-9">
              <DomainMessagesBoundary namespaces={["qrPlayer", "qrScene", "hygiene"]}>
                <QrPlayer qr={qrMatrix} today={sceneToday} video={narratedVideo} />
              </DomainMessagesBoundary>
            </div>
          </div>
        </div>
      </section>

      {/* КАБИНЕТ РУКОВОДИТЕЛЯ — настоящие экраны слайдером. Ролик выше
          показывает сотрудника у оборудования, здесь — что видит
          заведующая. Скриншотов на главной не было с упаковки лендинга. */}
      <section id="interface" className={`${LANDING_SECTION_CLASS} scroll-mt-[72px] sm:scroll-mt-24`}>
        <LandingSectionHeader title={copy("landing.showcase.title")} lead={copy("landing.showcase.lead")} />
        <InterfaceShowcase
          slides={SHOWCASE_SLIDES.map((slide) => ({
            id: slide.id,
            icon: slide.icon,
            address: slide.address,
            tab: copy(`landing.showcase.slides.${slide.id}.tab`),
            title: copy(`landing.showcase.slides.${slide.id}.title`),
            text: copy(`landing.showcase.slides.${slide.id}.text`),
            desktop: { src: `/landing/screens/${slide.id}-desktop.webp`, width: 1440, height: 900 },
            mobile: { src: `/landing/screens/${slide.id}-mobile.webp`, width: 390, height: 800 },
          }))}
          labels={{
            region: copy("landing.showcase.region"),
            tabs: copy("landing.showcase.tabs"),
            previous: copy("landing.showcase.previous"),
            next: copy("landing.showcase.next"),
            positions: SHOWCASE_SLIDES.map((_, index) =>
              copy("landing.showcase.position", { current: index + 1, total: SHOWCASE_SLIDES.length }),
            ),
          }}
        />
      </section>

      {/* ЧТО ЕЩЁ УМЕЕТ — вместо восьми карточек «Что внутри» (2 200 px на
          телефоне): четыре строки о том, чего не показывает ролик. «Всё в
          облаке» и «Экономия времени» ничего не добавляли, «Напоминания» и
          «Алерты» — одна мысль, QR уже рассказан выше. Остальные
          возможности — в подвале, ряд «Возможности». */}
      <section className={LANDING_SECTION_CLASS}>
        <LandingSectionHeader
          title={copy("landing.automationHeadline")}
          lead={copy("landing.automationLead")}
        />
        <ul className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
          {CAPABILITIES.map((item) => (
            <li key={item.slug}>
              <Link
                href={`/features/${item.slug}`}
                className="group flex h-full items-start gap-4 rounded-2xl border border-[#ececf4] bg-white p-4 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] transition-[border-color,box-shadow] duration-200 hover:border-[#5566f6]/40 hover:shadow-[0_14px_32px_-16px_rgba(85,102,246,0.28)] sm:flex-col sm:gap-3 sm:p-5"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
                  <item.icon className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[17px] font-semibold leading-snug tracking-[-0.01em] text-[#0b1024] group-hover:text-[#3848c7]">
                    {copy(item.title)}
                  </span>
                  <span className="mt-1 block text-[16px] leading-[1.5] text-[#3c4053] sm:text-[15px]">
                    {copy(item.text)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* ЖУРНАЛЫ ДЛЯ СФЕРЫ — вместо четырёх блоков: «Какие журналы уже
          внутри» (12 строк), «Кому подходит» (9 групп чипов, 2 200 px на
          телефоне), карусель «было/стало» и галерея образцов. Сферы —
          одной сеткой ссылок на /dlya-* (тот же список, что в подвале),
          самые частые журналы — ссылками в строку, весь каталог и бланки —
          двумя кнопками. Ссылки нужны и для поиска. */}
      <section id="journals" className={`${LANDING_SECTION_CLASS} scroll-mt-[72px] sm:scroll-mt-24`}>
        <LandingSectionHeader
          title={copy("landing.logsForIndustry")}
          lead={copy("landing.journals.sectionLead", { journalCount: JOURNALS_TOTAL })}
        />
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
          {Object.values(NICHES).map((niche) => (
            <li key={niche.slug}>
              <Link
                href={`/${niche.slug}`}
                className="group flex h-full min-h-12 items-center justify-between gap-2 rounded-2xl border border-[#ececf4] bg-white px-3.5 py-2.5 text-[16px] font-medium leading-snug text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] hover:text-[#3848c7] sm:px-4 sm:text-[15px]"
              >
                <span className="min-w-0">{nicheLabel(niche.slug)}</span>
                {/* Стрелка — с sm: на телефоне в две колонки она съедала
                    место, и половина названий переносилась. Рамка плитки и
                    так читается как кнопка. */}
                <ArrowRight className="hidden size-4 shrink-0 text-[#5566f6] transition-transform duration-150 group-hover:translate-x-0.5 sm:block" />
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-6 max-w-[860px] text-[16px] leading-[1.75] text-[#3c4053]">
          {copy("landing.popularLogsIntro")}{" "}
          {POPULAR_JOURNALS.map((journal, index) => (
            <span key={journal.code}>
              <Link
                href={`/journals-info/${journal.code}`}
                className="font-medium text-[#3848c7] underline decoration-[#3848c7]/30 underline-offset-4 transition-colors duration-150 hover:decoration-[#3848c7]"
              >
                {copy(journal.name)}
              </Link>
              {index < POPULAR_JOURNALS.length - 1 ? ", " : "."}
            </span>
          ))}
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:gap-3">
          <Link href="/journals-info" className={OUTLINE_BUTTON_CLASS}>
            {copy("publicNavigation.allLogsLink", { journalCount: JOURNALS_TOTAL })}
            <ArrowRight className="size-4 text-[#5566f6]" />
          </Link>
          <Link href="/blanki" className={OUTLINE_BUTTON_CLASS}>
            <Download className="size-4 text-[#5566f6]" />
            {copy("landing.logTemplates")}</Link>
        </div>
      </section>

      {/* PRICING */}
      <section
        id="pricing"
        className={`${LANDING_SECTION_CLASS} scroll-mt-[72px] sm:scroll-mt-24`}
      >
        {/* Тарифы 2026-10: три колонки, как у подписок на ИИ, — переключатель
            «Помесячно / За год», точки, таблица сравнения и ППК под ними. */}
        <LandingSectionHeader title={copy("landing.pricingTitle", { trialDays: TRIAL_DAYS })} />

        <TariffComparison
          mode="public"
          rates={pricing.rates}
          available={pricing.available}
          promotion={promotion}
          ppkFromRub={ppkFromRub}
          ppkHref="/uslugi#ppk-development"
          startHref="#start"
          showTable
          className="mt-2"
        />

        {/* Оборудование — возможность «Премиума»: подбор комплекта под
            колонками, а не отдельной карточкой рядом с тарифами. */}
        <div className="mt-5">
          <HardwareStrip
            premiumMonthlyRub={planMonthlyRub(pricing.rates, "premium", "year")}
            promotion={promotion}
            hardwareFromRub={hardwareFromRub}
          />
        </div>

        {/* ГАРАНТИЯ — одной строкой под тарифами. Раньше это был блок в
            полэкрана с иконкой 64 px и чипами «Всё включено» (их содержание
            уже есть в карточках тарифов); риск снимается там же, где цена. */}
        <div className="mt-4 flex items-start gap-4 rounded-2xl border border-[#5566f6]/20 bg-gradient-to-br from-[#f5f6ff] to-white p-4 sm:items-center sm:px-6 sm:py-5">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#5566f6] text-white shadow-[0_12px_30px_-14px_rgba(85,102,246,0.65)]">
            <RotateCcw className="size-5" />
          </span>
          <div className="min-w-0 flex-1 sm:flex sm:items-center sm:justify-between sm:gap-6">
            <div className="min-w-0">
              <div className="text-[18px] font-semibold leading-snug tracking-[-0.01em] text-[#0b1024]">
                {copy("landing.refundHeading")}</div>
              <p className="mt-1 text-[16px] leading-[1.5] text-[#3c4053] sm:text-[15px]">
                {copy("landing.refundDetails")}</p>
            </div>
            <Link
              href="/oferta"
              className="mt-1 inline-flex min-h-12 shrink-0 items-center gap-1.5 text-[16px] font-medium text-[#3848c7] underline-offset-4 hover:underline sm:mt-0 sm:text-[14px]"
            >
              {copy("landing.refundTerms")}<ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Отзывы — только одобренные и разрешённые к публикации; нет таких —
          секции нет. Сеткой в общей колонке, а не каруселью во всю ширину. */}
      <Testimonials reviews={publicReviews} locale={locale} />

      {/* FAQ */}
      <section className={LANDING_SECTION_CLASS}>
        <LandingSectionHeader title={copy("landing.faqHeading")} />
        <div className="divide-y divide-[#ececf4] overflow-hidden rounded-2xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          {FAQ.map((item) => (
            <details key={item.q} className="group">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-4 py-4 text-[16px] font-medium leading-snug text-[#0b1024] transition-colors duration-150 hover:bg-[#fafbff] sm:px-5 sm:py-5 [&::-webkit-details-marker]:hidden">
                <span>{copy(item.q)}</span>
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#f5f6ff] text-[#5566f6] transition-transform group-open:rotate-45">
                  <svg
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </span>
              </summary>
              <div className="px-4 pb-5 text-[16px] leading-[1.6] text-[#3c4053] sm:px-5 sm:text-[15px]">
                {copy(item.a)}
              </div>
            </details>
          ))}
        </div>
      </section>

      {/* FINAL CTA — акцент на QR: три шага и золотая наклейка (золото
          в дизайн-системе — только QR, одно на экран). id="start" — сюда
          ведут «Начать бесплатно» из тарифов. Наклейка — только на
          широком экране: навести на неё камеру можно лишь с другого
          устройства, на телефоне это просто картинка на полэкрана. */}
      <section
        id="start"
        className={`${LANDING_SECTION_CLASS} scroll-mt-[72px] sm:scroll-mt-24`}
      >
        <div className="overflow-hidden rounded-3xl border border-[#ececf4] bg-[#f5f6ff] p-5 sm:p-10 md:p-14">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:gap-14">
            <div className="min-w-0 flex-1">
              <h2 className="text-[clamp(1.5rem,2vw+1rem,2.25rem)] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]">
                {copy("landing.finalCtaHeading")}</h2>
              <p className="mt-3 max-w-[560px] text-[16px] leading-[1.6] text-[#3c4053]">
                {copy("landing.finalCtaDetails", { trialDays: TRIAL_DAYS })}</p>
              <ol className="mt-6 grid gap-3 sm:grid-cols-3">
                {QR_START_STEPS.map((step, index) => (
                  <li key={step.title} className="flex items-start gap-3 rounded-2xl border border-[#ececf4] bg-white p-4">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#5566f6] text-[16px] font-semibold tabular-nums text-white">
                      {index + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[16px] font-semibold leading-snug text-[#0b1024]">{copy(step.title)}</span>
                      <span className="mt-1 block text-[16px] leading-[1.5] text-[#3c4053] sm:text-[14px]">{copy(step.text)}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <div className="mt-6">
                {isAuthed ? (
                  <Link
                    href={homeHref}
                    className="inline-flex h-12 items-center gap-2 rounded-2xl bg-[#5566f6] px-6 text-[16px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors hover:bg-[#4a5bf0]"
                  >
                    {copy("landing.openWorkspace")}<ArrowRight className="size-4" />
                  </Link>
                ) : (
                  // Тот же одношаговый старт, что и в hero — человек
                  // дочитал страницу, не надо снова вести его на форму.
                  <HeroEmailStart place="final" align="start" showLoginLink={false} />
                )}
              </div>
            </div>
            {/* Наклейка — как её увидит сотрудник. Код настоящий: ведёт
                к ролику на этой странице. */}
            <div className="hidden w-[240px] shrink-0 lg:block">
              <div className="rotate-[-3deg] text-[30px]">
                <QrSticker qr={qrMatrix} caption={copy("landing.qr.scanCaption")} />
              </div>
              <p className="mt-5 text-center text-[13px] leading-[1.5] text-[#6f7282]">
                {copy("landing.qrCameraInstruction")}</p>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER — юридические ссылки, реквизиты и перелинковка: /blanki,
          /journals-info, все /dlya-*, возможности. */}
      <PublicFooter />
    </div>
  );
}
