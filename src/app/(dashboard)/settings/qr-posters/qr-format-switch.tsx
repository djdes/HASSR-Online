"use client";

import { useRef, type KeyboardEvent } from "react";

import { QR_PRINT_FORMATS, type QrPrintFormat } from "@/lib/qr-fill-types";
import { cn } from "@/lib/utils";

/**
 * Формат печати одной карточки (или «для всех»): A4 | A5 | Наклейка.
 *
 * Именно `radiogroup`, не `tablist`: вкладки на телефоне `globals.css`
 * переносит и прокручивает, а главное — вкладки читались как «разные
 * страницы, с которых можно отмечать», из-за чего владелец и запутался.
 * Стрелки двигают выбор (паттерн ARIA radiogroup), каждая кнопка — 44px.
 */
export function QrFormatSwitch({
  value,
  onChange,
  label,
  className,
}: {
  /** null — у карточек группы разные форматы, ни один не выбран. */
  value: QrPrintFormat | null;
  onChange: (format: QrPrintFormat) => void;
  label: string;
  className?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = Math.max(
    0,
    QR_PRINT_FORMATS.findIndex((option) => option.value === value)
  );

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + QR_PRINT_FORMATS.length) % QR_PRINT_FORMATS.length;
    onChange(QR_PRINT_FORMATS[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-qr-format-switch=""
      className={cn(
        "inline-flex max-w-full rounded-2xl border border-[#dcdfed] bg-[#fafbff] p-0.5",
        className
      )}
    >
      {QR_PRINT_FORMATS.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={index === activeIndex ? 0 : -1}
            title={option.hint}
            data-qr-format-option={option.value}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "inline-flex h-11 min-w-[56px] items-center justify-center rounded-[14px] px-3 text-[13.5px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
              checked
                ? "bg-white text-[#3848c7] shadow-[0_1px_0_rgba(11,16,36,0.04),0_0_0_1px_rgba(85,102,246,0.35)]"
                : "text-[#6f7282] hover:bg-[#f5f6ff] hover:text-[#0b1024]"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
