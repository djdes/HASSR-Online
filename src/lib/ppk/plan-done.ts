import type { LabPlanItem, PestPlanItem } from "./records";
import { labNextDate, pestNextDate } from "./sanitation";

type PlanBlock = "lab-plan" | "pest-plan";

/**
 * Отметка «выполнено сегодня» для пункта плана: у лаборатории сдвигается `lastDate`
 * (следующий срок считается от него), у дезинсекции ещё пересчитывается `nextDate`
 * по периодичности. Исходные данные не меняются.
 */
export function markPlanDone(block: PlanBlock, data: LabPlanItem | PestPlanItem, todayYmd: string): LabPlanItem | PestPlanItem {
  if (block === "lab-plan") return { ...(data as LabPlanItem), lastDate: todayYmd };
  const pest = data as PestPlanItem;
  return { ...pest, lastDate: todayYmd, nextDate: pestNextDate(pest.frequency, todayYmd) };
}

/** Ближайший срок после отметки (для текста ответа); null — срок не считается. */
export function nextDueAfterDone(block: PlanBlock, data: LabPlanItem | PestPlanItem): string | null {
  return block === "lab-plan" ? labNextDate(data as LabPlanItem) : (data as PestPlanItem).nextDate;
}

/** Сегодняшняя дата по Москве (UTC+3, без перехода на летнее время), YYYY-MM-DD. */
export function moscowToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
