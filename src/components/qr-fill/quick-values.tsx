"use client";

import { quickValues } from "@/lib/quick-values";

/** Кнопки быстрого ввода под полем с нормой: нижняя, середина, верхняя. */
export function QuickValues({
  min,
  max,
  value,
  onPick,
  label = "Быстрый ввод",
}: {
  min: number | null | undefined;
  max: number | null | undefined;
  value: string;
  onPick: (value: string) => void;
  label?: string;
}) {
  const values = quickValues(min, max);
  if (values.length === 0) return null;
  const current = value.trim().replace(",", ".");
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      {values.map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onPick(item)}
          aria-pressed={current === item}
          className={`inline-flex h-8 min-w-[52px] items-center justify-center rounded-full border px-3 text-[13px] font-medium tabular-nums transition-colors duration-150 ${
            current === item
              ? "border-[#5566f6] bg-[#eef1ff] text-[#3848c7]"
              : "border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
          }`}
        >
          {item}
        </button>
      ))}
    </div>
  );
}
