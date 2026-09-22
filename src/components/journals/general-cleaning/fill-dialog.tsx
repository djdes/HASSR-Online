"use client";

import { useMemo, useState } from "react";
import { CalendarRange } from "lucide-react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  applyGeneralCleaningOp,
  diffCleaningPlans,
  type GeneralCleaningOp,
} from "@/lib/general-cleaning-ops";
import { describeGeneralSchedule, type RoomGeneralSchedule } from "@/lib/general-cleaning-schedule";
import type { SanitationDayConfig } from "@/lib/sanitation-day-document";
import { cn } from "@/lib/utils";
import { formatDayMonth } from "@/lib/wheel-date";

type Mode = "fill-empty" | "replace-future";

const MODES: Array<{ value: Mode; title: string; hint: string }> = [
  {
    value: "fill-empty",
    title: "Только пустые месяцы",
    hint: "Месяцы без дат заполнятся с сегодняшнего дня. Уже составленный план не меняется.",
  },
  {
    value: "replace-future",
    title: "Обновить будущие даты",
    hint: "Будущие невыполненные даты заменятся датами по графику. Прошлое и отметки не трогаем.",
  },
];

function plural(count: number, one: string, few: string, many: string) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function datesPreview(dates: string[]): string {
  const shown = dates.slice(0, 4).map(formatDayMonth).join(", ");
  return dates.length > 4 ? `${shown} и ещё ${dates.length - 4}` : shown;
}

/**
 * «Заполнить план по графику помещений» — с живым предпросмотром: что
 * добавится и что уйдёт по каждой строке, прежде чем нажать кнопку.
 * Считает тот же редьюсер, что применит сервер (`applyGeneralCleaningOp`).
 */
export function GeneralCleaningFillDialog({
  onClose,
  config,
  schedules,
  todayKey,
  onConfirm,
}: {
  onClose: () => void;
  config: SanitationDayConfig;
  schedules: ReadonlyMap<string, RoomGeneralSchedule | null>;
  todayKey: string;
  onConfirm: (op: GeneralCleaningOp) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<Mode>("fill-empty");
  const op = useMemo<GeneralCleaningOp>(
    () => ({ type: "fillFromSchedule", mode, fromDate: todayKey }),
    [mode, todayKey],
  );
  const diff = useMemo(() => {
    try {
      const result = applyGeneralCleaningOp(config, op, { todayKey, userId: null, schedules });
      return diffCleaningPlans(config, result.config);
    } catch {
      return new Map<string, { added: string[]; removed: string[] }>();
    }
  }, [config, op, schedules, todayKey]);

  let added = 0;
  let removed = 0;
  for (const change of diff.values()) {
    added += change.added.length;
    removed += change.removed.length;
  }
  const total = added + removed;

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={async () => {
        if (await onConfirm(op)) onClose();
      }}
      icon={CalendarRange}
      title="Заполнить план по графику помещений"
      description="Даты берутся из карточек помещений (дни генеральной уборки). Прошедшие дни и отметки о выполнении не меняются."
      confirmLabel={
        total > 0
          ? `Заполнить: +${added}${removed > 0 ? ` / −${removed}` : ""}`
          : "Менять нечего"
      }
      confirmDisabled={total === 0}
    >
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Как заполнять">
          {MODES.map((item) => (
            <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={mode === item.value}
              onClick={() => setMode(item.value)}
              className={cn(
                "rounded-2xl border px-3.5 py-3 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
                mode === item.value
                  ? "border-[#5566f6] bg-[#f5f6ff]"
                  : "border-[#dcdfed] bg-white hover:border-[#5566f6]/40 hover:bg-[#fafbff]",
              )}
            >
              <div className="text-[13.5px] font-semibold text-[#0b1024]">{item.title}</div>
              <div className="mt-0.5 text-[12px] leading-[1.45] text-[#6f7282]">{item.hint}</div>
            </button>
          ))}
        </div>
        <ul className="max-h-[260px] space-y-1 overflow-y-auto">
          {config.rows.map((row) => {
            const schedule = row.roomId ? schedules.get(row.roomId) ?? null : null;
            const change = diff.get(row.id);
            let status: { text: string; tone: string };
            if (!row.roomId || !schedules.has(row.roomId)) {
              status = { text: "не связана с помещением — пропустим", tone: "text-[#a13a32]" };
            } else if (!schedule) {
              status = { text: "в карточке помещения нет графика — пропустим", tone: "text-[#6f7282]" };
            } else if (!change) {
              status = { text: "уже по графику", tone: "text-[#6f7282]" };
            } else {
              const parts: string[] = [];
              if (change.added.length > 0) {
                parts.push(
                  `+${change.added.length} ${plural(change.added.length, "дата", "даты", "дат")}: ${datesPreview(change.added)}`,
                );
              }
              if (change.removed.length > 0) {
                parts.push(`уйдут: ${datesPreview(change.removed)}`);
              }
              status = { text: parts.join("; "), tone: "text-[#116b2a]" };
            }
            return (
              <li key={row.id} className="rounded-xl border border-[#ececf4] bg-white px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[13px] font-medium text-[#0b1024]">
                    {row.roomName || "Помещение"}
                  </span>
                  {schedule ? (
                    <span className="shrink-0 text-[11.5px] text-[#6f7282]">
                      {describeGeneralSchedule(schedule)}
                    </span>
                  ) : null}
                </div>
                <div className={cn("text-[12px] leading-[1.45]", status.tone)}>{status.text}</div>
              </li>
            );
          })}
        </ul>
      </div>
    </ConfirmDialog>
  );
}
