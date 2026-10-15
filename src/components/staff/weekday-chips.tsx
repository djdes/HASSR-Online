"use client";

import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

/**
 * Ряд чипов «Пн Вт Ср Чт Пт Сб Вс» — недельное правило выходных.
 *
 * Один компонент на три места (график, форма добавления, карточка
 * сотрудника), чтобы «выходные» везде выглядели и работали одинаково.
 */
export function WeekdayChips(props: {
  value: number[];
  onChange: (next: number[]) => void;
  disabled?: boolean;
  /** Компактный вариант для строки таблицы. */
  size?: "sm" | "md";
  className?: string;
  ariaLabel?: string;
}) {
  const size = props.size ?? "md";
  const t = useTranslations("staffManagement.weekdays");
  const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
  return (
    <div
      role="group"
      aria-label={props.ariaLabel ?? t("groupLabel")}
      className={cn("flex flex-wrap gap-1", props.className)}
    >
      {days.map((day, index) => {
        const label = t(day);
        const active = props.value.includes(index);
        return (
          <button
            key={label}
            type="button"
            disabled={props.disabled}
            aria-pressed={active}
            title={active ? t("dayOff", { day: t(`${day}Full`) }) : t("workingDay", { day: t(`${day}Full`) })}
            onClick={() =>
              props.onChange(
                active
                  ? props.value.filter((d) => d !== index)
                  : [...props.value, index].sort((a, b) => a - b)
              )
            }
            className={cn(
              "inline-flex items-center justify-center rounded-lg border font-medium transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-50",
              size === "sm"
                ? "h-6 min-w-[26px] px-1 text-[10px]"
                : "h-9 min-w-[40px] px-2 text-[13px]",
              active
                ? "border-[#5566f6] bg-[#5566f6] text-white hover:bg-[#4a5bf0]"
                : "border-[#dcdfed] bg-white text-[#6f7282] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] hover:text-[#0b1024]"
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
