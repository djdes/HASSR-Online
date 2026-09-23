import Link from "next/link";

import {
  INSPECTOR_PERIOD_LABELS,
  formatDayKeyRu,
  type DayWindow,
  type InspectorPeriodPreset,
  type ResolvedPeriod,
} from "@/lib/inspector-qr";

export function periodQuery(period: ResolvedPeriod): string {
  if (period.preset === "custom") return `?p=custom&from=${period.from}&to=${period.to}`;
  return `?p=${period.preset}`;
}

const PRESETS: InspectorPeriodPreset[] = ["today", "7d", "month", "quarter"];

/**
 * Выбор периода без JS: пресеты — ссылки, «свои даты» — GET-форма.
 * Даты за пределами окна доступа сервер всё равно зажмёт.
 */
export function PeriodPicker({
  basePath,
  period,
  window,
}: {
  basePath: string;
  period: ResolvedPeriod;
  window: DayWindow;
}) {
  return (
    <div className="flex flex-col gap-3" data-period-picker>
      <div className="grid grid-cols-4 gap-1.5 sm:flex sm:flex-wrap" role="list">
        {PRESETS.map((p) => {
          const active = period.preset === p;
          return (
            <Link
              key={p}
              role="listitem"
              href={`${basePath}?p=${p}`}
              aria-current={active ? "true" : undefined}
              className={`inline-flex h-9 items-center justify-center rounded-[4px] border px-2 text-[13.5px] sm:px-3.5 sm:text-[14px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1f3a8a]/35 ${
                active
                  ? "border-[#141821] bg-[#141821] text-white"
                  : "border-[#c9cdd5] bg-white text-[#141821] hover:border-[#141821]"
              }`}
            >
              {INSPECTOR_PERIOD_LABELS[p]}
            </Link>
          );
        })}
      </div>
      <form method="get" action={basePath} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="p" value="custom" />
        <label className="flex flex-col gap-1 text-[12.5px] text-[#5b6170]">
          с
          <input
            type="date"
            name="from"
            defaultValue={period.from}
            min={window.from}
            max={window.to}
            className="h-9 rounded-[4px] border border-[#c9cdd5] bg-white px-2 text-[14px] text-[#141821] focus:border-[#1f3a8a] focus:outline-none focus:ring-2 focus:ring-[#1f3a8a]/15"
          />
        </label>
        <label className="flex flex-col gap-1 text-[12.5px] text-[#5b6170]">
          по
          <input
            type="date"
            name="to"
            defaultValue={period.to}
            min={window.from}
            max={window.to}
            className="h-9 rounded-[4px] border border-[#c9cdd5] bg-white px-2 text-[14px] text-[#141821] focus:border-[#1f3a8a] focus:outline-none focus:ring-2 focus:ring-[#1f3a8a]/15"
          />
        </label>
        <button
          type="submit"
          className={`h-9 rounded-[4px] border px-3.5 text-[14px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1f3a8a]/35 ${
            period.preset === "custom"
              ? "border-[#141821] bg-[#141821] text-white"
              : "border-[#c9cdd5] bg-white text-[#141821] hover:border-[#141821]"
          }`}
        >
          {INSPECTOR_PERIOD_LABELS.custom}
        </button>
      </form>
      <p className="text-[12.5px] text-[#8a8f9c]">
        Доступны даты с {formatDayKeyRu(window.from)} по {formatDayKeyRu(window.to)}.
      </p>
    </div>
  );
}
