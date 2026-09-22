"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import {
  GeneralCleaningMonthPanel,
  describeMonthLoad,
  type GeneralCleaningPanelProps,
} from "@/components/journals/general-cleaning/month-editor";
import { GC_CHIP_TONE } from "@/components/journals/general-cleaning/month-cell";
import { cleaningStatus, monthCleanings } from "@/lib/sanitation-day-document";
import { cn } from "@/lib/utils";
import { MONTH_NAMES_RU } from "@/lib/wheel-date";

type Props = Omit<GeneralCleaningPanelProps, "monthIndex" | "onBack"> & {
  open: boolean;
  onClose: () => void;
};

/**
 * Год одной строки графика на телефоне: двенадцать месяцев с короткой
 * сводкой («4 уборки · 2 выполнены»), нажатие — редактор месяца в том же
 * листе (без листа поверх листа).
 */
export function GeneralCleaningYearSheet({ open, onClose, ...panel }: Props) {
  const [monthIndex, setMonthIndex] = useState<number | null>(null);
  const { row, year, todayKey } = panel;
  const currentMonth = todayKey.startsWith(`${year}-`) ? Number(todayKey.slice(5, 7)) - 1 : -1;

  return (
    <BottomSheet
      open={open}
      onClose={() => {
        setMonthIndex(null);
        onClose();
      }}
      title={
        monthIndex === null
          ? row.roomName || "Помещение"
          : `${MONTH_NAMES_RU[monthIndex]} ${year} · ${row.roomName || "Помещение"}`
      }
      subtitle={
        monthIndex === null
          ? `График генеральных уборок на ${year} год`
          : describeMonthLoad(row, year, monthIndex, todayKey).text
      }
    >
      <div className="px-1 pb-3 pt-1">
        {monthIndex === null ? (
          <ul className="space-y-1">
            {MONTH_NAMES_RU.map((name, index) => {
              const load = describeMonthLoad(row, year, index, todayKey);
              const planned = monthCleanings(row, index, year).planned;
              return (
                <li key={name}>
                  <button
                    type="button"
                    onClick={() => setMonthIndex(index)}
                    className={cn(
                      "flex min-h-[52px] w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-colors duration-150 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
                      index === currentMonth ? "border-[#5566f6]/40 bg-[#fafbff]" : "border-[#ececf4] bg-white",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-[15px] font-medium text-[#0b1024]">
                        {name}
                        {index === currentMonth ? (
                          <span className="rounded-full bg-[#eef1ff] px-2 py-0.5 text-[11px] font-medium text-[#3848c7]">
                            сейчас
                          </span>
                        ) : null}
                      </span>
                      <span className="block text-[12.5px] text-[#6f7282]">
                        {load.text}
                        {load.overdue > 0 ? (
                          <span className="text-[#a13a32]"> · {load.overdue} просроч.</span>
                        ) : null}
                      </span>
                    </span>
                    <span className="flex max-w-[45%] flex-wrap justify-end gap-0.5">
                      {planned.slice(0, 6).map((cleaning) => (
                        <span
                          key={cleaning.id}
                          className={cn(
                            "inline-flex h-5 min-w-[22px] items-center justify-center rounded-md px-1 text-[11px] font-semibold tabular-nums",
                            GC_CHIP_TONE[cleaningStatus(cleaning, todayKey)],
                          )}
                        >
                          {(cleaning.planned as string).slice(8, 10)}
                        </span>
                      ))}
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-[#9b9fb3]" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <GeneralCleaningMonthPanel
            key={`${row.id}-${monthIndex}`}
            {...panel}
            monthIndex={monthIndex}
            onBack={() => setMonthIndex(null)}
          />
        )}
      </div>
    </BottomSheet>
  );
}
