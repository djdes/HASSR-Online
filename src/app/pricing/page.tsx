import Link from "next/link";
import { redirect } from "next/navigation";
import { isMobileAppRequest, MOBILE_APP_HOME } from "@/lib/mobile-app-payments";
import { ArrowRight } from "lucide-react";
import { RoiCalculator } from "@/components/landing/roi-calculator";
import { HardwareStrip } from "@/components/landing/hardware-strip";
import { TariffComparison } from "@/components/pricing/tariff-comparison";
import { PublicHeader, PublicFooter } from "@/components/public/public-chrome";
import { readPlanPricing } from "@/lib/tariffs";
import {
  DEFAULT_OG_IMAGES,
  DEFAULT_TWITTER_CARD,
  DEFAULT_TWITTER_IMAGES,
} from "@/lib/meta-defaults";
import { FREE_AFTER_TRIAL_LABEL, FREE_TIER_SHORT, PAID_SEATS_LABEL, PREMIUM_SEATS_LABEL } from "@/lib/plan-catalog";
import { JOURNALS_TOTAL_LABEL } from "@/lib/journal-catalog";
import { PromoPrice } from "@/components/pricing/promo-price";
import { readActivePromotion } from "@/lib/promo/offer";
import { applyPromotion } from "@/lib/promo/promotions";
import { readPpkIndividualPrice } from "@/lib/services/catalog";
import { HARDWARE_BUNDLES, bundleTotal } from "@/lib/hardware-pricing";
import { POINTS_DISCOUNT_FROM, POINTS_DISCOUNT_PERCENT, planMonthlyRub } from "@/lib/tariff-plans";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Числа в описании — из констант тарифов (tariff-plans.ts): при смене
// модели метаданные меняются вместе с витриной. Цены правит ROOT, поэтому
// в статических метаданных их нет.
const PRICING_DESCRIPTION = `Сколько стоит WeSetup: ${FREE_TIER_SHORT} без карты, тарифы «Стандарт» и «Премиум» — помесячно или за год со скидкой, от ${POINTS_DISCOUNT_FROM} точек −${POINTS_DISCOUNT_PERCENT} % на каждую. Оборудование и ППК — индивидуально.`;

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
 * Тарифы 2026-10: «Бесплатный» (14 дней без ограничений, потом 1 сотрудник
 * и 1 журнал), «Стандарт» и «Премиум» — три колонки той же витрины, что на
 * лендинге (`TariffComparison`). Цены — из БД (`PlatformTariff`, правит
 * ROOT), те же, что в кнопках оплаты и на /order.
 */
export default async function PricingPage() {
  // Витрина с кнопками оплаты — не для приложения (правила магазинов).
  if (await isMobileAppRequest()) redirect(MOBILE_APP_HOME);
  const [pricing, promotion, ppkFromRub] = await Promise.all([
    readPlanPricing(),
    readActivePromotion().catch(() => null),
    readPpkIndividualPrice(),
  ]);
  const standardFrom = applyPromotion(planMonthlyRub(pricing.rates, "standard", "year"), promotion);
  const hardwareFromRub = Math.min(...HARDWARE_BUNDLES.map(bundleTotal));

  return (
    <div className="min-h-screen bg-white text-[#0b1024]">
      <PublicHeader />
      <main className="mx-auto max-w-[1100px] space-y-8 px-4 py-12 sm:px-6">
        <div>
          <h1 className="text-[clamp(2rem,2vw+1.5rem,2.75rem)] font-semibold tracking-[-0.02em]">
            Сколько стоит WeSetup
          </h1>
          <p className="mt-3 max-w-[720px] text-[16px] leading-relaxed text-[#3c4053]">
            {FREE_TIER_SHORT} — все {JOURNALS_TOTAL_LABEL}, сотрудники и точки без
            ограничений, карта не нужна. Потом бесплатно остаются{" "}
            {FREE_AFTER_TRIAL_LABEL}, или тариф «Стандарт» — {PAID_SEATS_LABEL}, от{" "}
            <PromoPrice price={standardFrom} size="text" tone="inherit" suffix="/мес" showBadge={false} /> при
            оплате за год. «Премиум» — {PREMIUM_SEATS_LABEL}, фото датчиков, оборудование,
            «Меркурий» и типовой пакет документов.
          </p>
        </div>

        <TariffComparison
          mode="public"
          rates={pricing.rates}
          available={pricing.available}
          promotion={promotion}
          ppkFromRub={ppkFromRub}
          ppkHref="/uslugi#ppk-development"
          startHref="/register"
          showTable
        />

        <HardwareStrip
          premiumMonthlyRub={planMonthlyRub(pricing.rates, "premium", "year")}
          promotion={promotion}
          hardwareFromRub={hardwareFromRub}
        />

        <p className="text-center text-[13px] text-[#9b9fb3]">
          Оплата картой через сервис «Робокасса» или по счёту для юрлица. Возврат за неиспользованный
          период — по заявлению на support@wesetup.ru, условия описаны в{" "}
          <Link href="/oferta" className="text-[#3848c7]">
            договоре-оферте
          </Link>
          .
        </p>

        <RoiCalculator rates={pricing.rates} promotion={promotion} />

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
            Регистрация занимает 2 минуты. {FREE_TIER_SHORT} — все журналы без
            ограничений. Карта не требуется.
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
