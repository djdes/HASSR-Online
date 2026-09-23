import Link from "next/link";
import {
  ArrowRight,
  Bell,
  BellRing,
  Check,
  CheckCircle2,
  LogIn,
  Clock,
  Cloud,
  Gift,
  Handshake,
  HelpCircle,
  NotebookText,
  Plug,
  Printer,
  QrCode,
  RotateCcw,
  ScanLine,
  Send,
  ShieldCheck,
  Smartphone,
  Store,
  Timer,
  UserCheck,
  Wand2,
  Wifi,
  Refrigerator,
} from "lucide-react";
import { db } from "@/lib/db";
import { EquipmentPricing } from "@/components/landing/equipment-pricing";
import { AudienceCarousel } from "@/components/landing/audience-carousel";
import { TestimonialsCarousel } from "@/components/landing/testimonials-carousel";
import { listPublicReviews } from "@/lib/balance/reviews";
import { buildAggregateRating } from "@/lib/seo/aggregate-rating";
import { IndustriesGrid } from "@/components/landing/industries-grid";
import { AutomationScene } from "@/components/landing/automation-scene";
import { SampleGallery } from "@/components/landing/sample-gallery";
import { DOCX_SAMPLE_CODES } from "@/lib/document-docx";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { FREE_MAX_USERS } from "@/lib/plan-limits";
import {
  catalogPlanIdFor,
  FREE_PLAN_NOTE,
  EXTRA_USER_PRICE_RUB,
  LARGE_TEAM_NOTE,
  SUBSCRIPTION_MAX_USERS,
} from "@/lib/plan-catalog";
import { BrandLogo } from "@/components/brand/logo";
import {
  HARDWARE_BUNDLES,
  bundleTotal,
} from "@/lib/hardware-pricing";
import { PublicFooter } from "@/components/public/public-chrome";
import { PublicThemeBootstrap, PublicThemeScope } from "@/components/theme/site-theme";
import { QrPlayer } from "@/components/landing/qr-player/qr-player";
import { buildQrMatrix } from "@/components/landing/qr-player/qr-matrix";
import { QrSticker } from "@/components/landing/qr-player/qr-sticker";
import { LandingMotion } from "@/components/public/landing-motion";
import { CursorGlow } from "@/components/public/cursor-glow";
import { AnchorScrollLink } from "@/components/public/anchor-scroll-link";
import { DemoJournalWidget } from "@/components/landing/demo-journal-widget";
import { HeroEmailStart } from "@/components/landing/hero-email-start";
import { NavStartButton } from "@/components/landing/nav-start-button";
import { JournalAutoplayVideo } from "@/components/landing/journal-autoplay-video";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getWebHomeHref } from "@/lib/role-access";
import { jsonLdSafeString } from "@/lib/json-ld";
import {
  readTariffs,
  fallbackTariffs,
  formatRub,
  TARIFF_MONTHLY,
} from "@/lib/tariffs";
import { PlanCard } from "@/components/pricing/plan-card";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  // Ключевик в начале, бренд в конце. Template корневого layout к
  // root-page.tsx НЕ применяется (проверено на проде — суффикс не
  // дублируется), поэтому «— WeSetup» пишем в строке вручную.
  title: "Электронные журналы СанПиН и ХАССП онлайн — WeSetup",
  description:
    "35 электронных журналов СанПиН и ХАССП для общепита и производств. QR-наклейки на оборудовании: отсканировал, ввёл PIN — запись в журнале. PDF для Роспотребнадзора. Бесплатно до 3 сотрудников.",
  alternates: { canonical: "https://wesetup.ru/", types: { "application/rss+xml": [{ url: "https://wesetup.ru/blog/feed.xml", title: "WeSetup — блог" }, { url: "https://wesetup.ru/whats-new/feed.xml", title: "WeSetup — что нового" }] } },
};

const FEATURES = [
  {
    icon: QrCode,
    slug: "qr",
    title: "Заполнение по QR",
    text: "Наклейка на холодильнике, лампе, фритюрнице, у термометра. Скан, PIN, значение — и запись уже в журнале.",
  },
  {
    icon: Plug,
    slug: "sync-iiko-1c",
    title: "Синхронизация с iiko / 1С",
    text: "Подтягиваем поставщиков, продукты и поступления — бракераж и входной контроль заполняются автоматически.",
  },
  {
    icon: Wand2,
    slug: "autofill",
    title: "Автозаполнение",
    text: "Гигиена, температуры, уборка — сервис подставляет значения там, где это безопасно и разрешено.",
  },
  {
    icon: Cloud,
    slug: "cloud",
    title: "Всё в облаке",
    text: "Журналы доступны из любой точки — компьютер, планшет у шефа, телефон в цехе. История сохраняется.",
  },
  {
    icon: UserCheck,
    slug: "role-access",
    title: "Доступы по ролям",
    text: "Каждый сотрудник видит только свои журналы. Управляющий видит всех и может закрыть период.",
  },
  {
    icon: BellRing,
    slug: "reminders",
    title: "Напоминания",
    text: "Почта и Telegram пишут, если до конца смены остался незаполненный журнал. Конец дня — журналы закрыты.",
  },
  {
    icon: Bell,
    slug: "alerts",
    title: "Алерты о нарушениях",
    text: "Температура вне нормы, просрочка, отклонение — уведомление ответственному в реальном времени.",
  },
  {
    icon: Timer,
    slug: "time-saving",
    title: "Экономия времени",
    text: "5–10 минут на заполнение всех журналов в конце смены вместо часа возни с бумагой и пастами.",
  },
];

const JOURNAL_PREVIEW: Array<{ code: string; name: string }> = [
  { code: "hygiene", name: "Гигиенический журнал" },
  { code: "health_check", name: "Журнал здоровья (ЗОЖ)" },
  { code: "climate_control", name: "Контроль температуры и влажности" },
  { code: "cleaning", name: "Журнал уборки помещений" },
  { code: "uv_lamp_runtime", name: "Работа УФ-бактерицидной установки" },
  { code: "finished_product", name: "Бракераж готовой продукции" },
  { code: "fryer_oil", name: "Учёт фритюрных жиров" },
  { code: "cold_equipment_control", name: "Температура холодильного оборудования" },
  { code: "cleaning_ventilation_checklist", name: "Чек-лист проветривания" },
  { code: "general_cleaning", name: "График генеральных уборок" },
  { code: "incoming_control", name: "Приёмка и входной контроль сырья" },
  { code: "med_books", name: "Медицинские книжки" },
];

/**
 * Что входит в подписку — чипами на блоке гарантии.
 *
 * Раньше здесь был «бонусный стек» с зачёркнутыми ценами и итогом
 * «отдельно это стоило бы 49 000 ₽». Суммы были оценкой, а не
 * прайсом подрядчика, и на странице читались как рекламный приём.
 * Оставили только перечень — он честный и проверяемый.
 */
const INCLUDED_CHIPS = [
  { icon: NotebookText, label: "35 журналов" },
  { icon: Wand2, label: "Инструкции для смены" },
  { icon: Send, label: "Telegram-бот" },
  { icon: Handshake, label: "Помощь с настройкой" },
] as const;

const FAQ = [
  {
    q: "Что если сервис не подойдёт — можно вернуть деньги?",
    a: "Да. В течение 14 дней с оплаты подписки вернём всю сумму по заявлению на support@wesetup.ru — без вопросов и без удержаний. Условия возврата закреплены в договоре-оферте, это обязательство, а не рекламное обещание.",
  },
  {
    q: "Нужно ли сотрудникам ставить приложение или помнить пароль?",
    a: "Нет. QR-наклейку сканирует обычная камера телефона — открывается страница нужного журнала. Сотрудник выбирает себя в списке и подтверждает запись личным PIN из 4–6 цифр. Приложение и вход в кабинет не нужны.",
  },
  {
    q: "Что будет, если сотрудник не отсканировал QR и не заполнил журнал?",
    a: "Графа останется пустой, и сервис это увидит. Руководителю придёт напоминание в Telegram в 12:00, в 17:00 — повторное и письмо на почту, в 21:00 — срочное. По гигиеническому журналу в конце смены ответственные получают список тех, кто не отметился.",
  },
  {
    q: "Можно ли подделать запись по QR?",
    a: "Запись подтверждается личным PIN сотрудника, после пяти неверных попыток ввод блокируется на 15 минут. Время ставит сервер, а в журнале действий остаётся, кто, когда и что записал. У каждого холодильника своя наклейка, и сменить оборудование в форме нельзя.",
  },
  {
    q: "Что такое электронный журнал для общепита?",
    a: "Веб-сервис, куда сотрудники вносят те же записи, что раньше делали в бумажных журналах — гигиена, температура, бракераж и так далее. Такой формат прямо разрешён СанПиН 2.3/2.4.4282-26, который действует с 1 сентября 2026 года.",
  },
  {
    q: "Как проходит проверка Роспотребнадзором?",
    a: "Инспектору выгружается PDF со всеми записями за запрошенный период. Формат печати соответствует требованиям: ФИО, должность, электронная подпись, дата и ключевые значения.",
  },
  {
    q: "Есть ли синхронизация с iiko и 1С?",
    a: "Да. Поставщики, продукты, поступления и бракераж подтягиваются автоматически, чтобы руками вбивать не приходилось. Настройка — около 30 минут вместе с нашим инженером.",
  },
  {
    q: "Где указано, что можно вести журналы в электронном виде?",
    a: "СанПиН 2.3/2.4.4282-26 «Санитарно-эпидемиологические требования к организации общественного питания населения», действует с 1 сентября 2026 года и заменил прежний 2.3/2.4.3590-20. Электронная форма прямо разрешена.",
  },
  {
    q: "Можно попробовать бесплатно?",
    a: "Да — бесплатный тариф действует навсегда: до 3 сотрудников все 35 журналов включены без ограничений по времени и без привязки карты. Подписку оформляете, только если нужно больше рабочих мест или автоматизация с датчиками.",
  },
  {
    q: "Что если пропадёт интернет?",
    a: "Ничего страшного: интерфейс продолжает работать на планшете, записи сохраняются локально и автоматически уходят на сервер при появлении сети. Пропустить смену из-за проблем с WiFi нельзя.",
  },
  {
    q: "Безопасны ли мои данные?",
    a: "Все журналы хранятся в защищённой PostgreSQL-базе на серверах в России. Резервные копии — каждые 6 часов. Передача — по HTTPS с TLS 1.3. Доступ — только по логину/паролю с ролевой моделью; PDF-выгрузка для проверок только с учётной записью администратора.",
  },
  {
    q: "Можно ли перенести данные из Excel/бумаги?",
    a: "Да. Импорт сотрудников, оборудования и поставщиков — из Excel-таблицы. Старые бумажные записи остаются у вас, новые ведутся в WeSetup; можно опционально оцифровать архив за деньги.",
  },
  {
    q: "Подходит ли для школьного питания / больниц / детских садов?",
    a: "Да. Те же СанПиН-журналы (гигиена, термообработка, бракераж, входной контроль) обязательны и для школ/больниц. Шаблоны общие; адаптация под специфику — в настройках.",
  },
];

/**
 * Пункты первого экрана. Появляются по очереди — см. `.hero-point`.
 * Порядок не случайный: сверху то, ради чего сервис и покупают.
 * Длина строк — не длиннее «Автосоздание и автозаполнение журналов»:
 * на телефоне (360–390 px) каждая должна умещаться в одну строку, иначе
 * гарантия под кнопкой уезжает за сгиб экрана.
 */
const HERO_POINTS = [
  "**Скан QR-кода** — и запись в журнале",
  "**Автосоздание** и **автозаполнение** журналов",
  "**Бесплатный** доступ ко всем журналам",
  "**Электронные и бумажные** журналы",
] as const;

/**
 * `**слово**` → <strong>. На первом экране читают не строки, а ключевые
 * слова, поэтому суть выделена жирным. Markdown ради четырёх строк не
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
function moscowSceneDay(now: Date) {
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
  const monthName = new Intl.DateTimeFormat("ru-RU", { month: "long", timeZone: "UTC" }).format(
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
  { icon: Refrigerator, title: "Добавьте оборудование", text: "Холодильники, лампы, фритюрницы — в настройках, за пару минут." },
  { icon: Printer, title: "Распечатайте наклейки", text: "Лист QR-наклеек на обычном принтере — и на места." },
  { icon: ScanLine, title: "Сотрудники сканируют", text: "Камера телефона, PIN, значение — журнал ведётся сам." },
] as const;

export default async function LandingPage() {
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

  // Тариф залогиненного: на бесплатном первую карточку показываем как
  // «Текущий», а не зовём регистрироваться заново.
  const viewerOrganizationId = session?.user?.organizationId ?? null;
  const viewerPlan = viewerOrganizationId
    ? (
        await db.organization
          .findUnique({
            where: { id: viewerOrganizationId },
            select: { subscriptionPlan: true },
          })
          .catch(() => null)
      )?.subscriptionPlan ?? null
    : null;
  const viewerOnFreePlan = isAuthed && catalogPlanIdFor(viewerPlan) === "free";

  const latestArticles = await db.article
    .findMany({
      where: { publishedAt: { not: null } },
      orderBy: { publishedAt: "desc" },
      take: 3,
      select: {
        slug: true,
        title: true,
        excerpt: true,
        tags: true,
        readMinutes: true,
        publishedAt: true,
      },
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[landing] Failed to load latest articles: ${message}`);
      return [];
    });

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

  const tariffs = await readTariffs().catch(() => fallbackTariffs());
  const monthly =
    tariffs.find((t) => t.key === TARIFF_MONTHLY) ?? fallbackTariffs()[0];

  // «от N ₽» в карточке оборудования — самый дешёвый готовый комплект.
  // Считаем, а не хардкодим: состав комплектов меняется в
  // lib/hardware-pricing.ts, и цена на лендинге обязана идти следом.
  const hardwareFromRub = Math.min(...HARDWARE_BUNDLES.map(bundleTotal));

  // Список для галереи образцов собираем на сервере: клиенту незачем
  // тянуть каталог и модуль DOCX ради тринадцати строк.
  const docxCodes = new Set<string>(DOCX_SAMPLE_CODES);
  const sampleGalleryItems = ACTIVE_JOURNAL_CATALOG.map((item) => ({
    code: item.code,
    name: item.name,
    docx: docxCodes.has(item.code),
  }));

  // QR-ролик: дата «сегодня» по Москве считается здесь, чтобы первый кадр
  // на сервере и после гидрации совпадал. QR на наклейках ролика и CTA —
  // настоящий, ведёт на этот блок.
  const qrMatrix = buildQrMatrix("https://wesetup.ru/#qr");
  const sceneToday = moscowSceneDay(new Date());

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
        inLanguage: "ru-RU",
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
          "Электронные журналы СанПиН и ХАССП для общепита и пищевых производств. 35 журналов, заполнение по QR-наклейкам на оборудовании, автозаполнение, PDF для Роспотребнадзора.",
        // image — required для SoftwareApplication rich result в Google.
        // Раньше отдавали icon-512 (квадрат), но Google рекомендует
        // landscape для product/app rich-результатов. /og-default —
        // 1200×630 brand-hero, лучше карточка в выдаче.
        image: ["https://wesetup.ru/og-default"],
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "RUB",
          description: "Бесплатный тариф до 3 сотрудников",
        },
        // Звёзды в выдаче: только из одобренных отзывов с оценкой, не меньше трёх.
        ...(rating ?? {}),
      },
      {
        "@type": "FAQPage",
        mainEntity: FAQ.map((item) => ({
          "@type": "Question",
          name: item.q,
          acceptedAnswer: { "@type": "Answer", text: item.a },
        })),
      },
      {
        "@type": "Product",
        name: "WeSetup — электронные журналы СанПиН и ХАССП",
        description:
          "35 журналов для общепита и пищевых производств. Заполнение по QR-коду с телефона, автозаполнение, PDF для проверок Роспотребнадзора.",
        // image — required для Product rich result. Без него Google не
        // показывает Offer-карточку с ценой/доступностью в выдаче.
        // 1200×630 landscape лучше квадрата для Product rich snippet.
        image: ["https://wesetup.ru/og-default"],
        brand: { "@id": "https://wesetup.ru/#org" },
        offers: [
          {
            "@type": "Offer",
            name: "Бесплатный",
            price: "0",
            priceCurrency: "RUB",
            description: "До 3 сотрудников, все 35 журналов, бессрочно",
            availability: "https://schema.org/InStock",
          },
          {
            "@type": "Offer",
            name: monthly.title,
            price: String(monthly.priceRub),
            priceCurrency: "RUB",
            priceSpecification: {
              "@type": "UnitPriceSpecification",
              price: String(monthly.priceRub),
              priceCurrency: "RUB",
              unitText: "месяц",
            },
            description: `До ${SUBSCRIPTION_MAX_USERS} сотрудников в подписке, далее +${EXTRA_USER_PRICE_RUB} ₽/мес за каждого; IoT-датчики, автозаполнение`,
            availability: "https://schema.org/InStock",
          },
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
      {/* NAV — solid white, sticky so hero blobs don't bleed through on scroll */}
      <div className="landing-nav sticky top-0 z-40 border-b border-[#ececf4] bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <nav className="mx-auto flex max-w-[1200px] items-center justify-between px-4 py-2.5 sm:px-6 sm:py-5">
          <Link href="/" className="text-[#0b1024]" aria-label="WeSetup — на главную">
            <BrandLogo height={30} className="sm:[--logo-h:26px]" title="" />
          </Link>
          <div className="flex items-center gap-3 sm:gap-6">
            <Link
              href="/journals-info"
              className="hidden text-[14px] font-medium text-[#6f7282] transition-colors hover:text-[#0b1024] sm:inline"
            >
              Журналы
            </Link>
            <Link
              href="/blog"
              className="hidden text-[14px] font-medium text-[#6f7282] transition-colors hover:text-[#0b1024] sm:inline"
            >
              Блог
            </Link>
            {/* «Сколько это стоит» спрашивают раньше всего остального —
                пункт стоит рядом с входом, а не в подвале. Якорь, а не
                отдельная страница: тарифы тут же, ниже по этой же. */}
            <AnchorScrollLink
              href="#pricing"
              className="nav-tariffs text-[14px] font-medium text-[#6f7282] transition-colors hover:text-[#0b1024]"
            >
              Тарифы
            </AnchorScrollLink>
            {isAuthed ? (
              <>
                <Link
                  href={homeHref}
                  className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-3.5 text-[13px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] sm:px-4 sm:text-[14px]"
                >
                  Открыть кабинет
                  <ArrowRight className="size-4" />
                </Link>
                <Link
                  href={homeHref}
                  title={session?.user?.name ?? "Профиль"}
                  aria-label={`Профиль · ${session?.user?.name ?? ""}`}
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
                  className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] sm:px-4"
                >
                  Войти
                  <LogIn className="size-4 text-[#5566f6]" />
                </Link>
              </>
            )}
          </div>
        </nav>
      </div>

      {/* HERO — centered stack, megaplan-inspired */}
      {/* overflow-x-clip contains the tilted phones horizontally, but lets
          vertical shadows + natural-height children extend freely so they
          don't get guillotined by the section boundary. */}
      <section className="landing-hero relative overflow-x-clip pb-14 sm:pb-32">
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

        <div className="relative mx-auto max-w-[1100px] px-4 pt-6 text-center sm:px-6 sm:pt-16">
          {/* Отметка о реестре — рукописной заметкой со стрелкой на
              заголовок, а не пилюлей: пилюля на первом экране читалась
              как ещё одна кнопка и конкурировала с призывом к действию.
              Буквы запечены в контуры SVG, потому что прод не ходит в
              Google Fonts (см. layout.tsx) — держать ради одной строки
              ещё один self-hosted шрифт дороже, чем статика с кешем. */}
          <div className="hero-mark mx-auto w-[220px] max-w-[72vw] sm:w-[340px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/registry-mark.svg"
              alt="В реестре отечественного ПО"
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
          </div>

          {/* Headline — fluid scale: ~22 px at 320 → 72 px on desktop.
              7vw подобран так, чтобы «Журналы СанПиН и ХАССП» на телефоне
              помещались в одну строку (≈12.5em в Segoe UI при tracking
              -0.02em: 360px → 25px → 315px из 328); нижняя граница 22px —
              ради 320px. nowrap не ставим — при более широком системном
              шрифте перенос лучше обрезки. */}
          <h1 className="hero-title mx-auto mt-3 max-w-[920px] text-[clamp(1.375rem,7vw,4.5rem)] font-semibold leading-[1.05] tracking-[-0.02em] text-[#0b1024] sm:mt-8">
            Электронные журналы{" "}
            <span className="relative inline-block">
              <span className="relative z-10">СанПиН и ХАССП</span>
              <span
                aria-hidden="true"
                className="absolute inset-x-0 bottom-[0.08em] -z-0 h-[0.28em] bg-[#5566f6]/15"
              />
            </span>
          </h1>

          {/* Subhead — все четыре рычага уравнения ценности: результат
              (проверка без штрафов), вероятность (реестр ПО, СанПиН —
              бейджи рядом), время (5 минут), усилия (шаблоны, Telegram,
              PDF в один клик). */}
          {/* Вместо абзаца — четыре пункта, появляющиеся по очереди.
              Абзац читали через строчку: человек на первом экране не
              читает, а сканирует. Анимация на чистом CSS тем же
              keyframe'ом, что и остальной hero, — клиентский компонент
              ради четырёх строк не нужен, и `prefers-reduced-motion`
              уже обработан общими правилами. */}
          {/* Список по центру как блок (`w-fit`), а строки внутри — от
              левого края: так галочки стоят в одну колонку, а не
              «лесенкой», как при центрировании каждой строки. */}
          <ul className="mx-auto mt-5 flex w-fit max-w-full flex-col items-start gap-1.5 text-left sm:mt-7 sm:gap-2">
            {HERO_POINTS.map((point, index) => (
              <li
                key={point}
                // 14px на телефоне: самая длинная строка с жирными
                // словами — 282px, а на 360px под текст остаётся 296.
                // При 15px она уже не влезала и уходила на две строки.
                className="hero-point flex items-center gap-2.5 text-[14px] leading-snug text-[#3c4053] sm:text-[16px]"
                style={{ animationDelay: `${250 + index * 150}ms` }}
              >
                <span className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-full bg-[#eef1ff] text-[#5566f6]">
                  <Check className="size-3" strokeWidth={3} />
                </span>
                <span>{emphasize(point)}</span>
              </li>
            ))}
          </ul>

          {/* Цены компактной рамкой — до формы, а не через два экрана:
              «сколько это стоит» человек спрашивает раньше, чем «как это
              работает». Числа из констант, чтобы витрина не разошлась с
              тарифом. */}
          {/* Кликается целиком и уводит к разделу с тарифами: человек,
              который вчитался в цены на первом экране, хочет подробностей
              именно здесь, а не идёт искать их в меню. */}
          <AnchorScrollLink
            href="#pricing"
            ariaLabel="Перейти к тарифам"
            className="group mx-auto mt-5 block max-w-[480px] rounded-2xl border border-[#dcdfed] sm:mt-6 bg-white/80 px-5 py-4 text-left backdrop-blur transition-all hover:-translate-y-0.5 hover:border-[#5566f6]/45 hover:bg-white hover:shadow-[0_16px_40px_-24px_rgba(85,102,246,0.45)]"
          >
            <dl className="space-y-2 text-[14px]">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[#6f7282]">До {FREE_MAX_USERS} сотрудников</dt>
                <dd className="font-semibold text-[#0b1024]">бесплатно</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 border-t border-[#eef0f6] pt-2">
                <dt className="text-[#6f7282]">
                  До {SUBSCRIPTION_MAX_USERS} сотрудников
                </dt>
                <dd className="font-semibold tabular-nums text-[#0b1024]">
                  {monthly.priceRub.toLocaleString("ru-RU")} ₽/мес
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 border-t border-[#eef0f6] pt-2">
                <dt className="text-[#6f7282]">Далее 1 сотрудник</dt>
                <dd className="font-semibold tabular-nums text-[#0b1024]">
                  {EXTRA_USER_PRICE_RUB} ₽/мес
                </dd>
              </div>
            </dl>
            <div className="mt-2.5 flex items-center gap-1 border-t border-[#eef0f6] pt-2.5 text-[12.5px] font-medium text-[#3848c7]">
              Что входит в тарифы
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </div>
          </AnchorScrollLink>

          {/* Single big CTA — для залогиненного «Открыть кабинет»,
              для анонимного — «Начать бесплатно» (регистрация) */}
          <div className="hero-cta mt-6 flex flex-col items-center gap-3 sm:mt-10">
            {isAuthed ? (
              <>
                <Link
                  href={homeHref}
                  className="group inline-flex h-12 items-center gap-2 rounded-2xl bg-[#5566f6] px-6 text-[15px] font-semibold text-white shadow-[0_20px_50px_-20px_rgba(85,102,246,0.55)] transition-all hover:-translate-y-0.5 hover:bg-[#4a5bf0] hover:shadow-[0_24px_55px_-18px_rgba(85,102,246,0.65)] sm:h-[56px] sm:px-8 sm:text-[16px]"
                >
                  Открыть кабинет
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                </Link>
                <div className="text-[12px] text-[#9b9fb3]">
                  Залогинены как {session?.user?.name ?? ""}
                </div>
              </>
            ) : (
              <>
                {/* Почта спрашивается прямо здесь: так первый шаг —
                    одно поле, а не переход на отдельную страницу. */}
                <HeroEmailStart
                  place="hero"
                  layout="stack"
                  buttonLabel="Попробовать бесплатно"
                  showLoginLink={false}
                />
                {/* Гарантия — прямо в первом экране: снимать риск нужно
                    там же, где просим действие, а не через два экрана. */}
                <div className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[#116b2a]">
                  <ShieldCheck className="size-3.5" />
                  Гарантия возврата: 14 дней после оплаты.
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* QR-РОЛИК — сразу после героя и отдельной секцией верхнего уровня:
          LandingMotion даёт ей data-inview, иначе stagger-правило
          globals.css спрятало бы детей. Раньше здесь был блок «Три
          экрана» с макетом журнала уборки, который не совпадал с настоящим. */}
      <section id="qr" className="mx-auto max-w-[1200px] scroll-mt-[72px] px-4 pb-20 sm:scroll-mt-24 sm:px-6">
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
                QR-код на оборудовании
              </div>
              <h2 className="text-[clamp(1.625rem,2.4vw+1rem,2.5rem)] font-semibold leading-[1.1] tracking-[-0.02em]">
                Отсканировал — и запись уже в журнале
              </h2>
              <p className="mt-3 text-[15px] leading-[1.6] text-white/75 sm:text-[16px]">
                Наклейка висит на холодильнике, у термометра в раздевалке, на
                УФ-лампе, на фритюрнице. Сотрудник сканирует её камерой
                телефона, вводит PIN и значение — строка встаёт в журнал по
                форме СанПиН. Без приложения и пароля. Пропустили — ответственный
                узнает.
              </p>
            </div>
            <div className="mt-7 sm:mt-9">
              <QrPlayer qr={qrMatrix} today={sceneToday} />
            </div>
          </div>
        </div>
      </section>

      {/* ЗАПОЛНЯЕТСЯ САМО — hero показывает поверхности продукта, но не
          показывает главного: часть записей появляется без человека.
          Один компактный блок, три шага слева направо: датчик → Wi-Fi в
          WeSetup → строка журнала; сканер на приёмке — подписью внизу. */}
      <section className="mx-auto max-w-[1200px] px-4 sm:px-6 pb-20">
        <div className="mb-8 max-w-[720px]">
          <div className="mb-3 inline-flex items-center gap-2 text-[12px] uppercase tracking-[0.18em] text-[#5566f6]">
            <Wifi className="size-4" />
            Автоматизация
          </div>
          <h2 className="text-[clamp(1.625rem,2.2vw+1rem,2.25rem)] font-semibold leading-tight tracking-[-0.02em]">
            Температура пишется сама
          </h2>
          <p className="mt-3 text-[15px] text-[#6f7282]">
            Датчик на холодильнике и сканер на приёмке заполняют журналы
            без людей — повару остаётся только то, что нельзя измерить
            прибором.
          </p>
        </div>
        <AutomationScene />
      </section>

      {/* FEATURES */}
      <section className="mx-auto max-w-[1200px] px-4 sm:px-6 py-20">
        <div className="mb-12 max-w-[720px]">
          <div className="mb-3 text-[12px] uppercase tracking-[0.18em] text-[#5566f6]">
            Что внутри
          </div>
          <h2 className="text-[clamp(1.625rem,2.2vw+1rem,2.25rem)] font-semibold leading-tight tracking-[-0.02em]">
            Всё, что нужно, чтобы журналы действительно вели — а не «для галочки»
          </h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <Link
              key={f.title}
              href={`/features/${f.slug}`}
              className="group flex flex-col rounded-2xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] transition-all hover:-translate-y-0.5 hover:border-[#5566f6]/40 hover:shadow-[0_14px_32px_-16px_rgba(85,102,246,0.28)]"
            >
              <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6] transition-transform group-hover:scale-105">
                <f.icon className="size-6" />
              </div>
              <div className="text-[16px] font-semibold tracking-[-0.01em] text-[#0b1024] group-hover:text-[#3848c7]">
                {f.title}
              </div>
              <p className="mt-2 flex-1 text-[13px] leading-[1.55] text-[#6f7282]">
                {f.text}
              </p>
              <span className="mt-4 inline-flex items-center gap-1 text-[12px] font-medium text-[#3848c7] opacity-0 transition-opacity group-hover:opacity-100">
                Подробнее
                <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* C9 — interactive demo journal: позволяет посетителю «потрогать»
          форму без регистрации. Снимает страх «слишком сложно». */}
      <section className="mx-auto max-w-[1200px] px-4 sm:px-6 pb-20">
        <div className="mb-8 max-w-[640px]">
          <div className="mb-3 inline-flex items-center gap-2 text-[12px] uppercase tracking-[0.18em] text-[#5566f6]">
            <Wand2 className="size-4" />
            Попробуйте сами
          </div>
          <h2 className="text-[clamp(1.625rem,2.2vw+1rem,2.25rem)] font-semibold leading-tight tracking-[-0.02em]">
            Заполните журнал прямо здесь — без регистрации
          </h2>
          <p className="mt-3 text-[15px] text-[#6f7282]">
            Пять самых частых журналов с настоящими полями. Переключите
            вкладку, заполните и сохраните — а рядом скачайте
            заполненный образец этого же бланка в PDF или Word.
          </p>
        </div>
        <DemoJournalWidget />

        {/* Галерея образцов: все журналы каталога с превью бланка и
            кнопками скачивания. Демо-виджет выше даёт «потрогать
            форму», здесь — посмотреть готовый документ. */}
        <div className="mt-6">
          <SampleGallery items={sampleGalleryItems} />
        </div>
      </section>

      {/* TRIAL BANNER */}
      <section className="mx-auto max-w-[1200px] px-4 sm:px-6 pb-20">
        <div className="relative overflow-hidden rounded-3xl bg-[#0b1024] px-5 py-10 text-white sm:px-8 sm:py-14 md:px-16">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -top-24 right-0 size-[400px] rounded-full bg-[#7cf5c0] opacity-20 blur-[120px]" />
            <div className="absolute -bottom-24 -left-10 size-[420px] rounded-full bg-[#5566f6] opacity-30 blur-[120px]" />
          </div>
          <div className="relative z-10 flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
            <div className="max-w-[560px]">
              <h3 className="text-[clamp(1.5rem,2vw+1rem,2rem)] font-semibold leading-tight tracking-[-0.02em]">
                Бесплатно навсегда. Без карты.
              </h3>
              <p className="mt-3 text-[15px] text-white/70">
                Создайте организацию за 10 минут и начните вести
                журналы прямо сегодня. Платите, только если нужно больше
                рабочих мест или автоматизация.
              </p>
            </div>
            {/* Та же форма в одно поле, что и в hero: ссылка на
                /register была лишним переходом на самом мотивированном
                участке страницы. */}
            {isAuthed ? (
              <Link
                href={homeHref}
                className="inline-flex h-12 items-center gap-2 rounded-2xl bg-white px-6 text-[15px] font-medium text-[#0b1024] transition-colors hover:bg-white/90"
              >
                Открыть кабинет
                <ArrowRight className="size-4 text-[#5566f6]" />
              </Link>
            ) : (
              <div className="w-full md:max-w-[520px]">
                <HeroEmailStart
                  tone="dark"
                  place="banner"
                  buttonLabel="Начать бесплатно"
                  showLoginLink={false}
                />
              </div>
            )}
          </div>
        </div>
      </section>

      {/* JOURNALS CATALOG */}
      <section className="mx-auto max-w-[1200px] px-4 sm:px-6 pb-20">
        <div className="mb-10 flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
          <div className="max-w-[640px]">
            <div className="mb-3 text-[12px] uppercase tracking-[0.18em] text-[#5566f6]">
              35 журналов
            </div>
            <h2 className="text-[clamp(1.625rem,2.2vw+1rem,2.25rem)] font-semibold leading-tight tracking-[-0.02em]">
              Какие журналы уже внутри
            </h2>
            <p className="mt-4 text-[15px] text-[#6f7282]">
              Ежедневные санитарные журналы и полный ХАССП: аудиты, обучение,
              поверки, прослеживаемость, обслуживание оборудования, жалобы,
              СИЗ. Все журналы — бесплатно, без ограничений по времени.
            </p>
          </div>
          <Link
            href="/journals-info"
            className="inline-flex h-11 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
          >
            Смотреть весь список
            <ArrowRight className="size-4 text-[#5566f6]" />
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {JOURNAL_PREVIEW.map((j, idx) => (
            <Link
              key={j.code}
              href={`/journals-info/${j.code}`}
              className="group flex w-full min-w-0 items-center gap-3 rounded-2xl border border-[#ececf4] bg-white px-4 py-3 text-[14px] font-medium text-[#0b1024] shadow-[0_0_0_1px_rgba(240,240,250,0.45)] transition-all hover:-translate-y-0.5 hover:border-[#5566f6]/40 hover:shadow-[0_12px_28px_-16px_rgba(85,102,246,0.22)]"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#f5f6ff] text-[12px] font-semibold text-[#5566f6]">
                {String(idx + 1).padStart(2, "0")}
              </span>
              <span className="min-w-0 flex-1 leading-snug group-hover:text-[#3848c7]">
                {j.name}
              </span>
              <ArrowRight className="size-4 shrink-0 text-[#5566f6] opacity-0 transition-opacity group-hover:opacity-100" />
            </Link>
          ))}
        </div>
      </section>

      {/* PRICING */}
      <section
        id="pricing"
        className="mx-auto max-w-[1200px] scroll-mt-[72px] px-4 pb-20 sm:scroll-mt-24 sm:px-6"
      >
        <div className="mb-10 max-w-[720px]">
          <div className="mb-3 inline-flex items-center gap-2 text-[12px] uppercase tracking-[0.18em] text-[#5566f6]">
            <Gift className="size-4" />
            Тарифы
          </div>
          <h2 className="text-[clamp(1.625rem,2.2vw+1rem,2.25rem)] font-semibold leading-tight tracking-[-0.02em]">
            Все журналы бесплатно. Платите за автоматизацию.
          </h2>
          <p className="mt-4 text-[15px] text-[#6f7282]">
            Подписка единая — {formatRub(monthly.priceRub)}/мес. Пакеты отличаются только
            набором оборудования и услугами: приехать, подключить
            датчики к холодильникам, настроить профили и обучить смену.
            Всё железо — разовая покупка.
          </p>
        </div>

        {/* Три карточки одной высоты. Длинные описания убраны: в ряду
            тарифов человек сравнивает цену и три отличия, а не читает
            абзацы. Подписка перечисляет только то, чего нет в
            бесплатном, — иначе половина списка дублируется. */}
        <EquipmentPricing
          subscriptionMonthly={monthly.priceRub}
          hardwareFromRub={hardwareFromRub}
        >
          <PlanCard
            kind="free"
            name="Бесплатный"
            from="0 ₽"
            period="навсегда"
            points={[
              `До ${FREE_MAX_USERS} сотрудников`,
              "Все 35 журналов СанПиН и ХАССП",
              "PDF для проверок, без карты",
            ]}
            ctaLabel={viewerOnFreePlan ? "Текущий" : "Начать бесплатно"}
            ctaHref="#start"
            ctaDisabled={viewerOnFreePlan}
            note={FREE_PLAN_NOTE}
          />

          <PlanCard
            kind="team"
            name={monthly.title}
            from={formatRub(monthly.priceRub)}
            period="в месяц"
            pointsIntro="Всё из Бесплатного, плюс:"
            points={[
              `До ${SUBSCRIPTION_MAX_USERS} сотрудников`,
              "Свои IoT-датчики и автозаполнение",
              "Приоритетная поддержка в Telegram",
            ]}
            ctaLabel="Оплатить картой"
            ctaHref="/order?plan=monthly"
            highlighted
            badge="Популярный"
          />
        </EquipmentPricing>
        {/* Сверх лимита тарифа — фиксированная доплата за сотрудника;
            места сверх лимита оформляются через поддержку, поэтому рядом
            кнопка связи. Промолчать нельзя — человек оплатит и упрётся
            в лимит. */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3">
          <span className="text-[13.5px] text-[#3c4053]">{LARGE_TEAM_NOTE}</span>
          <a
            href="https://t.me/wesetupbot"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
          >
            Связаться с поддержкой
          </a>
        </div>
        <div className="mt-4 text-center text-[13px] text-[#9b9fb3]">
          Подписка оплачивается помесячно. Железо — один раз.
        </div>

        {/* ГАРАНТИЯ — один светлый блок во всю ширину. Раньше здесь
            стояли тёмная карточка и список бонусов с зачёркнутыми
            ценами: «отдельно это стоило бы 49 000» считывалось как
            рекламный приём, а не как факт, и уводило внимание от
            единственного, что тут важно, — что деньги можно вернуть. */}
        <div className="mt-14 overflow-hidden rounded-3xl border border-[#5566f6]/20 bg-gradient-to-br from-[#f5f6ff] to-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-9">
          <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:items-center">
            <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-start">
              <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-[#5566f6] text-white shadow-[0_16px_40px_-16px_rgba(85,102,246,0.65)]">
                <RotateCcw className="size-8" />
              </span>
              <div className="min-w-0">
                <div className="text-[clamp(1.375rem,1.4vw+1rem,1.75rem)] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]">
                  Не понравится — вернём деньги
                </div>
                <p className="mt-3 max-w-[520px] text-[15px] leading-[1.65] text-[#3c4053]">
                  Автоматический возврат всей суммы в течение 14 дней
                  после оформления. Без вопросов и удержаний.
                </p>
                <Link
                  href="/oferta"
                  className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-[#3848c7] underline-offset-4 hover:underline"
                >
                  Условия в договоре-оферте
                  <ArrowRight className="size-3.5" />
                </Link>
              </div>
            </div>

            {/* Что входит — чипами, без цен. Список нужен, чтобы было
                видно объём, а не чтобы считать «экономию». */}
            <div className="lg:border-l lg:border-[#dcdfed] lg:pl-8">
              <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#9b9fb3]">
                Всё включено
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {INCLUDED_CHIPS.map((chip) => (
                  <span
                    key={chip.label}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[#ececf4] bg-white px-3 py-1.5 text-[13px] font-medium text-[#3c4053]"
                  >
                    <chip.icon className="size-3.5 text-[#5566f6]" />
                    {chip.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* C10 — синтетическое «видео»: auto-playing цикличная анимация
          планшета с заполнением журнала. Замена реальной съёмки повара
          на кухне до тех пор, пока не появится исходник. */}
      <section className="mx-auto max-w-[1200px] px-4 sm:px-6 pb-20">
        <div className="grid items-center gap-10 md:grid-cols-2">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 text-[12px] uppercase tracking-[0.18em] text-[#5566f6]">
              <Smartphone className="size-4" />
              30 секунд на смену
            </div>
            <h2 className="text-[clamp(1.625rem,2.2vw+1rem,2.25rem)] font-semibold leading-tight tracking-[-0.02em]">
              Так выглядит заполнение журнала на планшете
            </h2>
            <p className="mt-4 text-[15px] leading-[1.6] text-[#6f7282]">
              Повар приходит на смену, открывает планшет на кухне, выбирает
              журнал, вписывает значение, нажимает «Сохранить». Запись
              автоматически подписывается логином сотрудника и попадает в
              PDF для проверки. Никаких бумажек, никаких «забыл расписаться».
            </p>
            <ul className="mt-5 space-y-2 text-[14px] text-[#3c4053]">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                <span>
                  Автоматическая отметка «в норме / отклонение» по СанПиН
                  диапазону
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                <span>
                  Время заполнения подставляется само — не переписать задним
                  числом
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                <span>
                  Автозаполнение «как вчера» для постоянных значений
                </span>
              </li>
            </ul>
          </div>
          <JournalAutoplayVideo />
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-[1200px] px-4 sm:px-6 pb-20">
        <div className="mb-10 max-w-[640px]">
          <div className="mb-3 inline-flex items-center gap-2 text-[12px] uppercase tracking-[0.18em] text-[#5566f6]">
            <HelpCircle className="size-4" />
            Вопросы и ответы
          </div>
          <h2 className="text-[clamp(1.625rem,2.2vw+1rem,2.25rem)] font-semibold leading-tight tracking-[-0.02em]">
            Быстрая справка перед регистрацией
          </h2>
        </div>
        <div className="divide-y divide-[#ececf4] overflow-hidden rounded-2xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          {FAQ.map((item) => (
            <details key={item.q} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-5 text-[16px] font-medium text-[#0b1024] hover:bg-[#fafbff]">
                <span>{item.q}</span>
                <span className="flex size-7 items-center justify-center rounded-full bg-[#f5f6ff] text-[#5566f6] transition-transform group-open:rotate-45">
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
              <div className="px-5 pb-5 text-[14px] leading-[1.6] text-[#6f7282]">
                {item.a}
              </div>
            </details>
          ))}
        </div>
      </section>

      {/* ПОДХОДИТ ДЛЯ — было рядом чипов в герое. Слова «Рестораны,
          Кафе, Пекарни» говорили, кому продают, но не говорили, что у
          человека меняется; карточки «было / стало» отвечают именно на
          это. Секция вынесена из героя: карусель на первом экране
          отодвигала бы кнопку регистрации. */}
      {/* Секция во всю ширину экрана: карусель должна доходить до краёв,
          чтобы боковые карточки уходили за границу кадра — так видно,
          что ряд продолжается. Заголовок при этом остаётся в общей
          колонке 1200px, иначе он оторвётся от остального лендинга. */}
      <section className="pb-20">
        <div className="mx-auto mb-10 max-w-[1200px] px-4 sm:px-6">
          <div className="mb-3 inline-flex items-center gap-2 text-[12px] uppercase tracking-[0.18em] text-[#5566f6]">
            <Store className="size-4" />
            Подходит для
          </div>
          <h2 className="text-[clamp(1.625rem,2.2vw+1rem,2.25rem)] font-semibold leading-tight tracking-[-0.02em]">
            Кухня любого размера — от одной точки до сети
          </h2>
          <p className="mt-3 text-[15px] text-[#6f7282]">
            Найдите своё заведение и посмотрите, что меняется в первую
            неделю после перехода с бумаги.
          </p>
        </div>
        <AudienceCarousel />
      </section>

      <TestimonialsCarousel reviews={publicReviews} />

      {/* КОМУ ПОДХОДИТ — полный список сфер/типов бизнеса со ссылками на
          посадочные /dlya-*. Стоит под каруселью «Подходит для»: та
          показывает «было/стало», а эта — навигацию по всем нишам. */}
      <IndustriesGrid />

      {/* FINAL CTA — акцент на QR: три шага и золотая наклейка (золото
          в дизайн-системе — только QR, одно на экран). id="start" — сюда
          ведут «Начать бесплатно» из тарифов. */}
      <section
        id="start"
        className="mx-auto max-w-[1200px] scroll-mt-[72px] px-4 pb-20 sm:scroll-mt-24 sm:px-6"
      >
        <div className="overflow-hidden rounded-3xl border border-[#ececf4] bg-[#f5f6ff] p-6 sm:p-10 md:p-14">
          <div className="flex flex-col gap-10 lg:flex-row lg:items-center lg:gap-14">
            <div className="min-w-0 flex-1">
              <h3 className="text-[clamp(1.5rem,2vw+1rem,2.25rem)] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]">
                Повесьте QR — журналы будут вестись у оборудования
              </h3>
              <p className="mt-3 max-w-[520px] text-[15px] leading-[1.6] text-[#3c4053]">
                Бесплатный тариф — без срока и без карты. Наклейки печатаются
                из кабинета, сотрудникам не нужно ничего устанавливать.
              </p>
              <ol className="mt-7 flex flex-col gap-3 sm:flex-row sm:gap-3">
                {QR_START_STEPS.map((step, index) => (
                  <li key={step.title} className="flex flex-1 items-start gap-3 rounded-2xl border border-[#ececf4] bg-white p-4 sm:flex-col sm:gap-3">
                    <span className="relative flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
                      <step.icon className="size-5" />
                      <span className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-[#5566f6] text-[11px] font-semibold text-white tabular-nums">
                        {index + 1}
                      </span>
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[15px] font-semibold text-[#0b1024]">{step.title}</span>
                      <span className="mt-1 block text-[13.5px] leading-[1.5] text-[#6f7282]">{step.text}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <div className="mt-7 flex flex-wrap gap-3">
                {isAuthed ? (
                  <Link
                    href={homeHref}
                    className="inline-flex h-12 items-center gap-2 rounded-2xl bg-[#5566f6] px-6 text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors hover:bg-[#4a5bf0]"
                  >
                    Открыть кабинет
                    <ArrowRight className="size-4" />
                  </Link>
                ) : (
                  <>
                    {/* Тот же одношаговый старт, что и в hero — человек
                        дочитал страницу, не надо снова вести его на форму. */}
                    <HeroEmailStart place="final" />
                  </>
                )}
              </div>
            </div>
            {/* Наклейка — как её увидит сотрудник. Код настоящий: ведёт
                к ролику на этой странице. */}
            <div className="mx-auto w-[200px] shrink-0 sm:w-[240px] lg:mx-0">
              <div className="rotate-[-3deg] text-[26px] sm:text-[30px]">
                <QrSticker qr={qrMatrix} />
              </div>
              <p className="mt-5 text-center text-[13px] leading-[1.5] text-[#6f7282]">
                Наведите камеру телефона — так сотрудник открывает журнал.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* BLOG */}
      {latestArticles.length > 0 && (
        <section className="mx-auto max-w-[1200px] px-4 sm:px-6 pb-20">
          <div className="mb-10 flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
            <div className="max-w-[640px]">
              <div className="mb-3 inline-flex items-center gap-2 text-[12px] uppercase tracking-[0.18em] text-[#5566f6]">
                <NotebookText className="size-4" />
                Блог
              </div>
              <h2 className="text-[clamp(1.625rem,2.2vw+1rem,2.25rem)] font-semibold leading-tight tracking-[-0.02em]">
                Как вести журналы и проходить проверки
              </h2>
              <p className="mt-4 text-[15px] text-[#6f7282]">
                Разборы норм, чек-листы и истории клиентов. Короткие тексты —
                читать можно в перерыве между заготовками.
              </p>
            </div>
            <Link
              href="/blog"
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              Все статьи
              <ArrowRight className="size-4 text-[#5566f6]" />
            </Link>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            {latestArticles.map((a) => (
              <Link
                key={a.slug}
                href={`/blog/${a.slug}`}
                className="group flex flex-col rounded-3xl border border-[#ececf4] bg-white p-6 transition-all hover:-translate-y-0.5 hover:border-[#5566f6]/40 hover:shadow-[0_20px_50px_-30px_rgba(85,102,246,0.35)]"
              >
                <div className="flex flex-wrap items-center gap-2 text-[12px] text-[#6f7282]">
                  {a.tags.slice(0, 2).map((t) => (
                    <span
                      key={t}
                      className="rounded-full bg-[#f5f6ff] px-2.5 py-1 text-[#3848c7]"
                    >
                      {t}
                    </span>
                  ))}
                  <span className="ml-auto inline-flex items-center gap-1">
                    <Clock className="size-3.5" /> {a.readMinutes} мин
                  </span>
                </div>
                <h3 className="mt-4 text-[19px] font-semibold leading-snug tracking-[-0.01em] text-[#0b1024] group-hover:text-[#3848c7]">
                  {a.title}
                </h3>
                <p className="mt-3 line-clamp-3 flex-1 text-[14px] leading-[1.6] text-[#6f7282]">
                  {a.excerpt}
                </p>
                <span className="mt-5 inline-flex items-center gap-1 text-[13px] font-medium text-[#3848c7]">
                  Читать
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* FOOTER */}
      <PublicFooter />
    </div>
  );
}

