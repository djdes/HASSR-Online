"use client";


import { useState } from "react";
import {
  Check,
  ChevronDown,
  Users,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PricingCalculator } from "@/components/public/pricing-calculator";
import {
  EXTRA_USER_PRICE_RUB,
  LARGE_TEAM_NOTE,
  PLAN_CATALOG,
  SUBSCRIPTION_MAX_USERS,
  catalogPlanIdFor,
  employeesGenitiveLabel,
  employeesLabel,
  type CatalogPlanId,
} from "@/lib/plan-catalog";
import { PlanCard } from "@/components/pricing/plan-card";
import { PromoPrice, type PersonalDiscount } from "@/components/pricing/promo-price";
import { applyPromotion, type AppliedPromotion } from "@/lib/promo/promotions";
import { formatPriceRub } from "@/lib/billing-period";
import { planBreakdownRows, subscriptionTotal } from "@/lib/cabinet-plan";

/** Что даёт железо — те же три пункта, что в карточке на лендинге. */
const HARDWARE_POINTS = [
  "Датчики в холодильники — температура пишется сама",
  "Планшет на кухне и NFC-брелоки для смены",
  "Выезд, монтаж и обучение смены",
];

type Props = {
  /** Текущее значение `Organization.subscriptionPlan`. */
  currentPlan: string;
  currentPlanLabel: string;
  /** Условие бесплатного тарифа («до N сотрудников…»); null на платном. */
  planNote?: string | null;
  activeUsers: number;
  freeUserLimit: number;
  /** Тестовый режим биллинга — оплата не списывается. */
  billingTestMode: boolean;
  /**
   * Бесплатный период закончился: сверх бесплатного лимита — только
   * после оплаты (тихого перевода на платный больше нет).
   */
  paymentRequired?: boolean;
  /** Самый дешёвый комплект железа — считается на сервере. */
  hardwareFromRub: number;
  /** Цена подписки из БД — калькулятор считает с ней общий итог. */
  subscriptionMonthly: number;
  /** Действующая акция (сервер) — цена подписки зачёркивается. */
  subscriptionPromotion?: AppliedPromotion | null;
  /**
   * Промокод или скидка навсегда (сервер, `resolveCheckoutDiscount`) —
   * поверх акции, та же сумма уйдёт в заказ.
   */
  subscriptionDiscount?: PersonalDiscount | null;
  /** Куда ведёт «Оплатить картой» — с `promo=`, если код применён. */
  payHref?: string;
  /** Кнопка «Перейти на бесплатный» (добровольный переход) — под расчётом. */
  freeAction?: React.ReactNode;
};

/**
 * Витрина тарифов на `/settings/subscription`.
 *
 * Тарифов ровно два, поэтому вместо таблицы сравнения — две карточки с
 * кумулятивным списком («Всё из «Бесплатного»» + дельта) и одной умной
 * кнопкой на карточку: менеджер не должен гадать, что ему нажать.
 */
export function PlanUpgrade({
  currentPlan,
  currentPlanLabel,
  planNote,
  activeUsers,
  freeUserLimit,
  billingTestMode,
  paymentRequired = false,
  hardwareFromRub,
  subscriptionMonthly,
  subscriptionPromotion = null,
  subscriptionDiscount = null,
  payHref = "/order?plan=monthly",
  freeAction = null,
}: Props) {
  const [hardwareOpen, setHardwareOpen] = useState(false);

  const currentId: CatalogPlanId = catalogPlanIdFor(currentPlan);
  const seatsLeft = Math.max(0, freeUserLimit - activeUsers);
  // Расчёт «Ваш план»: подписка, превышение сверх 10, итог с акцией и
  // скидкой — тем же `quoteSubscription`, что и калькулятор ниже.
  const total = subscriptionTotal({
    employees: activeUsers,
    tariffRub: subscriptionMonthly,
    promotion: subscriptionPromotion,
    personal: subscriptionDiscount,
  });
  const rows = planBreakdownRows(total.quote);
  const breakdown = total.quote.isFree ? null : (
    <dl data-testid="plan-breakdown" className="mt-3 w-full max-w-[440px] space-y-1 text-[13.5px]">
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline justify-between gap-4">
          <dt className="text-[#3c4053]">{row.label}</dt>
          <dd className="shrink-0 tabular-nums text-[#0b1024]">{formatPriceRub(row.amountRub)}</dd>
        </div>
      ))}
      <div className="flex items-baseline justify-between gap-4 border-t border-[#ececf4] pt-1.5">
        <dt className="font-semibold text-[#0b1024]">Итого</dt>
        <dd className="shrink-0 text-right" data-testid="plan-total">
          <PromoPrice
            price={total.withPromotion}
            personal={subscriptionDiscount}
            size="sm"
            suffix="/мес"
            showBadge={false}
          />
        </dd>
      </div>
    </dl>
  );

  return (
    <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[#0b1024]">
            Ваш план: {currentPlanLabel}
          </h2>
          <p className="mt-1 inline-flex items-center gap-1.5 text-[13px] text-[#6f7282]">
            <Users className="size-3.5" />
            {currentId === "free"
              ? activeUsers > freeUserLimit
                ? // Сверх бесплатного (до решения после бесплатного периода) дробь «4/1» путает.
                  `${employeesLabel(activeUsers)} · бесплатный тариф — ${employeesLabel(freeUserLimit)}`
                : `${activeUsers}/${freeUserLimit} сотрудников · свободно мест: ${seatsLeft}`
              : employeesLabel(activeUsers)}
          </p>
          {planNote ? (
            <p className="mt-1 text-[13px] text-[#6f7282]">{planNote}</p>
          ) : null}
          {currentId === "free" ? (
            <p className="mt-2 text-[13.5px] text-[#3c4053]">
              {employeesLabel(freeUserLimit)} бесплатно; для команды — подписка
              {total.quote.isFree ? (
                <>
                  {" "}от{" "}
                  <PromoPrice
                    price={applyPromotion(subscriptionMonthly, subscriptionPromotion)}
                    personal={subscriptionDiscount}
                    size="text"
                    tone="inherit"
                    suffix="/мес"
                    showBadge={false}
                  />{" "}
                  до {SUBSCRIPTION_MAX_USERS} сотрудников, +{EXTRA_USER_PRICE_RUB} ₽/мес за каждого сверх{" "}
                  {SUBSCRIPTION_MAX_USERS}.
                </>
              ) : (
                <>, для ваших {employeesGenitiveLabel(activeUsers)}:</>
              )}
            </p>
          ) : null}
          {breakdown}
          {freeAction ? <div className="mt-3">{freeAction}</div> : null}
        </div>
        {billingTestMode ? (
          <span className="rounded-full bg-[#ecfdf5] px-3 py-1 text-[12px] font-medium text-[#116b2a]">
            Тестовый режим — оплата не списывается
          </span>
        ) : null}
      </div>

      {/* Предупреждение ровно на границе: следующий человек меняет тариф. */}
      {currentId === "free" && seatsLeft === 0 ? (
        <p
          data-testid="plan-seats-note"
          className="mt-4 rounded-2xl border border-[#ffe9b0] bg-[#fffaf0] px-4 py-3 text-[13px] leading-relaxed text-[#3c4053]"
        >
          {paymentRequired
            ? "Бесплатные места закончились. Чтобы добавить сотрудников или вернуть их из архива, оплатите подписку."
            : `Бесплатные места закончились. Следующий сотрудник переведёт организацию на подписку${
                billingTestMode ? " — сейчас это бесплатно, сайт в тестовом режиме." : "."
              }`}
        </p>
      ) : null}

      {/* Три колонки, как на лендинге: две тарифные карточки и железо.
          Было sm:grid-cols-2 — третья карточка молча съезжала на вторую
          строку, и ряд тарифов переставал читаться как ряд. Брейкпоинты
          те же, что в equipment-pricing, чтобы витрины не разъезжались. */}
      <div className="mt-5 grid items-stretch gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* Та же карточка, что на лендинге: тёмная «Подписка» посередине.
            Раньше в кабинете была своя светлая вёрстка и своя, вшитая
            строкой цена — витрины расходились при каждой правке. */}
        {PLAN_CATALOG.map((plan) => {
          const isCurrent = plan.id === currentId;
          const isPaidPlan = plan.id === "paid";
          return (
            <PlanCard
              key={plan.id}
              kind={isPaidPlan ? "team" : "free"}
              name={plan.nameRu}
              from={
                isPaidPlan
                  ? `${subscriptionMonthly.toLocaleString("ru-RU")} ₽`
                  : plan.price
              }
              price={
                isPaidPlan
                  ? applyPromotion(subscriptionMonthly, subscriptionPromotion)
                  : undefined
              }
              personal={isPaidPlan ? subscriptionDiscount : null}
              period={plan.priceHint}
              pointsIntro={
                plan.inheritsFrom ? `Всё из «${plan.inheritsFrom}», плюс:` : undefined
              }
              points={[...plan.features]}
              highlighted={isPaidPlan}
              badge={isPaidPlan && !isCurrent ? "Популярный" : undefined}
              ctaLabel={
                isCurrent
                  ? "Текущий"
                  : isPaidPlan
                    ? "Оплатить картой"
                    : "Бесплатный тариф"
              }
              // Бесплатный тариф покупать негде: он и так доступен.
              ctaDisabled={isCurrent || !isPaidPlan}
              ctaHref={payHref}
            />
          );
        })}

        {/* Железо. Кнопка ведёт на лендинг: там живёт калькулятор
            комплектов, дублировать его в кабинете незачем. */}
        <div className="flex flex-col rounded-2xl border border-[#ececf4] bg-white p-5">
          <div className="flex min-h-6 items-center justify-between gap-2">
            <span className="text-[15px] font-semibold text-[#0b1024]">
              + Оборудование
            </span>
            <span className="flex size-7 items-center justify-center rounded-lg bg-[#eef1ff] text-[#5566f6]">
              <Wrench className="size-4" />
            </span>
          </div>

          <div className="mt-1 text-[26px] font-semibold leading-none tabular-nums text-[#0b1024]">
            от {hardwareFromRub.toLocaleString("ru-RU")} ₽
            <span className="text-[14px] font-normal text-[#6f7282]"> разово</span>
          </div>
          <p className="mt-1.5 text-[12.5px] leading-[1.5] text-[#6f7282]">
            Чтобы температура писалась сама, а смена отмечалась брелоком
          </p>

          <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9b9fb3]">
            Что входит
          </div>
          <ul className="mt-2 flex-1 space-y-1.5 text-[13px]">
            {HARDWARE_POINTS.map((point) => (
              <li key={point} className="flex gap-2 text-[#3c4053]">
                <Check className="mt-0.5 size-4 shrink-0 text-[#5566f6]/70" />
                <span>{point}</span>
              </li>
            ))}
          </ul>

          {/* mt-auto прижимает кнопку к низу: три карточки читаются
              рядом только когда у них совпадает нижняя граница. */}
          <button
            type="button"
            onClick={() => setHardwareOpen((v) => !v)}
            aria-expanded={hardwareOpen}
            aria-controls="hardware-calculator"
            className="mt-auto inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
          >
            {hardwareOpen ? "Свернуть подбор" : "Подобрать комплект"}
            <ChevronDown
              className={cn(
                "size-4 text-[#5566f6] transition-transform duration-200",
                hardwareOpen && "rotate-180"
              )}
            />
          </button>
        </div>
      </div>

      {/* Калькулятор раскрывается ПОД тарифами, а не внутри карточки:
          внутри он разносил её высоту вдвое против соседних, и ряд из
          трёх переставал читаться как ряд. Во всю ширину помещаются и
          позиции, и итог. */}
      {hardwareOpen ? (
        <div
          id="hardware-calculator"
          className="mt-5 rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-8"
        >
          <div className="mb-5 max-w-[560px]">
            <div className="text-[16px] font-semibold tracking-[-0.01em] text-[#0b1024]">
              Подбор оборудования
            </div>
            <p className="mt-1.5 text-[14px] leading-[1.55] text-[#6f7282]">
              Выберите, что нужно — цена пересчитается. Уже есть планшет
              или датчики: снимите галочку, и останется только подписка.
            </p>
          </div>
          <PricingCalculator
            subscriptionMonthly={subscriptionMonthly}
            subscriptionPromotion={subscriptionPromotion}
            paymentDisabled
          />
        </div>
      ) : null}

      {/* Сверх лимита подписки — фиксированная доплата за сотрудника;
          места сверх лимита оформляются через поддержку, поэтому рядом
          кнопка связи. Молчать нельзя — человек оплатит и упрётся в лимит. */}
      <div className="mt-5 flex flex-wrap items-center justify-center gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3">
        <span className="text-[13px] text-[#3c4053]">{LARGE_TEAM_NOTE}</span>
        <a
          href="https://t.me/wesetupbot"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-[#dcdfed] bg-white px-3.5 text-[13px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
        >
          Связаться с поддержкой
        </a>
      </div>

      <p className="mt-5 text-center text-[12px] leading-relaxed text-[#6f7282]">
        {billingTestMode
          ? "Оплата появится позже. Сейчас все функции доступны бесплатно — сайт в тестовом режиме."
          : "Тариф можно изменить в любой момент."}
      </p>

    </section>
  );
}
