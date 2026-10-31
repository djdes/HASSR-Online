/**
 * Журнал маркировки (2026-10-31): этикетки из «Сетап помощника» на сайте.
 * Чистые функции — статус срока и период; чтение из БД — на страницах.
 */

/** «Истекает» — меньше суток до «годен до». */
export const LABEL_SOON_MS = 24 * 60 * 60 * 1000;
/** Сводка «истёк срок» — за последние 7 дней: старше — уже история. */
export const LABEL_EXPIRED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type LabelStatus = "ok" | "soon" | "expired" | "none";

export function labelStatus(until: Date | null, now: Date): LabelStatus {
  if (!until) return "none";
  const left = until.getTime() - now.getTime();
  if (left <= 0) return "expired";
  return left <= LABEL_SOON_MS ? "soon" : "ok";
}

export const LABEL_PERIODS = ["today", "7d", "30d"] as const;
export type LabelPeriod = (typeof LABEL_PERIODS)[number];

export function parseLabelPeriod(value: unknown): LabelPeriod {
  return LABEL_PERIODS.includes(value as LabelPeriod) ? (value as LabelPeriod) : "today";
}

/** Начало периода: `todayStart` — полночь сегодня в зоне организации. */
export function labelPeriodStart(period: LabelPeriod, todayStart: Date): Date {
  const days = period === "today" ? 0 : period === "7d" ? 6 : 29;
  return new Date(todayStart.getTime() - days * 24 * 60 * 60 * 1000);
}

export type LabelField = { label: string; value: string };

/** `LabelPrint.fields` — JSON с телефона; берём только пары строк. */
export function readLabelFields(value: unknown): LabelField[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { label, value: text } = item as Record<string, unknown>;
    return typeof label === "string" && typeof text === "string" && label && text ? [{ label, value: text }] : [];
  });
}
