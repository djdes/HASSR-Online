"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, ChevronDown, Wrench } from "lucide-react";

import { PricingCalculator } from "@/components/public/pricing-calculator";
import { formatNumber, type Locale } from "@/i18n/locales";
import type { AppliedPromotion } from "@/lib/promo/promotions";

/**
 * Оборудование под тарифом «Премиум» (тарифы 2026-10): доставка уже
 * подключённых к аккаунту датчиков и планшета — возможность «Премиума».
 * Раньше это была третья карточка «+ Оборудование» рядом с тарифами; теперь
 * третья колонка — сам «Премиум», а подбор комплекта — полосой под
 * колонками, калькулятор раскрывается во всю ширину.
 */
export function HardwareStrip({
  premiumMonthlyRub,
  promotion = null,
  hardwareFromRub,
}: {
  /** «Премиум» в месяц (оплата за год) — строка подписки в калькуляторе. */
  premiumMonthlyRub: number;
  promotion?: AppliedPromotion | null;
  /** Самый дешёвый комплект — «от N ₽». */
  hardwareFromRub: number;
}) {
  const t = useTranslations("landingComponents.equipment");
  const locale = useLocale() as Locale;
  const [open, setOpen] = useState(false);
  const benefits = [t("sensorBenefit"), t("tabletBenefit"), t("setupBenefit")];

  return (
    <section data-testid="hardware-strip" className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-7">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
            <Wrench className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">{t("title")}</div>
            <p className="mt-1 max-w-[620px] text-[14px] leading-[1.55] text-[#6f7282]">{t("premiumNote")}</p>
            <ul className="mt-3 grid gap-1.5 text-[14px] text-[#3c4053] sm:grid-cols-3 sm:gap-3">
              {benefits.map((benefit) => (
                <li key={benefit} className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-[#5566f6]" />
                  <span>{benefit}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2 lg:items-end">
          <span className="text-center text-[15px] font-semibold text-[#0b1024] lg:text-right">
            {t("bundlePrice", { price: formatNumber(locale, hardwareFromRub) })}{" "}
            <span className="text-[13px] font-normal text-[#9b9fb3]">{t("oneTime")}</span>
          </span>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="hardware-calculator"
            className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-5 text-[15px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] sm:h-11"
          >
            {open ? t("collapse") : t("choose")}
            <ChevronDown className={`size-4 text-[#5566f6] transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {open ? (
        <div id="hardware-calculator" className="mt-6 border-t border-[#ececf4] pt-6">
          <div className="mb-5 max-w-[560px]">
            <div className="text-[16px] font-semibold tracking-[-0.01em] text-[#0b1024]">{t("calculatorTitle")}</div>
            <p className="mt-1.5 text-[14px] leading-[1.55] text-[#6f7282]">{t("calculatorDescription")}</p>
          </div>
          <PricingCalculator subscriptionMonthly={premiumMonthlyRub} subscriptionPromotion={promotion} paymentDisabled />
        </div>
      ) : null}
    </section>
  );
}
