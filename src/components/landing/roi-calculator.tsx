"use client";

import { useMemo, useState } from "react";
import { quoteSubscription } from "@/lib/subscription-pricing";
import { PromoPrice } from "@/components/pricing/promo-price";
import { applyPromotion, type AppliedPromotion } from "@/lib/promo/promotions";

/**
 * H10 — ROI калькулятор на лендинге. Slider «сколько у вас сотрудников»
 * → расчёт «сколько стоит» + «сколько часов экономите» + «средний штраф
 * РПН который мы помогаем избежать».
 *
 * Стоимость — по единой модели `quoteSubscription`: цену подписки
 * страница читает из БД и передаёт пропсом, компонент клиентский и
 * в БД не ходит.
 *
 * Цифры экономии — приблизительные/маркетинговые, основаны на
 * разговорах с клиентами:
 *   - 30 минут/день экономии на одного сотрудника (заполнение бумажных
 *     журналов через TasksFlow + автоматику)
 *   - средний штраф РПН за непредоставление журналов = 50_000 ₽ за раз,
 *     1-2 раза в год без системы
 */
export function RoiCalculator({
  subscriptionMonthly,
  promotion = null,
}: {
  /** Цена подписки из БД (`PlatformTariff.monthly`), ₽/мес. */
  subscriptionMonthly: number;
  /**
   * Действующая акция (сервер): скидка — на всю сумму подписки, вместе с
   * доплатой за сотрудников сверх лимита.
   */
  promotion?: AppliedPromotion | null;
}) {
  const [employees, setEmployees] = useState(15);

  const calc = useMemo(() => {
    const price = quoteSubscription(employees, subscriptionMonthly);
    // 30 мин/день × 22 рабочих дня × employees × 500 ₽/час (средняя
    // ставка повара/менеджера на бумажную работу).
    const hoursSavedPerMonth = (employees * 22 * 0.5);
    const moneySavedPerMonth = Math.round(hoursSavedPerMonth * 500);
    // Pen-stroke from РПН — статистически 1-2 раза в год без системы.
    // С системой — почти 0. 50_000 ₽ × 1.5 / 12 = 6_250 ₽/мес.
    const fineProtectionPerMonth = 6_250;
    const totalMonthlySaving = moneySavedPerMonth + fineProtectionPerMonth;
    const withPromotion = applyPromotion(price.monthlyRub, promotion);
    const monthlyCost = withPromotion.priceRub;
    const netBenefit = totalMonthlySaving - monthlyCost;
    const roiX =
      monthlyCost === 0 ? Infinity : Math.round(totalMonthlySaving / monthlyCost);

    return {
      withPromotion,
      monthlyCost,
      monthlyCostFormatted: monthlyCost.toLocaleString("ru-RU"),
      hoursSavedPerMonth: Math.round(hoursSavedPerMonth),
      moneySavedFormatted: moneySavedPerMonth.toLocaleString("ru-RU"),
      fineProtectionFormatted: fineProtectionPerMonth.toLocaleString("ru-RU"),
      totalMonthlySaving: totalMonthlySaving,
      totalSavingFormatted: totalMonthlySaving.toLocaleString("ru-RU"),
      netBenefit: netBenefit,
      netBenefitFormatted: netBenefit.toLocaleString("ru-RU"),
      roiX: Number.isFinite(roiX) ? roiX : null,
      tier: price.tierLabel,
    };
  }, [employees, subscriptionMonthly, promotion]);

  return (
    <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-10">
      <h2 className="text-[clamp(1.5rem,1.5vw+1rem,2rem)] font-semibold tracking-[-0.02em] text-[#0b1024]">
        Сколько вы сэкономите?
      </h2>
      <p className="mt-2 max-w-[600px] text-[15px] text-[#6f7282]">
        Передвиньте ползунок — посчитаем приблизительную выгоду от перехода
        на электронные журналы для вашей команды.
      </p>

      <div className="mt-8">
        <div className="flex items-baseline justify-between">
          <label
            htmlFor="roi-employees"
            className="text-[14px] font-medium text-[#0b1024]"
          >
            Сотрудников в смене
          </label>
          <span className="text-[28px] font-semibold tabular-nums text-[#5566f6]">
            {employees}
          </span>
        </div>
        <input
          id="roi-employees"
          type="range"
          min={1}
          max={150}
          step={1}
          value={employees}
          onChange={(e) => setEmployees(Number(e.target.value))}
          className="mt-3 w-full accent-[#5566f6]"
        />
        <div className="mt-1 flex justify-between text-[12px] text-[#9b9fb3]">
          <span>1</span>
          <span>50</span>
          <span>100</span>
          <span>150+</span>
        </div>
      </div>

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        <Tile
          label="WeSetup в месяц"
          value={
            calc.withPromotion.promotion ? (
              <PromoPrice price={calc.withPromotion} size="md" tone="inherit" layout="stacked" />
            ) : calc.monthlyCost === 0 ? (
              "0 ₽"
            ) : (
              `${calc.monthlyCostFormatted} ₽`
            )
          }
          hint={calc.tier}
          tone="muted"
        />
        <Tile
          label="Часов работы экономите"
          value={`${calc.hoursSavedPerMonth} ч`}
          hint={`≈ ${calc.moneySavedFormatted} ₽`}
          tone="positive"
        />
        <Tile
          label="Защита от штрафов"
          value={`${calc.fineProtectionFormatted} ₽`}
          hint="усреднённый риск РПН"
          tone="positive"
        />
      </div>

      <div className="mt-6 rounded-2xl border border-[#5566f6]/30 bg-[#f5f6ff] p-5">
        <div className="text-[12px] font-medium uppercase tracking-wider text-[#3848c7]">
          Чистая выгода в месяц
        </div>
        <div className="mt-1 flex items-baseline gap-3">
          <span className="text-[36px] font-semibold tabular-nums text-[#0b1024]">
            {calc.netBenefitFormatted} ₽
          </span>
          {calc.roiX && calc.roiX > 1 ? (
            <span className="rounded-full bg-[#5566f6] px-3 py-1 text-[13px] font-medium text-white">
              ROI {calc.roiX}×
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-[13px] text-[#3c4053]">
          За год это ≈{" "}
          <strong>
            {(calc.netBenefit * 12).toLocaleString("ru-RU")} ₽
          </strong>{" "}
          {calc.netBenefit > 0 ? "сэкономленных" : "доплаты"}.
        </p>
      </div>

      <p className="mt-4 text-[12px] text-[#9b9fb3]">
        Расчёт примерный. 30 мин/день экономии на одного сотрудника при
        ставке 500 ₽/час и средней частоте проверок РПН 1-2 раза в год —
        исходя из разговоров с клиентами WeSetup. Для точного расчёта
        свяжитесь с нами.
      </p>
    </section>
  );
}

function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone: "positive" | "muted";
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        tone === "positive"
          ? "border-[#86efac]/40 bg-[#ecfdf5]"
          : "border-[#ececf4] bg-[#fafbff]"
      }`}
    >
      <div className="text-[12px] font-medium uppercase tracking-wider text-[#6f7282]">
        {label}
      </div>
      <div
        className={`mt-1 text-[22px] font-semibold tabular-nums ${
          tone === "positive" ? "text-[#116b2a]" : "text-[#0b1024]"
        }`}
      >
        {value}
      </div>
      {hint && (
        <div className="text-[12px] text-[#6f7282]">{hint}</div>
      )}
    </div>
  );
}
