"use client";

import { useMemo } from "react";
import { QuickValues } from "@/components/qr-fill/quick-values";
import { stepNumber } from "@/lib/quick-values";

/**
 * Поле показания в том же виде, что карточка в HTML-форме холодильников:
 * подпись внутри поля, «−»/«+» по краям, пилюля ✓/!, строка нормы/статуса и
 * кнопки быстрого ввода под полем. Без иконок — одинаково для температуры,
 * влажности и любого другого показателя.
 */
export function ReadingField({
  id,
  label,
  unit,
  stamp,
  value,
  onChange,
  min,
  max,
  required = false,
  invalidText = null,
}: {
  id: string;
  label: string;
  unit: string;
  stamp?: string | null;
  value: string;
  onChange: (value: string) => void;
  min: number | null | undefined;
  max: number | null | undefined;
  required?: boolean;
  /** Своя ошибка формата (например, влажность вне 0…100). */
  invalidText?: string | null;
}) {
  const lo = typeof min === "number" && typeof max === "number" ? Math.min(min, max) : min ?? null;
  const hi = typeof min === "number" && typeof max === "number" ? Math.max(min, max) : max ?? null;
  const normText = lo !== null && hi !== null ? `${lo}…${hi} ${unit}` : lo !== null ? `не ниже ${lo} ${unit}` : hi !== null ? `не выше ${hi} ${unit}` : "";
  const parsed = useMemo(() => {
    const text = value.replace(",", ".").trim();
    if (text === "" || text === "-") return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  }, [value]);
  const low = parsed !== null && lo !== null && parsed < lo;
  const high = parsed !== null && hi !== null && parsed > hi;
  const tone: "idle" | "good" | "bad" = invalidText ? "bad" : parsed === null ? "idle" : low || high ? "bad" : normText ? "good" : "idle";
  const status = invalidText
    ? invalidText
    : parsed === null
      ? normText ? `Норма ${normText}` : ""
      : low || high
        ? `${low ? "Ниже" : "Выше"} нормы ${normText}`
        : normText ? "В норме" : "";
  const box =
    tone === "bad"
      ? "border-[#e9b949] bg-[#fffaeb]"
      : tone === "good"
        ? "border-[#8fd3a8] bg-white"
        : "border-[#dcdfed] bg-white";
  const stepButton = "absolute top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-xl border border-[#dcdfed] bg-white text-[24px] font-semibold leading-none text-[#3848c7] transition-colors duration-150 hover:bg-[#f5f6ff] active:border-[#5566f6] active:bg-[#eef1ff]";
  return (
    <div>
      <div className={`relative rounded-[14px] border transition-colors duration-150 ${box}`}>
        <button type="button" className={`${stepButton} left-2`} aria-label={`Минус: ${label.toLowerCase()} на шаг ниже`} onClick={() => onChange(stepNumber(value, -1, lo, hi))}>
          −
        </button>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder=" "
          aria-required={required || undefined}
          className={`h-[66px] w-full rounded-[14px] bg-transparent pb-[6px] pl-14 pt-[24px] text-[22px] font-semibold text-[#0b1024] outline-none focus:ring-4 focus:ring-[#5566f6]/15 ${tone === "idle" ? "pr-14" : "pr-[88px]"}`}
        />
        <label htmlFor={id} className="pointer-events-none absolute left-14 right-14 top-2 truncate text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[#6f7282]">
          {label}
          {stamp ? <span className="text-[11px] font-medium normal-case tracking-normal"> · {stamp}</span> : null}
          {required ? <span className="ml-0.5 text-[#a13a32]">*</span> : null}
        </label>
        {tone !== "idle" ? (
          <span
            aria-hidden="true"
            className={`absolute right-14 top-1/2 inline-flex h-[22px] min-w-[22px] -translate-y-1/2 items-center justify-center rounded-full px-1.5 text-[12px] font-bold ${
              tone === "good" ? "bg-[#dcfce7] text-[#116b2a]" : "bg-[#fff0c2] text-[#7a4a00]"
            }`}
          >
            {tone === "good" ? "✓" : "!"}
          </span>
        ) : null}
        <button type="button" className={`${stepButton} right-2`} aria-label={`Плюс: ${label.toLowerCase()} на шаг выше`} onClick={() => onChange(stepNumber(value, 1, lo, hi))}>
          +
        </button>
      </div>
      {status ? (
        <p className={`ml-[3px] mt-1 text-[14.5px] leading-[1.3] ${tone === "bad" ? "font-medium text-[#7a4a00]" : tone === "good" ? "text-[#116b2a]" : "text-[#9b9fb3]"}`}>{status}</p>
      ) : null}
      <QuickValues min={lo} max={hi} value={value} onPick={onChange} label={`Быстрый ввод: ${label.toLowerCase()}`} />
    </div>
  );
}
