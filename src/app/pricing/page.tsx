import Link from "next/link";
import { redirect } from "next/navigation";
import { isMobileAppRequest, MOBILE_APP_HOME } from "@/lib/mobile-app-payments";
import { ArrowRight, Check, Wrench } from "lucide-react";
import { RoiCalculator } from "@/components/landing/roi-calculator";
import { PublicHeader, PublicFooter } from "@/components/public/public-chrome";
import {
  readTariffs,
  fallbackTariffs,
  formatRub,
  TARIFF_MONTHLY,
  TARIFF_BUNDLE,
} from "@/lib/tariffs";
import {
  DEFAULT_OG_IMAGES,
  DEFAULT_TWITTER_CARD,
  DEFAULT_TWITTER_IMAGES,
} from "@/lib/meta-defaults";
import {
  EXTRA_USER_PRICE_RUB,
  FREE_SEATS_LABEL,
  FREE_TIER_SHORT,
  SUBSCRIPTION_MAX_USERS,
  SUBSCRIPTION_SEATS_LABEL,
  employeesGenitiveLabel,
} from "@/lib/plan-catalog";
import { JOURNALS_TOTAL_LABEL } from "@/lib/journal-catalog";
import { PromoPrice } from "@/components/pricing/promo-price";
import { getDisplayOffer } from "@/lib/promo/offer";
import { applyPromotion, type PriceWithPromotion } from "@/lib/promo/promotions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Числа в описании — из констант тарифа (FREE_MAX_USERS, SUBSCRIPTION_MAX_USERS):
// при смене тарифа метаданные меняются вместе с витриной.
const PRICING_DESCRIPTION = `Сколько стоит WeSetup: ${FREE_TIER_SHORT.toLowerCase()}, одна подписка на команду ${SUBSCRIPTION_SEATS_LABEL}, доплата за каждого сверх ${SUBSCRIPTION_MAX_USERS} и пакеты с оборудованием. Калькулятор экономии.`;

export const metadata = {
  title: "Цены на электронные журналы СанПиН и ХАССП",
  description: PRICING_DESCRIPTION,
  alternates: { canonical: "https://wesetup.ru/pricing" },
  openGraph: {
    type: "website",
    locale: "ru_RU",
    siteName: "WeSetup",
    url: "https://wesetup.ru/pricing",
    title: "Цены на электронные журналы СанПиН и ХАССП",
    description: PRICING_DESCRIPTION,
    images: DEFAULT_OG_IMAGES,
  },
  twitter: {
    card: DEFAULT_TWITTER_CARD,
    title: "Цены на электронные журналы СанПиН и ХАССП",
    images: DEFAULT_TWITTER_IMAGES,
  },
};

/**
 * Публичная страница тарифов.
 *
 * Цены берутся из БД (`PlatformTariff`) — те же, что на лендинге и в
 * кнопках оплаты. Модель одна на весь сайт (`quoteSubscription`):
 * 1 сотрудник бесплатно, до 10 — одна подписка на команду,
 * дальше доплата за каждого (числа — из констант plan-catalog).
 */
export default async function PricingPage() {
  // Витрина с кнопками оплаты — не для приложения (правила магазинов).
  if (await isMobileAppRequest()) redirect(MOBILE_APP_HOME);
  const tariffs = await readTariffs().catch(() => fallbackTariffs());
  const monthly =
    tariffs.find((t) => t.key === TARIFF_MONTHLY) ?? fallbackTariffs()[0];
  const bundle = tariffs.find((t) => t.key === TARIFF_BUNDLE) ?? null;
  // Действующая акция: зачёркнутая цена в тексте, карточках и калькуляторе.
  const offer = await getDisplayOffer(monthly);

  return (
    <div className="min-h-screen bg-white text-[#0b1024]">
      <PublicHeader />
      <main className="mx-auto max-w-[1000px] space-y-8 px-4 py-12 sm:px-6">
        <div>
          <h1 className="text-[clamp(2rem,2vw+1.5rem,2.75rem)] font-semibold tracking-[-0.02em]">
            Сколько стоит WeSetup
          </h1>
          <p className="mt-3 max-w-[640px] text-[16px] leading-relaxed text-[#3c4053]">
            Все {JOURNALS_TOTAL_LABEL} доступны бесплатно — {FREE_SEATS_LABEL}.
            Команда {SUBSCRIPTION_SEATS_LABEL} — одна подписка{" "}
            <PromoPrice price={offer} size="text" tone="inherit" suffix="/мес" showBadge={false} /> на всех, не за человека; каждый
            сотрудник сверх {SUBSCRIPTION_MAX_USERS} —{" "}
            {`+${EXTRA_USER_PRICE_RUB} ₽/мес`}. Оборудование — разовая
            покупка, без скрытых платежей.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          <PlanCard
            name="Бесплатный"
            price="0 ₽"
            period="навсегда"
            description="Для заведения с небольшой сменой."
            points={[
              FREE_SEATS_LABEL,
              `Все ${JOURNALS_TOTAL_LABEL} СанПиН и ХАССП`,
              "Telegram-бот с пошаговым заполнением",
              "PDF для проверок, без привязки карты",
            ]}
            ctaLabel="Начать бесплатно"
            ctaHref="/register"
          />

          <PlanCard
            name={monthly.title}
            price={formatRub(monthly.priceRub)}
            offer={offer}
            period={`за ${monthly.periodDays} дней`}
            description="Одна цена на всю команду. Если датчики и планшеты уже есть — подключаем их."
            points={[
              `До ${employeesGenitiveLabel(SUBSCRIPTION_MAX_USERS)}, далее +${EXTRA_USER_PRICE_RUB} ₽/мес за каждого`,
              "Подключение своих IoT-датчиков",
              "Автозаполнение температур и гигиены",
              "Приоритетная поддержка в Telegram",
            ]}
            ctaLabel="Оплатить картой"
            ctaHref="/order?plan=monthly"
            highlighted
          />

          <PlanCard
            name={bundle?.title ?? "Подписка + оборудование"}
            price={formatRub(bundle?.priceRub ?? monthly.priceRub)}
            offer={applyPromotion(bundle?.priceRub ?? monthly.priceRub, offer.promotion)}
            period="в месяц + железо"
            icon
            description="Та же подписка плюс датчики, планшет и выездной монтаж. Состав собирается в калькуляторе на главной."
            points={[
              "Всё из тарифа «Подписка»",
              "Датчики температуры и термогигрометры",
              "Планшет на кухню и NFC-брелоки",
              "Выезд инженера, настройка и обучение смены",
            ]}
            ctaLabel="Собрать комплект"
            ctaHref="/#pricing"
          />
        </div>

        <p className="text-center text-[13px] text-[#9b9fb3]">
          Оплата картой через сервис «Робокасса». Возврат за неиспользованный
          период — по заявлению на support@wesetup.ru, условия описаны в{" "}
          <Link href="/oferta" className="text-[#3848c7]">
            договоре-оферте
          </Link>
          .
        </p>

        <RoiCalculator subscriptionMonthly={monthly.priceRub} promotion={offer.promotion} />

        <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-8">
          <h2 className="text-[18px] font-semibold tracking-[-0.01em]">
            Что внутри после регистрации
          </h2>
          <p className="mt-2 max-w-[640px] text-[14px] leading-relaxed text-[#3c4053]">
            {JOURNALS_TOTAL_LABEL} СанПиН/ХАССП — от гигиены сотрудников и
            контроля холодильников до бракеража и журнала уборок.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/journals-info"
              className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              Каталог журналов →
            </Link>
            <Link
              href="/features"
              className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              Все возможности →
            </Link>
          </div>
        </section>

        <section className="rounded-3xl border border-[#ececf4] bg-[#0b1024] p-8 text-white shadow-[0_20px_60px_-30px_rgba(11,16,36,0.55)] md:p-10">
          <h2 className="text-[24px] font-semibold tracking-[-0.02em]">
            Попробуйте бесплатно
          </h2>
          <p className="mt-2 max-w-[480px] text-[15px] leading-relaxed text-white/70">
            Регистрация занимает 2 минуты. {FREE_SEATS_LABEL} — бесплатно
            навсегда. Карта не требуется.
          </p>
          <Link
            href="/register"
            className="mt-6 inline-flex h-12 items-center gap-2 rounded-2xl bg-white px-6 text-[15px] font-medium text-[#0b1024] transition-colors hover:bg-white/90"
          >
            Зарегистрироваться <ArrowRight className="size-4" />
          </Link>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}

function PlanCard({
  name,
  price,
  period,
  description,
  points,
  ctaLabel,
  ctaHref,
  highlighted,
  icon,
  offer,
}: {
  name: string;
  price: string;
  /** Цена с акцией: идёт акция — зачёркнутая старая, новая и плашка. */
  offer?: PriceWithPromotion;
  period: string;
  description: string;
  points: string[];
  ctaLabel: string;
  ctaHref: string;
  highlighted?: boolean;
  icon?: boolean;
}) {
  return (
    <div
      className={
        "flex flex-col rounded-3xl border bg-white p-6 transition-shadow md:p-7 " +
        (highlighted
          ? "border-[#5566f6]/40 shadow-[0_16px_40px_-24px_rgba(85,102,246,0.35)]"
          : "border-[#ececf4] shadow-[0_0_0_1px_rgba(240,240,250,0.45)]")
      }
    >
      <div className="flex items-center gap-3">
        {icon ? (
          <span className="flex size-10 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
            <Wrench className="size-5" />
          </span>
        ) : null}
        <div className="text-[18px] font-semibold tracking-[-0.01em]">
          {name}
        </div>
      </div>

      {offer?.promotion ? (
        <PromoPrice
          price={offer}
          size="xl"
          layout="stacked"
          className="mt-4"
          suffix={<span className="ml-2 text-[13px] text-[#6f7282]">{period}</span>}
        />
      ) : (
        <div className="mt-4 flex items-baseline gap-2">
          <span className="text-[30px] font-semibold tracking-[-0.02em] tabular-nums">
            {price}
          </span>
          <span className="text-[13px] text-[#6f7282]">{period}</span>
        </div>
      )}

      <p className="mt-3 text-[14px] leading-[1.55] text-[#6f7282]">
        {description}
      </p>

      <ul className="mt-5 flex-1 space-y-2">
        {points.map((point) => (
          <li key={point} className="flex gap-2 text-[14px] text-[#3c4053]">
            <Check className="mt-0.5 size-4 shrink-0 text-[#5566f6]" />
            <span className="leading-[1.5]">{point}</span>
          </li>
        ))}
      </ul>

      <Link
        href={ctaHref}
        className={
          "mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-2xl px-5 text-[14px] font-medium transition-colors " +
          (highlighted
            ? "bg-[#5566f6] text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] hover:bg-[#4a5bf0]"
            : "border border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]")
        }
      >
        {ctaLabel}
        <ArrowRight className="size-4" />
      </Link>
    </div>
  );
}
