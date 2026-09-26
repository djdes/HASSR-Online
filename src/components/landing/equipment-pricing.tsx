"use client";

import { useState } from "react";
import { ChevronDown, Wrench } from "lucide-react";
import { PricingCalculator } from "@/components/public/pricing-calculator";

/**
 * Третья тарифная карточка «+ Оборудование» и калькулятор под ней.
 *
 * Калькулятор свёрнут по умолчанию: раньше он стоял прямо в карточке
 * и разносил её высоту вдвое против соседних — ряд из трёх тарифов
 * переставал читаться как ряд. Теперь карточка показывает только
 * стартовую цену, а подбор раскрывается во всю ширину под тарифами,
 * где ему и место: там помещаются и позиции, и итог.
 *
 * Клиентский компонент, потому что владеет одним булевым состоянием.
 * Две первые карточки приходят `children` с сервера — им клиентский
 * бандл ни к чему.
 */
export function EquipmentPricing({
  children,
  subscriptionMonthly,
  hardwareFromRub,
}: {
  /** Карточки «Бесплатный» и «Подписка», отрисованные на сервере. */
  children: React.ReactNode;
  subscriptionMonthly: number;
  /** Самый дешёвый комплект — показываем как «от N ₽». */
  hardwareFromRub: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="grid items-stretch gap-5 md:grid-cols-2 lg:grid-cols-3">
        {children}

        <div className="relative flex h-full flex-col rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-8">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
              <Wrench className="size-5" />
            </span>
            <div className="text-[20px] font-semibold tracking-[-0.01em] text-[#0b1024]">
              + Оборудование
            </div>
          </div>

          <div className="mt-6 flex items-baseline gap-2">
            <span className="text-[34px] font-semibold tracking-[-0.02em] text-[#0b1024]">
              от {hardwareFromRub.toLocaleString("ru-RU")} ₽
            </span>
            <span className="text-[16px] text-[#9b9fb3] sm:text-[13px]">разово</span>
          </div>

          {/* На телефоне текст 16 px и кнопка 48 px — как у карточек рядом
              (PlanCard touch); с sm — прежние размеры. */}
          <ul className="mt-6 space-y-2.5 pb-8 text-[16px] text-[#3c4053] sm:text-[14px]">
            <li className="flex items-start gap-2">
              <span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-[#5566f6] sm:mt-[7px]" />
              <span>Датчики в холодильники — температура пишется сама</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-[#5566f6] sm:mt-[7px]" />
              <span>Планшет на кухне и NFC-брелоки для смены</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-[#5566f6] sm:mt-[7px]" />
              <span>Выезд, монтаж и обучение смены</span>
            </li>
          </ul>

          {/* mt-auto прижимает кнопку к низу карточки: три тарифа одной
              высоты выглядят рядом только тогда, когда у них совпадает
              нижняя граница действия. */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="equipment-calculator"
            className="mt-auto inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white text-[16px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] sm:h-11 sm:text-[15px]"
          >
            {open ? "Свернуть подбор" : "Подобрать оборудование"}
            <ChevronDown
              className={`size-4 text-[#5566f6] transition-transform duration-200 ${
                open ? "rotate-180" : ""
              }`}
            />
          </button>
        </div>
      </div>

      {open ? (
        <div
          id="equipment-calculator"
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
            paymentDisabled
          />
        </div>
      ) : null}
    </>
  );
}
