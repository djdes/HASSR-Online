"use client";

import type { ReactNode } from "react";

/**
 * Строка «Кто / Что» как в HTML-форме журналов: подпись мелким капсом,
 * значение крупно (до двух строк), справа действие «Сменить».
 */
export function WhoRow({
  label,
  value,
  placeholder,
  action,
  onAction,
  children,
}: {
  label: string;
  value: string | null;
  /** Что показать, пока значение не выбрано. */
  placeholder?: string;
  action?: string;
  onAction?: () => void;
  children?: ReactNode;
}) {
  const empty = !value;
  return (
    <div className="mb-2.5">
      <button
        type="button"
        onClick={onAction}
        disabled={!onAction}
        className={`flex w-full items-center justify-between gap-2.5 rounded-[14px] border bg-white px-3.5 py-2.5 text-left transition-colors duration-150 ${
          empty ? "border-[#5566f6] ring-4 ring-[#5566f6]/15" : "border-[#ececf4]"
        } ${onAction ? "active:bg-[#f5f6ff]" : ""}`}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#9b9fb3]">{label}</span>
          <span className={`line-clamp-2 text-[19px] font-semibold leading-[1.3] [word-break:break-word] ${empty ? "text-[#3848c7]" : "text-[#0b1024]"}`}>
            {value ?? placeholder ?? "Выбрать"}
          </span>
        </span>
        {onAction ? (
          <span className="shrink-0 rounded-full bg-[#f5f6ff] px-3 py-1.5 text-[15px] font-medium text-[#3848c7]">{empty ? "Выбрать" : action ?? "Сменить"}</span>
        ) : null}
      </button>
      {children}
    </div>
  );
}
