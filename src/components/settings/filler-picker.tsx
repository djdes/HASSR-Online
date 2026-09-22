"use client";

import { useMemo, useState } from "react";
import { Check, Search, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";

export type FillerOption = { id: string; name: string; position: string | null; management: boolean };

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * «Кто заполняет» объект по QR (2026-09-22). Пусто — все сотрудники.
 * Руководство заполняет любой объект и в выборе не нужно — показано
 * отдельной строкой-подсказкой.
 */
export function FillerPicker({
  value,
  onChange,
  options,
  objectNoun = "объект",
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  options: FillerOption[];
  objectNoun?: string;
}) {
  const [query, setQuery] = useState("");
  const selected = useMemo(() => new Set(value), [value]);
  const staff = options.filter((option) => !option.management);
  const q = query.trim().toLowerCase();
  const visible = staff
    .filter((option) => !q || option.name.toLowerCase().includes(q) || (option.position ?? "").toLowerCase().includes(q))
    .sort((a, b) => Number(selected.has(b.id)) - Number(selected.has(a.id)) || a.name.localeCompare(b.name, "ru"));
  const toggle = (id: string) => onChange(selected.has(id) ? value.filter((item) => item !== id) : [...value, id]);

  return (
    <div className="space-y-2" data-testid="filler-picker">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[14px] font-medium text-[#0b1024]">Кто заполняет по QR</span>
        {value.length > 0 ? (
          <button type="button" onClick={() => onChange([])} className="text-[13px] text-[#3848c7] transition-colors duration-150 hover:text-[#0b1024]">
            Снять всех
          </button>
        ) : null}
      </div>
      <p className="text-[12.5px] leading-[1.5] text-[#6f7282]">
        {value.length === 0
          ? `Сейчас — любой сотрудник. Выберите людей, чтобы ${objectNoun} мог заполнить только они: у остальных на наклейке их имени не будет, а чужой PIN не подойдёт.`
          : `Заполнять могут только выбранные (${value.length}) и руководство. Остальным наклейка откажет даже с верным PIN.`}
      </p>
      {staff.length > 6 ? (
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Найти по фамилии или должности"
            className="h-10 w-full rounded-2xl border border-[#dcdfed] bg-white pl-9 pr-3 text-[14px] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
          />
        </label>
      ) : null}
      <div className="max-h-[240px] space-y-1 overflow-y-auto rounded-2xl border border-[#ececf4] bg-[#fafbff] p-1.5">
        {visible.length === 0 ? <div className="px-3 py-2 text-[13px] text-[#9b9fb3]">Никого не нашли</div> : null}
        {visible.map((option) => {
          const on = selected.has(option.id);
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => toggle(option.id)}
              aria-pressed={on}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors duration-150",
                on ? "bg-[#eef1ff]" : "hover:bg-white"
              )}
            >
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold",
                  on ? "bg-[#5566f6] text-white" : "bg-[#eef1ff] text-[#3848c7]"
                )}
              >
                {on ? <Check className="size-4" /> : initialsOf(option.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] text-[#0b1024]">{option.name}</span>
                {option.position ? <span className="block truncate text-[12px] text-[#6f7282]">{option.position}</span> : null}
              </span>
            </button>
          );
        })}
      </div>
      <p className="flex items-start gap-1.5 text-[12px] leading-[1.5] text-[#6f7282]">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-[#116b2a]" />
        Руководство и сотрудники с «Разрешением менять настройки» заполняют любой объект.
      </p>
    </div>
  );
}
