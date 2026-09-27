"use client";

import { Rows3, Table2, CalendarDays } from "lucide-react";

import type { MobileAxis, MobileView } from "@/lib/use-mobile-view";

export type ViewAxisChoice =
  | { view: "cards"; axis: MobileAxis }
  | { view: "table" };

/**
 * Один ряд вместо двух: «Сегодня / По сотрудникам / Таблица».
 *
 * Раньше это были два переключателя друг под другом — «Карточки /
 * Таблица» и «Сегодня / По сотрудникам». На экране телефона они
 * занимали около 112 px до первой строки данных, то есть восьмую часть
 * высоты.
 *
 * Но дело не только в месте. Два переключателя выглядят как матрица
 * 2×2, хотя четвёртого состояния не существует: таблица показывает
 * весь период целиком и ось попросту игнорирует. Реальных состояний
 * три, и честнее показать их тремя кнопками, чем заставлять человека
 * держать в голове несуществующую комбинацию.
 *
 * Когда сегодняшнего дня в периоде нет (журнал за прошлый месяц),
 * выбирать между «сегодня» и «по сотрудникам» не из чего — тогда
 * остаются две кнопки, как было.
 */
export function MobileViewAxisToggle({
  view,
  axis,
  onChange,
  entityLabel = "По периоду",
  axisAvailable = true,
  dataTour,
}: {
  view: MobileView;
  axis: MobileAxis;
  onChange: (next: ViewAxisChoice) => void;
  /** Подпись второй вкладки: «По сотрудникам», «По помещениям». */
  entityLabel?: string;
  /** Есть ли сегодняшний день в периоде документа. */
  axisAvailable?: boolean;
  dataTour?: string;
}) {
  const options: Array<{
    key: string;
    label: string;
    icon: typeof Rows3;
    active: boolean;
    choice: ViewAxisChoice;
  }> = axisAvailable
    ? [
        {
          key: "today",
          label: "Сегодня",
          icon: CalendarDays,
          active: view === "cards" && axis === "today",
          choice: { view: "cards", axis: "today" },
        },
        {
          key: "entity",
          label: entityLabel,
          icon: Rows3,
          active: view === "cards" && axis === "entity",
          choice: { view: "cards", axis: "entity" },
        },
        {
          key: "table",
          label: "Таблица",
          icon: Table2,
          active: view === "table",
          choice: { view: "table" },
        },
      ]
    : [
        {
          key: "cards",
          label: "Карточки",
          icon: Rows3,
          active: view === "cards",
          choice: { view: "cards", axis },
        },
        {
          key: "table",
          label: "Таблица",
          icon: Table2,
          active: view === "table",
          choice: { view: "table" },
        },
      ];

  return (
    <div
      role="tablist"
      aria-label="Что показывать"
      data-tour={dataTour}
      className="inline-flex w-full rounded-2xl border border-[#ececf4] bg-[#fafbff] p-1 print:hidden"
    >
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <button
            key={option.key}
            type="button"
            role="tab"
            aria-selected={option.active}
            onClick={() => onChange(option.choice)}
            className={`flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl px-2 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 ${
              option.active
                ? "bg-white text-[#3848c7] shadow-[0_1px_2px_rgba(11,16,36,0.06)]"
                : "text-[#6f7282] hover:text-[#0b1024]"
            }`}
          >
            <Icon className="size-4 shrink-0" />
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
