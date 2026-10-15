"use client";

import { Clock } from "lucide-react";
import { useId } from "react";
import { useTranslations } from "next-intl";

/**
 * Одно поле времени вместо пары «часы» + «минуты».
 *
 * Зачем: по журналам время собиралось из двух-четырёх отдельных
 * контролов — `fryer_oil` держит `startHour/startMinute/endHour/endMinute`
 * числами, `incoming_control` — четыре селекта, `accident_journal` и
 * `breakdown_history` — по четыре. На телефоне это четыре попадания
 * пальцем и четыре открытия клавиатуры там, где нужно одно значение.
 *
 * Внутри — нативный `<input type="time">` (на телефоне это системное
 * колесо, самый быстрый ввод) плюс кнопка «Сейчас»: в журналах время
 * почти всегда фиксируют по факту, и один тап закрывает 90% случаев.
 *
 * Значение — строка "ЧЧ:ММ" (или пустая). Ровно в этом виде время лежит
 * в конфигах документов, так что конвертация не нужна.
 */
export type TimeFieldProps = {
  value: string;
  onChange: (next: string) => void;
  onCommit?: (next: string) => void;
  label?: string;
  disabled?: boolean;
  id?: string;
  /** Кнопка «Сейчас». Выключается там, где время задают задним числом. */
  showNow?: boolean;
  hint?: string;
  className?: string;
};

/** "ЧЧ:ММ" от текущего момента. */
export function nowTimeValue(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes()
  ).padStart(2, "0")}`;
}

/**
 * Приводит к "ЧЧ:ММ" всё, что исторически лежало в журналах: «9:5»,
 * «09.05», раздельные часы/минуты, уже готовое «09:05».
 */
export function normalizeTimeValue(raw: unknown): string {
  if (raw == null) return "";
  const text = String(raw).trim();
  if (text === "") return "";
  const match = text.match(/^(\d{1,2})\s*[:.\-\s]\s*(\d{1,2})$/);
  if (!match) return "";
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return "";
  if (hours > 23 || minutes > 59) return "";
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Часы и минуты по отдельности — для журналов, что хранят их врозь. */
export function splitTimeValue(value: string): {
  hour: string;
  minute: string;
} {
  const normalized = normalizeTimeValue(value);
  if (!normalized) return { hour: "", minute: "" };
  const [hour, minute] = normalized.split(":");
  return { hour, minute };
}

/** Сборка "ЧЧ:ММ" из раздельных частей. */
export function joinTimeValue(hour: unknown, minute: unknown): string {
  const h = String(hour ?? "").trim();
  const m = String(minute ?? "").trim();
  if (h === "" && m === "") return "";
  return normalizeTimeValue(`${h || "0"}:${m || "0"}`);
}

export function TimeField({
  value,
  onChange,
  onCommit,
  label,
  disabled,
  id,
  showNow = true,
  hint,
  className = "",
}: TimeFieldProps) {
  const t = useTranslations("journalControls.timeField");
  const generatedId = useId();
  const inputId = id ?? generatedId;

  function setNow() {
    if (disabled) return;
    const next = nowTimeValue();
    onChange(next);
    onCommit?.(next);
  }

  return (
    <div className={`min-w-0 ${className}`}>
      {label ? (
        <label
          htmlFor={inputId}
          className="mb-1 block text-[12px] font-medium text-[#6f7282]"
        >
          {label}
        </label>
      ) : null}

      <div className="flex items-stretch gap-1.5">
        <div className="relative min-w-0 flex-1">
          <Clock className="pointer-events-none absolute inset-y-0 left-3.5 my-auto size-4 text-[#9b9fb3]" />
          <input
            id={inputId}
            type="time"
            aria-label={label || t("time")}
            value={normalizeTimeValue(value)}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            onBlur={(event) => onCommit?.(event.target.value)}
            className="h-12 w-full rounded-2xl border border-[#dcdfed] bg-white pl-10 pr-3 text-[16px] tabular-nums text-[#0b1024] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 disabled:bg-[#fafbff] disabled:text-[#6f7282]"
          />
        </div>

        {showNow ? (
          <button
            type="button"
            onClick={setNow}
            disabled={disabled}
            className="h-12 shrink-0 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#3848c7] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-40"
          >
            {t("now")}
          </button>
        ) : null}
      </div>

      {hint ? (
        <div className="mt-1 text-[12px] text-[#9b9fb3]">{hint}</div>
      ) : null}
    </div>
  );
}
