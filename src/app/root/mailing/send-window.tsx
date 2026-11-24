"use client";

import { Clock } from "lucide-react";

import { FilterSelect } from "./ui";

export type SendWindow = { windowStart: number; windowEnd: number };

/** Окно новой рассылки — как в YesBeat: 09:00–21:00 по Москве. */
export const DEFAULT_SEND_WINDOW: SendWindow = { windowStart: 9, windowEnd: 21 };

const pad = (h: number) => `${String(h).padStart(2, "0")}:00`;
const START_OPTIONS = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: pad(h) }));
const END_OPTIONS = Array.from({ length: 24 }, (_, i) => ({ value: String(i + 1), label: i + 1 === 24 ? "24:00" : pad(i + 1) }));

/**
 * Часы отправки рассылки по Москве: вне них очередь ждёт начала окна
 * (ночью рекламу не шлём). «Круглосуточно» — 00:00–24:00.
 */
export function SendWindowField({ value, onChange }: { value: SendWindow; onChange: (next: SendWindow) => void }) {
  const invalid = value.windowEnd <= value.windowStart;
  return (
    <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3" data-testid="send-window">
      <div className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-[#3c4053]">
        <Clock className="size-4 text-[#5566f6]" /> Часы отправки, время московское
      </div>
      <div className="grid grid-cols-2 gap-2">
        <FilterSelect
          label="С"
          value={String(value.windowStart)}
          onChange={(v) => onChange({ ...value, windowStart: Number(v) })}
          options={START_OPTIONS}
          testId="send-window-start"
        />
        <FilterSelect
          label="До"
          value={String(value.windowEnd)}
          onChange={(v) => onChange({ ...value, windowEnd: Number(v) })}
          options={END_OPTIONS}
          testId="send-window-end"
        />
      </div>
      <p className={invalid ? "mt-2 text-[12px] text-[#a13a32]" : "mt-2 text-[12px] text-[#6f7282]"}>
        {invalid
          ? "Начало должно быть раньше конца."
          : value.windowStart === 0 && value.windowEnd === 24
            ? "Круглосуточно: очередь отправляет в любое время."
            : "Вне этих часов получатели ждут утра — ночью реклама не уходит."}
      </p>
    </div>
  );
}
