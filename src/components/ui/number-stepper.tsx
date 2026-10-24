"use client";

import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Счётчик с кнопками −/+ и полем для ручного ввода.
 *
 * Кнопки удобны, когда значение маленькое (одна-две точки — одно
 * касание вместо вызова клавиатуры). Но сеть или производство называет
 * и 180 объектов, поэтому число обязано вводиться руками: докликивать
 * туда плюсом невозможно.
 *
 * Черновик хранится строкой: пока человек печатает «18» на пути к
 * «180», приводить значение к границам нельзя — иначе поле дерётся с
 * набором. Приводим на потере фокуса и на Enter.
 *
 * Без своей рамки: компонент рассчитан на то, что живёт внутри поля с
 * подписью (`Field`), у которого рамка и фокус-кольцо свои.
 */
export function NumberStepper({
  value,
  onChange,
  min = 1,
  max = 99,
  ariaLabel,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  ariaLabel?: string;
}) {
  const t = useTranslations("sharedUi.numberStepper");
  const [draft, setDraft] = useState(String(value));
  const [seenValue, setSeenValue] = useState(value);

  // Значение могли изменить кнопками или снаружи — подхватываем прямо
  // в рендере (штатный приём React для «состояния, зависящего от
  // пропа»; эффект здесь дал бы лишний проход). Черновик не трогаем,
  // пока он совпадает по смыслу: иначе «007» превратится в «7» прямо
  // под курсором.
  if (seenValue !== value) {
    setSeenValue(value);
    if (Number(draft) !== value) setDraft(String(value));
  }

  function clamp(n: number) {
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, Math.round(n)));
  }

  function commit() {
    const next = clamp(Number(draft.replace(/\D/g, "")));
    setDraft(String(next));
    onChange(next);
  }

  const buttonCls =
    "flex size-8 shrink-0 items-center justify-center rounded-xl text-[#3c4053] transition-colors hover:bg-[#f5f6ff] hover:text-[#3848c7] disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onChange(clamp(value - 1))}
        disabled={value <= min}
        aria-label={t("less")}
        className={buttonCls}
      >
        <Minus className="size-4" />
      </button>
      <input
        value={draft}
        aria-label={ariaLabel}
        inputMode="numeric"
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, "").slice(0, 4))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            onChange(clamp(value + 1));
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            onChange(clamp(value - 1));
          }
        }}
        className="min-w-0 flex-1 bg-transparent text-center text-[16px] font-semibold tabular-nums text-[#0b1024] focus:outline-none"
      />
      <button
        type="button"
        onClick={() => onChange(clamp(value + 1))}
        disabled={value >= max}
        aria-label={t("more")}
        className={buttonCls}
      >
        <Plus className="size-4" />
      </button>
    </span>
  );
}
