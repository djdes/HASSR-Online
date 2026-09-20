"use client";

import { Minus, Plus } from "lucide-react";

/**
 * Кнопка «−»/«+» по бокам поля показаний: шаг ±1 для чисел, ±5 минут для
 * времени. Одинаковая на телефоне и на ПК — там, где вводят температуру,
 * влажность или время, крутить цифру кнопкой быстрее, чем набирать.
 */
export function StepButton({ delta, onClick, label, size = "lg" }: { delta: -1 | 1; onClick: () => void; label: string; size?: "lg" | "md" }) {
  const Icon = delta < 0 ? Minus : Plus;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`flex shrink-0 items-center justify-center rounded-2xl border border-[#dcdfed] bg-white text-[#3848c7] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] active:bg-[#eef1ff] ${
        size === "lg" ? "size-12" : "h-14 w-12"
      }`}
    >
      <Icon className="size-5" strokeWidth={2.5} />
    </button>
  );
}
