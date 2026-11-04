import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowRight, BadgeCheck, Check, Download, Phone, Sparkles, Ticket, Wallet, Zap } from "lucide-react";

import { BrandLogo } from "@/components/brand/logo";
import { isMobileAppRequest, MOBILE_APP_HOME } from "@/lib/mobile-app-payments";
import { PAYMENT_METHODS_NOTE, REFUND_NOTE } from "@/lib/payment-copy";
import { CARD_POINTS } from "@/lib/plan-catalog";
import { CARD_PROMO_CODE, cardOrderHref, cardTierPrice, type CardDiscount, type CardTierPrice } from "@/lib/promo/card-offer";
import { readActivePromotion } from "@/lib/promo/offer";
import { readPromoForOffer } from "@/lib/promo/personal-codes";
import { describeDiscount } from "@/lib/promo/rules";
import type { PaidTier } from "@/lib/tariff-plans";
import { readPlanPricing } from "@/lib/tariffs";

import styles from "./vizitka.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Акция по визитке — скидка на сетап",
  description: "Акция по визитке сетап: тарифы «Стандарт» и «Премиум» со скидкой по промокоду.",
  robots: { index: false, follow: false },
};

const rub = (value: number) => `${new Intl.NumberFormat("ru-RU").format(value)} ₽`;

type TariffsT = Awaited<ReturnType<typeof getTranslations<"landingComponents.tariffs">>>;

function points(t: TariffsT, tier: PaidTier): string[] {
  return CARD_POINTS[tier].map((p) => t(`features.${p.key}` as never, (p.values ?? {}) as never) as string);
}

/**
 * Страница акции по визитке: QR на обороте → сюда. Код `VIZITKA10` уже
 * применён — цены «Стандарта» и «Премиума» за год со скидкой, кнопка ведёт
 * на `/order` с кодом в адресе (страница оформления подставит его сама).
 * Код не действует — честные цены без скидки и спокойная пометка.
 */
export default async function VizitkaPromoPage() {
  if (await isMobileAppRequest()) redirect(MOBILE_APP_HOME);

  const [pricing, promotion, promo, t] = await Promise.all([
    readPlanPricing(),
    readActivePromotion().catch((error) => {
      console.error("[promo] vizitka: active promotion read failed", error);
      return null;
    }),
    readPromoForOffer(CARD_PROMO_CODE).catch((error) => {
      console.error("[promo] vizitka: promo read failed", error);
      return null;
    }),
    getTranslations({ locale: "ru", namespace: "landingComponents.tariffs" }),
  ]);
  const discount: CardDiscount | null = promo ? { kind: promo.kind, value: promo.value } : null;
  const active = discount !== null;
  const label = discount ? describeDiscount(discount) : "";
  const standard = cardTierPrice(pricing.rates, "standard", "year", promotion, discount);
  const premium = cardTierPrice(pricing.rates, "premium", "year", promotion, discount);
  const standardMonth = cardTierPrice(pricing.rates, "standard", "month", promotion, discount);
  const premiumMonth = cardTierPrice(pricing.rates, "premium", "month", promotion, discount);
  console.info(`[promo] vizitka page opened code=${CARD_PROMO_CODE} active=${active}`);

  return (
    <div className={styles.page} style={{ fontFamily: "var(--font-sans, Manrope, system-ui, sans-serif)" }}>
      {/* Фон под строкой браузера и при прокрутке за край — тёмный, как страница (Safari берёт цвет у body). */}
      <style>{"html,body{background:#0b1024}"}</style>
      <div className={styles.aurora} aria-hidden="true">
        <div className={styles.blobA} />
        <div className={styles.blobB} />
        <div className={styles.blobC} />
      </div>
      <div className={styles.grid} aria-hidden="true" />

      <header className="mx-auto flex w-full max-w-[1120px] items-center justify-between gap-4 px-4 pt-6 sm:px-6">
        <Link href="/" aria-label="WeSetup — на главную" className="rounded-xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/40">
          <BrandLogo height={26} gradient title="" />
        </Link>
        <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3.5 py-1.5 text-[13px] font-medium text-[#dfe3ff] backdrop-blur">
          <Ticket className="size-4 text-[#a3f7d7]" aria-hidden="true" />
          Акция по визитке
        </span>
      </header>

      <main className="mx-auto w-full max-w-[1120px] px-4 pb-20 sm:px-6">
        {/* ---------- герой ---------- */}
        <section className="pt-14 text-center sm:pt-20">
          <p className={`${styles.rise} inline-flex items-center gap-2 rounded-full bg-[#5566f6]/20 px-4 py-1.5 text-[14px] font-semibold text-[#c9cef0] ring-1 ring-[#8e9bf8]/30`}>
            <Sparkles className="size-4 text-[#cabbff]" aria-hidden="true" />
            Только для тех, кто отсканировал QR с визитки
          </p>
          {active ? (
            <>
              <h1 className={`${styles.rise} ${styles.d1} mt-6 leading-none`}>
                <span className={`${styles.shimmer} block text-[96px] font-extrabold tracking-[-0.05em] sm:text-[168px]`}>{label}</span>
                <span className="mt-3 block text-[28px] font-bold tracking-[-0.02em] sm:text-[44px]">на первую оплату сетап</span>
              </h1>
              <p className={`${styles.rise} ${styles.d2} mx-auto mt-5 max-w-[620px] text-[17px] leading-[1.6] text-[#c9cef0] sm:text-[19px]`}>
                Промокод уже применён. Выберите тариф — скидка сразу в цене, вам остаётся только оплатить.
              </p>
              <div className={`${styles.rise} ${styles.d3} mt-8 flex justify-center`}>
                <div className={`${styles.glowRing} inline-flex items-center gap-3 rounded-2xl bg-[#0b1024]/90 px-5 py-3.5`}>
                  <span className="text-[13px] font-medium text-[#9ea8e8]">Промокод</span>
                  <span className="font-mono text-[20px] font-bold tracking-[0.12em] text-white sm:text-[22px]">{CARD_PROMO_CODE}</span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#a3f7d7]/15 px-2.5 py-1 text-[13px] font-semibold text-[#a3f7d7]">
                    <BadgeCheck className="size-4" aria-hidden="true" />
                    применён
                  </span>
                </div>
              </div>
            </>
          ) : (
            <>
              <h1 className={`${styles.rise} ${styles.d1} mt-6 text-[40px] font-extrabold leading-[1.05] tracking-[-0.03em] sm:text-[64px]`}>
                <span className={styles.shimmer}>Тарифы сетап</span>
              </h1>
              <p className={`${styles.rise} ${styles.d2} mx-auto mt-5 max-w-[620px] text-[17px] leading-[1.6] text-[#c9cef0]`}>
                Акция по визитке сейчас не действует — показываем обычные цены. Если промокод вам обещали, напишите или позвоните нам — поможем.
              </p>
            </>
          )}
        </section>

        {/* ---------- тарифы ---------- */}
        <section aria-label="Тарифы" className="mt-16 grid gap-6 sm:mt-20 lg:grid-cols-2 lg:items-stretch">
          <TierCard
            name="Стандарт"
            lead="Все журналы СанПиН и ХАССП для одной точки"
            price={standard}
            month={standardMonth}
            active={active}
            features={points(t, "standard")}
            featuresTitle={t("includes.free")}
            delayClass={`${styles.rise} ${styles.d2}`}
          />
          <TierCard
            name="Премиум"
            lead="Всё из «Стандарта» и больше: автоввод показаний, оборудование, «Меркурий»"
            price={premium}
            month={premiumMonth}
            active={active}
            features={points(t, "premium")}
            featuresTitle={t("includes.premium")}
            highlighted
            delayClass={`${styles.rise} ${styles.d3}`}
          />
        </section>

        {/* ---------- как это работает ---------- */}
        <section aria-label="Как оплатить" className="mt-16 grid gap-4 sm:grid-cols-3">
          {[
            { icon: BadgeCheck, title: "Скидка уже в цене", text: active ? `Промокод ${CARD_PROMO_CODE} подставится на оплате сам — вводить ничего не нужно.` : "Цены — как на сайте, без скрытых доплат." },
            { icon: Wallet, title: "Оплата за минуту", text: PAYMENT_METHODS_NOTE },
            { icon: Zap, title: "Без риска", text: REFUND_NOTE },
          ].map((step) => (
            <div key={step.title} className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur">
              <span className="flex size-11 items-center justify-center rounded-2xl bg-[#5566f6]/25 text-[#dfe3ff]">
                <step.icon className="size-5" aria-hidden="true" />
              </span>
              <h2 className="mt-4 text-[18px] font-semibold">{step.title}</h2>
              <p className="mt-1.5 text-[15px] leading-[1.55] text-[#c9cef0]">{step.text}</p>
            </div>
          ))}
        </section>

        {/* ---------- контакт ---------- */}
        <section className="mt-16 flex flex-col items-start justify-between gap-6 rounded-3xl border border-white/10 bg-gradient-to-br from-[#5566f6]/20 to-[#7a5cff]/10 p-6 sm:flex-row sm:items-center sm:p-8">
          <div>
            <h2 className="text-[22px] font-semibold tracking-[-0.01em]">Остались вопросы — позвоните</h2>
            <div className="mt-3 flex flex-col gap-1.5 text-[17px] font-semibold tabular-nums sm:flex-row sm:gap-6">
              <a href="tel:+74951096543" className="inline-flex items-center gap-2 rounded-lg hover:text-[#a3f7d7] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/40">
                <Phone className="size-4 text-[#8e9bf8]" aria-hidden="true" />
                +7 (495) 109-65-43
              </a>
              <a href="tel:+79253058077" className="inline-flex items-center gap-2 rounded-lg hover:text-[#a3f7d7] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/40">
                <Phone className="size-4 text-[#8e9bf8]" aria-hidden="true" />
                +7 (925) 305-80-77
              </a>
            </div>
          </div>
          <a
            href="/vizitka/contact.vcf"
            download="wesetup.vcf"
            className="inline-flex h-12 shrink-0 items-center gap-2 rounded-2xl border border-white/20 bg-white/[0.06] px-5 text-[15px] font-semibold transition-colors duration-200 hover:border-[#a3f7d7]/50 hover:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/40"
          >
            <Download className="size-4 text-[#a3f7d7]" aria-hidden="true" />
            Сохранить контакт
          </a>
        </section>

        {active ? (
          <p className="mt-8 text-center text-[13px] leading-[1.6] text-[#9ea8e8]">
            Скидка {label} действует на первую оплату для новых клиентов. Промокод можно ввести и вручную: {CARD_PROMO_CODE}.
          </p>
        ) : null}
      </main>
    </div>
  );
}

function TierCard({
  name,
  lead,
  price,
  month,
  active,
  features,
  featuresTitle,
  highlighted = false,
  delayClass,
}: {
  name: string;
  lead: string;
  price: CardTierPrice;
  month: CardTierPrice;
  active: boolean;
  features: string[];
  featuresTitle: string;
  highlighted?: boolean;
  delayClass: string;
}) {
  const shell = highlighted
    ? `${styles.glowRing} bg-[#0d1330]/95`
    : "border border-white/12 bg-white/[0.04] backdrop-blur";
  return (
    <article className={`${delayClass} relative flex flex-col rounded-[28px] p-6 sm:p-8 ${highlighted ? "order-first lg:order-none" : ""} ${shell}`}>
      {highlighted ? (
        <span className="absolute -top-3.5 left-6 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#5566f6] to-[#7a5cff] px-3 py-1 text-[12.5px] font-bold text-white shadow-[0_10px_30px_-10px_rgba(122,92,255,0.8)]">
          <Sparkles className="size-3.5" aria-hidden="true" />
          Рекомендуем
        </span>
      ) : null}
      <h2 className="text-[26px] font-bold tracking-[-0.02em]">{name}</h2>
      <p className="mt-1 text-[15px] leading-[1.5] text-[#c9cef0]">{lead}</p>

      <div className="mt-6">
        {active && price.savingRub > 0 ? (
          <p className="text-[18px] font-semibold text-[#8e93b8] line-through decoration-[#ff8a8a]/70 decoration-2 tabular-nums">{rub(price.monthlyBaseRub)}</p>
        ) : null}
        <p className="flex items-baseline gap-2 tabular-nums">
          <span className={`text-[48px] font-extrabold leading-none tracking-[-0.03em] sm:text-[56px] ${highlighted ? styles.shimmer : ""}`}>{rub(price.monthlyFinalRub)}</span>
          <span className="text-[16px] font-medium text-[#c9cef0]">в месяц</span>
        </p>
        <p className="mt-2 text-[15px] text-[#c9cef0] tabular-nums">
          При оплате за год — {rub(price.periodFinalRub)}
          {active && price.savingRub > 0 ? <> вместо <span className="line-through">{rub(price.periodBaseRub)}</span></> : null}
        </p>
        {active && price.savingRub > 0 ? (
          <span className={`${styles.pulse} mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#a3f7d7]/15 px-3 py-1 text-[14px] font-semibold text-[#a3f7d7] tabular-nums`}>
            <Check className="size-4" aria-hidden="true" />
            Экономия {rub(price.savingRub)}
          </span>
        ) : null}
      </div>

      <div className="mt-6 flex-1">
        <p className="text-[14px] font-semibold text-[#9ea8e8]">{featuresTitle}</p>
        <ul className="mt-3 flex flex-col gap-2.5">
          {features.map((f) => (
            <li key={f} className="flex items-start gap-2.5 text-[15px] leading-[1.45]">
              <Check className="mt-0.5 size-4 shrink-0 text-[#a3f7d7]" aria-hidden="true" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-8 flex flex-col gap-3">
        <Link
          href={cardOrderHref(price.tier, "year", active)}
          className={`${styles.sheen} inline-flex h-14 items-center justify-center gap-2 rounded-2xl px-6 text-[17px] font-bold text-white transition-[filter,transform] duration-200 hover:brightness-110 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#a3f7d7]/40 ${
            highlighted
              ? "bg-gradient-to-r from-[#5566f6] via-[#6a5cff] to-[#7a5cff] shadow-[0_18px_40px_-14px_rgba(122,92,255,0.85)]"
              : "bg-[#5566f6] shadow-[0_14px_34px_-14px_rgba(85,102,246,0.8)]"
          }`}
        >
          {active ? "Оплатить со скидкой" : "Оплатить"}
          <ArrowRight className="size-5" aria-hidden="true" />
        </Link>
        <Link
          href={cardOrderHref(price.tier, "month", active)}
          className="text-center text-[14px] font-medium text-[#c9cef0] underline-offset-4 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/40"
        >
          или помесячно — {rub(month.periodFinalRub)} в месяц
        </Link>
      </div>
    </article>
  );
}
