"use client";

import { Search, X } from "lucide-react";
import { useRef } from "react";

import { cn } from "@/lib/utils";

/**
 * Поле поиска по списку — тот же вид, что у поиска журналов
 * (`dashboard-journals-grid.tsx`): лупа слева, `h-12 rounded-2xl`,
 * крестик «Очистить», справа «Найдено N из M», пока есть запрос.
 * Escape очищает запрос. На телефоне поле во всю ширину.
 */
export function SearchField({
  value,
  onChange,
  placeholder,
  ariaLabel,
  found,
  total,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  /** Сколько нашлось — показывается вместе с `total`, пока запрос не пустой. */
  found?: number;
  total?: number;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const searching = value.trim().length > 0;
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-center", className)} data-search-field="">
      <div className="relative w-full sm:max-w-[420px]">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]" aria-hidden />
        <input
          ref={inputRef}
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && value) {
              event.preventDefault();
              onChange("");
            }
          }}
          placeholder={placeholder}
          aria-label={ariaLabel}
          enterKeyHint="search"
          autoComplete="off"
          className="h-12 w-full rounded-2xl border border-[#dcdfed] bg-white pl-11 pr-11 text-[15px] text-[#0b1024] placeholder:truncate placeholder:text-[#c1c5d6] max-sm:text-[14px] shadow-[0_0_0_1px_rgba(240,240,250,0.45)] transition-[border-color,box-shadow] duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 [&::-webkit-search-cancel-button]:appearance-none"
        />
        {value ? (
          <button
            type="button"
            onClick={() => {
              onChange("");
              inputRef.current?.focus();
            }}
            aria-label="Очистить поиск"
            className="absolute right-2 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-[#9b9fb3] transition-colors duration-150 hover:bg-[#f5f6ff] hover:text-[#5566f6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 touch:min-w-8"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>
      {searching && found !== undefined && total !== undefined ? (
        <div className="text-[13px] text-[#6f7282] sm:whitespace-nowrap" role="status" data-search-count="">
          Найдено {found} из {total}
        </div>
      ) : null}
    </div>
  );
}
