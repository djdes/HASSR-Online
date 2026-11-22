"use client";

import { cn } from "@/lib/utils";
import { SEGMENT_OFF_CLASS, SEGMENT_ON_CLASS } from "@/components/ui/segment-styles";

/**
 * Ряд кнопок-вариантов — сегменты (`ui/segment-styles.ts`): общая подложка, выбранный — светлая
 * плашка; заливка перетекает от прежнего варианта к новому (`MotionRuntime`).
 */
export function ChoicePills<T extends string>({ value, options, onChange, label, className }: {
  value: T | null; options: ReadonlyArray<{ value: T; label: string; hint?: string }>; onChange: (value: T) => void; label: string;
  /** Раскладка ряда; по умолчанию — кнопки в строку с переносом. */
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("flex flex-wrap gap-1 rounded-2xl bg-[var(--app-veil)] p-1", className)}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "min-h-10 rounded-xl px-3 py-1.5 text-left text-[13px] leading-tight transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
              active ? SEGMENT_ON_CLASS : SEGMENT_OFF_CLASS,
            )}
          >
            <span className="block font-medium">{option.label}</span>
            {option.hint ? <span className="block text-[11.5px] font-normal text-[#6f7282]">{option.hint}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
