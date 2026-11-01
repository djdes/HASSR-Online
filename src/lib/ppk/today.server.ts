import { db } from "@/lib/db";
import { loadPpkStatuses } from "./facts.server";
import { parsePpkRecords } from "./records";
import { ppkDueSoon, type PpkReminderItem } from "./reminders";
import { ppkNextStep, ppkProgress } from "./status";
import type { PpkBlockKey } from "./registry";
import { ppkWhere, type PpkScope } from "./scope";

export type PpkTodaySummary = {
  done: number;
  total: number;
  /** Ключ следующего незаполненного блока; null, если всё готово. */
  nextKey: PpkBlockKey | null;
  due: PpkReminderItem[];
};

/** Сегодняшняя дата по Москве (UTC+3, без летнего времени), YYYY-MM-DD — как в cron напоминаний. */
export function moscowToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Данные плашки «Производственный контроль» на главной руководителя. */
export async function loadPpkTodaySummary(
  scope: PpkScope,
  today: string = moscowToday(),
): Promise<PpkTodaySummary> {
  const [statuses, rows] = await Promise.all([
    loadPpkStatuses(scope),
    db.ppkRecord.findMany({
      where: { ...ppkWhere(scope), block: { in: ["lab-plan", "pest-plan"] } },
      select: { id: true, block: true, data: true, sortOrder: true, updatedAt: true },
    }),
  ]);
  const lab = parsePpkRecords("lab-plan", rows.filter((r) => r.block === "lab-plan")).map((r) => r.data);
  const pest = parsePpkRecords("pest-plan", rows.filter((r) => r.block === "pest-plan")).map((r) => r.data);
  const { done, total } = ppkProgress(statuses);
  return {
    done,
    total,
    nextKey: ppkNextStep(statuses)?.key ?? null,
    due: ppkDueSoon({ lab, pest, today }),
  };
}
