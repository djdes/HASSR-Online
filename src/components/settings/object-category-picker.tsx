"use client";

import { Dumbbell, Scissors, Stethoscope, UtensilsCrossed, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import { OBJECT_CATEGORIES, type ObjectCategory } from "@/lib/object-categories";

/**
 * Выбор сферы объекта (владелец, 2026-11-23): четыре сферы — при создании
 * объекта и в его правке. `cards` — карточки с пояснением (мастер объекта),
 * `select` — компактный список (строка мастера первого входа, правка
 * объекта).
 */

const ICONS: Record<ObjectCategory, LucideIcon> = {
  food: UtensilsCrossed,
  medical: Stethoscope,
  consumer: Scissors,
  sport: Dumbbell,
};

export function ObjectCategoryPicker({
  value,
  onChange,
  variant = "cards",
  invalid = false,
  disabled = false,
  id,
  className,
}: {
  value: ObjectCategory | null;
  onChange: (value: ObjectCategory) => void;
  variant?: "cards" | "select";
  invalid?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  const t = useTranslations("common");
  if (variant === "select") {
    return (
      <select
        id={id}
        value={value ?? ""}
        disabled={disabled}
        aria-label={t("objectCategoryLabel")}
        aria-invalid={invalid ? true : undefined}
        data-object-category-select=""
        onChange={(event) => {
          const next = OBJECT_CATEGORIES.find((item) => item.value === event.target.value);
          if (next) onChange(next.value);
        }}
        className={cn(
          "h-11 w-full min-w-0 rounded-2xl border bg-white px-3 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 disabled:opacity-60",
          invalid ? "border-[#d2453d]" : "border-[#dcdfed]",
          value ? "" : "text-[#9b9fb3]",
          className,
        )}
      >
        {value ? null : (
          <option value="" disabled>
            {t("objectCategoryNone")}
          </option>
        )}
        {OBJECT_CATEGORIES.map((item) => (
          <option key={item.value} value={item.value}>
            {t(`objectCategories.${item.value}`)}
          </option>
        ))}
      </select>
    );
  }
  return (
    <div
      id={id}
      role="radiogroup"
      aria-label={t("objectCategoryLabel")}
      aria-invalid={invalid ? true : undefined}
      className={cn("grid gap-2 sm:grid-cols-2", className)}
    >
      {OBJECT_CATEGORIES.map((item) => {
        const Icon = ICONS[item.value];
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            data-object-category={item.value}
            onClick={() => onChange(item.value)}
            className={cn(
              "flex items-start gap-3 rounded-2xl p-3.5 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-60",
              selected
                ? "bg-[#eef1ff] ring-2 ring-[#5566f6]"
                : invalid
                  ? "bg-[var(--app-veil)] ring-1 ring-[#d2453d]/40 hover:bg-[var(--app-veil-hover)]"
                  : "bg-[var(--app-veil)] hover:bg-[var(--app-veil-hover)]",
            )}
          >
            <Icon className={cn("mt-0.5 size-5 shrink-0", selected ? "text-[#5566f6]" : "text-[#6f7282]")} aria-hidden />
            <span className="min-w-0">
              <span className="block text-[14px] font-semibold text-[#0b1024]">{t(`objectCategories.${item.value}`)}</span>
              <span className="mt-0.5 block text-[12px] leading-[1.45] text-[#6f7282]">
                {t(`objectCategoryHints.${item.value}`)}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Подпись сферы объекта (или «Сфера не выбрана»). */
export function useObjectCategoryLabel(): (value: ObjectCategory | null) => string {
  const t = useTranslations("common");
  return (value) => (value ? t(`objectCategories.${value}`) : t("objectCategoryNone"));
}
