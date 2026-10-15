"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
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

type Mode = "fill-empty" | "replace-future";

function datesPreview(
  dates: string[],
  locale: string,
  moreLabel: (count: number) => string,
): string {
  const shown = dates.slice(0, 4).map((value) => new Intl.DateTimeFormat(locale === "uz" ? "uz-Latn-UZ" : locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`))).join(", ");
  return dates.length > 4 ? `${shown} ${moreLabel(dates.length - 4)}` : shown;
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
  const locale = useLocale();
  const t = useTranslations("cleaningGrid.cleaning");
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
      title={t("fillPlanTitle")}
      description={t("fillPlanDescription")}
      confirmLabel={
        total > 0
          ? removed > 0 ? t("fillCountBoth", { added, removed }) : t("fillCountAdded", { count: added })
          : t("fillNothing")
      }
      confirmDisabled={total === 0}
    >
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t("fillHow")}>
          {(["fill-empty", "replace-future"] as const).map((modeValue) => {
            const title = modeValue === "fill-empty" ? t("onlyEmptyMonths") : t("replaceFutureDates");
            const hint = modeValue === "fill-empty" ? t("onlyEmptyMonthsHint") : t("replaceFutureDatesHint");
            return (
            <button
              key={modeValue}
              type="button"
              role="radio"
              aria-checked={mode === modeValue}
              onClick={() => setMode(modeValue)}
              className={cn(
                "rounded-2xl border px-3.5 py-3 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
                mode === modeValue
                  ? "border-[#5566f6] bg-[#f5f6ff]"
                  : "border-[#dcdfed] bg-white hover:border-[#5566f6]/40 hover:bg-[#fafbff]",
              )}
            >
              <div className="text-[13.5px] font-semibold text-[#0b1024]">{title}</div>
              <div className="mt-0.5 text-[12px] leading-[1.45] text-[#6f7282]">{hint}</div>
            </button>
          );})}
        </div>
        <ul className="max-h-[260px] space-y-1 overflow-y-auto">
          {config.rows.map((row) => {
            const schedule = row.roomId ? schedules.get(row.roomId) ?? null : null;
            const change = diff.get(row.id);
            let status: { text: string; tone: string };
            if (!row.roomId || !schedules.has(row.roomId)) {
              status = { text: t("skipUnlinked"), tone: "text-[#a13a32]" };
            } else if (!schedule) {
              status = { text: t("skipNoSchedule"), tone: "text-[#6f7282]" };
            } else if (!change) {
              status = { text: t("alreadyScheduled"), tone: "text-[#6f7282]" };
            } else {
              const parts: string[] = [];
              if (change.added.length > 0) {
                parts.push(
                  t("addedDates", {
                    count: change.added.length,
                    dates: datesPreview(change.added, locale, (count) => t("andMoreDates", { count })),
                  }),
                );
              }
              if (change.removed.length > 0) {
                parts.push(t("removedDates", {
                  dates: datesPreview(change.removed, locale, (count) => t("andMoreDates", { count })),
                }));
              }
              status = { text: parts.join("; "), tone: "text-[#116b2a]" };
            }
            return (
              <li key={row.id} className="rounded-xl border border-[#ececf4] bg-white px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[13px] font-medium text-[#0b1024]">
                    {row.roomName || t("room")}
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
