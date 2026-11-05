"use client";

import { cn } from "@/lib/utils";

/** Ряд кнопок-вариантов: выбранный — индиго, остальные — контур. */
export function ChoicePills<T extends string>({ value, options, onChange, label, className }: {
  value: T | null; options: ReadonlyArray<{ value: T; label: string; hint?: string }>; onChange: (value: T) => void; label: string;
  /** Раскладка ряда; по умолчанию — кнопки в строку с переносом. */
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("flex flex-wrap gap-2", className)}>
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
              "min-h-10 rounded-2xl border px-3 py-1.5 text-left text-[13px] leading-tight transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
              active
                ? "border-[#5566f6] bg-[#5566f6] text-white hover:bg-[#4a5bf0]"
                : "border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#c7ccea] hover:bg-[#f5f6ff]",
            )}
          >
            <span className="block font-medium">{option.label}</span>
            {option.hint ? <span className={cn("block text-[11.5px]", active ? "text-white/80" : "text-[#6f7282]")}>{option.hint}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
