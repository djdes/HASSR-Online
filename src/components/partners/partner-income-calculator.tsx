"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Calculator } from "lucide-react";

import { CALCULATOR_MAX_CLIENTS, clampClients, partnerFirstYearIncome, type CalculatorRule } from "@/lib/partners/income-calculator";
import { MAX_POINTS, planPeriodPriceRub, type BillingCycle, type PaidTier, type PlanRates } from "@/lib/tariff-plans";
import { cn } from "@/lib/utils";

/**
 * Калькулятор дохода партнёра (2026-11-01): ставки — из действующей версии
 * правил, цены — из тарифов ROOT, расчёт — `partnerFirstYearIncome`.
 */

const SEGMENT =
  "flex min-h-11 flex-1 items-center justify-center rounded-xl px-3 text-[14px] font-medium transition-colors duration-150";

function formatRub(locale: string, value: number): string {
  return `${Math.round(value).toLocaleString(locale === "en" ? "en-US" : "ru-RU")} ₽`;
}

export function PartnerIncomeCalculator({
  rule,
  rates,
  version,
  hardwarePercent,
  locale,
}: {
  rule: CalculatorRule;
  rates: PlanRates;
  version: number;
  hardwarePercent: number;
  locale: string;
}) {
  const t = useTranslations("publicPartners.calculator");
  const ids = useId();
  const [clientsRaw, setClientsRaw] = useState("10");
  const [tier, setTier] = useState<PaidTier>("standard");
  const [cycle, setCycle] = useState<BillingCycle>("month");
  const [pointsRaw, setPointsRaw] = useState("1");

  const clients = clampClients(clientsRaw);
  const points = Math.min(Math.max(1, Math.floor(Number(pointsRaw)) || 1), MAX_POINTS);
  const periodPriceRub = planPeriodPriceRub(rates, tier, cycle, points);
  const result = partnerFirstYearIncome(rule, { clients, cycle, periodPriceRub });

  const segmented = <T extends string>(value: T, options: Array<[T, string]>, onChange: (next: T) => void, label: string) => (
    <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-2xl border border-[#dcdfed] bg-white p-1">
      {options.map(([option, text]) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(option)}
          className={cn(SEGMENT, value === option ? "bg-[#5566f6] text-white" : "text-[#0b1024] hover:bg-[#f5f6ff]")}
        >
          {text}
        </button>
      ))}
    </div>
  );

  return (
    <section id="calculator" className="scroll-mt-24 rounded-3xl border border-[#ececf4] bg-white p-6 md:p-8" data-partner-calculator>
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
          <Calculator className="size-5" aria-hidden />
        </span>
        <div>
          <h2 className="text-[26px] font-semibold tracking-[-0.02em]">{t("title")}</h2>
          <p className="mt-1 max-w-[640px] text-[15px] leading-[1.6] text-[#3c4053]">{t("lead")}</p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <div>
            <label htmlFor={`${ids}-clients`} className="mb-1.5 block text-[13px] font-medium text-[#6f7282]">{t("clients")}</label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={1}
                max={100}
                value={Math.min(clients, 100)}
                onChange={(event) => setClientsRaw(event.target.value)}
                aria-label={t("clients")}
                className="h-2 flex-1 accent-[#5566f6]"
              />
              <input
                id={`${ids}-clients`}
                inputMode="numeric"
                value={clientsRaw}
                onChange={(event) => setClientsRaw(event.target.value.replace(/\D/g, "").slice(0, 3))}
                onBlur={() => setClientsRaw(String(clients))}
                aria-describedby={`${ids}-clients-max`}
                className="h-11 w-20 rounded-xl border border-[#dcdfed] px-3 text-center text-[16px] font-semibold tabular-nums focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
              />
            </div>
            <span id={`${ids}-clients-max`} className="sr-only">{t("clientsMax", { max: String(CALCULATOR_MAX_CLIENTS) })}</span>
          </div>
          <div>
            <div className="mb-1.5 text-[13px] font-medium text-[#6f7282]">{t("tier")}</div>
            {segmented(tier, [["standard", t("standard")], ["premium", t("premium")]], setTier, t("tier"))}
          </div>
          <div>
            <div className="mb-1.5 text-[13px] font-medium text-[#6f7282]">{t("cycle")}</div>
            {segmented(cycle, [["month", t("monthly")], ["year", t("yearly")]], setCycle, t("cycle"))}
          </div>
          <div>
            <label htmlFor={`${ids}-points`} className="mb-1.5 block text-[13px] font-medium text-[#6f7282]">{t("points")}</label>
            <input
              id={`${ids}-points`}
              inputMode="numeric"
              value={pointsRaw}
              onChange={(event) => setPointsRaw(event.target.value.replace(/\D/g, "").slice(0, 3))}
              onBlur={() => setPointsRaw(String(points))}
              className="h-11 w-20 rounded-xl border border-[#dcdfed] px-3 text-center text-[16px] font-semibold tabular-nums focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
            />
          </div>
        </div>

        <div className="flex flex-col justify-between rounded-2xl bg-[#0b1024] p-6 text-white" aria-live="polite">
          <div>
            <div className="text-[13px] font-medium uppercase tracking-[0.14em] text-white/60">{t("result")}</div>
            <div className="mt-2 text-[clamp(2rem,3vw+1rem,2.75rem)] font-semibold tabular-nums tracking-[-0.02em]" data-partner-calculator-total>
              {formatRub(locale, result.totalRub)}
            </div>
            <ul className="mt-4 space-y-2 text-[14px] leading-[1.5] text-white/80">
              <li>
                {t("subscriptionLine", {
                  amount: formatRub(locale, result.subscriptionRub),
                  payments: String(result.paymentsPerClient),
                  perPayment: formatRub(locale, result.perPaymentRub),
                  percent: String(rule.subscriptionPercent),
                })}
              </li>
              {result.bonusRub > 0 ? (
                <li>{t("bonusLine", { amount: formatRub(locale, result.bonusRub), bonus: formatRub(locale, rule.bonusAmountRub), after: String(rule.bonusAfterPayments) })}</li>
              ) : null}
              {result.bonusLater ? (
                <li className="text-white/60">{t("bonusLater", { bonus: formatRub(locale, rule.bonusAmountRub), after: String(rule.bonusAfterPayments) })}</li>
              ) : null}
            </ul>
          </div>
          <p className="mt-5 text-[12.5px] leading-[1.5] text-white/55">
            {t("footnote", { version: String(version), months: String(rule.subscriptionMonths), hardware: String(hardwarePercent) })}
          </p>
        </div>
      </div>
    </section>
  );
}
