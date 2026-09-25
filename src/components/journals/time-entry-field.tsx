"use client";

import { useState } from "react";
import { ArrowDownToLine, Clock3 } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { normalizeTypedTime } from "@/lib/finished-product-bulk";
import { cn } from "@/lib/utils";

const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));
const MINUTES = Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, "0"));

/** Время введено, но не распознаётся даже без двоеточия («25», «утро»). */
export function isBadTypedTime(value: string): boolean {
  return value.trim() !== "" && normalizeTypedTime(value) === "";
}

/**
 * Поле времени «ЧЧ:ММ» для таблиц списком (меню мастер-кабинета, «Добавить
 * списком»): цифры без двоеточия («0800», «830», «8») становятся «08:00» /
 * «08:30» при уходе с поля или Enter; кнопка-часы открывает выбор часа и
 * минут — одинаково на телефоне и компьютере (нативный time-input есть не
 * везде); «Проставить всем ниже» — это время строкам ниже.
 */
export function TimeEntryField({
  value,
  onChange,
  onFillBelow,
  fillBelowDisabled,
  ariaLabel,
  placeholder = "08:30",
  testId,
  className,
  inputClassName,
  onPaste,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Есть — у поля кнопка «Проставить всем ниже». */
  onFillBelow?: () => void;
  fillBelowDisabled?: boolean;
  ariaLabel: string;
  placeholder?: string;
  testId?: string;
  className?: string;
  inputClassName?: string;
  /** Вставка блока из Excel в ячейку времени — таблица разбирает сама. */
  onPaste?: (event: React.ClipboardEvent<HTMLInputElement>) => void;
}) {
  const [open, setOpen] = useState(false);
  const normalized = normalizeTypedTime(value);
  const bad = isBadTypedTime(value);
  const [hh, mm] = normalized ? normalized.split(":") : ["", ""];

  function commit(raw: string) {
    const next = normalizeTypedTime(raw);
    if (next && next !== raw) onChange(next);
  }

  function pickHour(hour: string) {
    onChange(`${hour}:${mm || "00"}`);
  }

  function pickMinute(minute: string) {
    onChange(`${hh || "08"}:${minute}`);
    setOpen(false);
  }

  const canFillBelow = Boolean(onFillBelow) && normalized !== "" && !fillBelowDisabled;

  return (
    <div className={cn("flex min-w-0 items-center gap-1", className)}>
      <div className="relative min-w-0 flex-1">
        <input
          className={cn(
            "h-10 w-full rounded-xl border pl-3 pr-9 text-[14px] tabular-nums text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15",
            bad ? "border-[#e8a39a] bg-[#fff4f2]" : "border-[#dcdfed] bg-white",
            inputClassName
          )}
          value={value}
          maxLength={8}
          inputMode="numeric"
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-invalid={bad || undefined}
          title="Можно без двоеточия: 0830 или 830 → 08:30"
          onChange={(event) => onChange(event.target.value)}
          onPaste={onPaste}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit((event.target as HTMLInputElement).value);
          }}
          data-testid={testId}
        />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-[#6f7282] transition-colors duration-150 hover:bg-[#f5f6ff] hover:text-[#3848c7] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
              aria-label={`Выбрать время: ${ariaLabel}`}
              title="Выбрать время"
              data-testid={testId ? `${testId}-picker` : undefined}
            >
              <Clock3 className="size-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[292px] p-3" data-testid="time-picker">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">Час</div>
            <div className="mt-1.5 grid grid-cols-6 gap-1">
              {HOURS.map((hour) => (
                <button
                  key={hour}
                  type="button"
                  onClick={() => pickHour(hour)}
                  aria-pressed={hour === hh}
                  className={cn(
                    "h-8 rounded-lg text-[13px] font-medium tabular-nums transition-colors duration-150",
                    hour === hh ? "bg-[#5566f6] text-white" : "text-[#3c4053] hover:bg-[#f5f6ff] hover:text-[#0b1024]"
                  )}
                  data-testid={`time-picker-hour-${hour}`}
                >
                  {hour}
                </button>
              ))}
            </div>
            <div className="mt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">Минуты</div>
            <div className="mt-1.5 grid grid-cols-6 gap-1">
              {MINUTES.map((minute) => (
                <button
                  key={minute}
                  type="button"
                  onClick={() => pickMinute(minute)}
                  aria-pressed={minute === mm}
                  className={cn(
                    "h-8 rounded-lg text-[13px] font-medium tabular-nums transition-colors duration-150",
                    minute === mm ? "bg-[#5566f6] text-white" : "text-[#3c4053] hover:bg-[#f5f6ff] hover:text-[#0b1024]"
                  )}
                  data-testid={`time-picker-minute-${minute}`}
                >
                  :{minute}
                </button>
              ))}
            </div>
            {onFillBelow ? (
              <button
                type="button"
                disabled={!canFillBelow}
                onClick={() => {
                  onFillBelow();
                  setOpen(false);
                }}
                className="mt-3 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white text-[13px] font-medium text-[#3848c7] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ArrowDownToLine className="size-4" />
                Проставить всем ниже
              </button>
            ) : null}
          </PopoverContent>
        </Popover>
      </div>
      {onFillBelow ? (
        <button
          type="button"
          disabled={!canFillBelow}
          onClick={onFillBelow}
          className="flex size-10 shrink-0 items-center justify-center rounded-xl text-[#6f7282] transition-colors duration-150 hover:bg-[#f5f6ff] hover:text-[#3848c7] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-35"
          aria-label={`Проставить всем ниже: ${ariaLabel}`}
          title="Проставить это время всем строкам ниже"
          data-testid={testId ? `${testId}-fill-below` : undefined}
        >
          <ArrowDownToLine className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
