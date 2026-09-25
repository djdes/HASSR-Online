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
          <span className={`line-clamp-2 text-[21px] font-semibold leading-[1.3] [word-break:break-word] ${empty ? "text-[#3848c7]" : "text-[#0b1024]"}`}>
            {value ?? placeholder ?? "Выбрать"}
          </span>
        </span>
        {onAction ? (
          // Крупная и по центру карточки по вертикали: в неё попадают пальцем на ходу.
          <span className="inline-flex h-11 shrink-0 items-center self-center rounded-full bg-[#eef1ff] px-4 text-[16px] font-semibold text-[#3848c7]">{empty ? "Выбрать" : action ?? "Сменить"}</span>
        ) : null}
      </button>
      {children}
    </div>
  );
}
