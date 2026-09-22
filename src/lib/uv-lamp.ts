/**
 * УФ-лампы (бактерицидные облучатели) — чистая часть (2026-09-22):
 * справочник типовых ламп с ресурсом по паспорту, остаток ресурса и
 * пороги предупреждений.
 *
 * Значения ресурса — типовые из паспортов распространённых ламп; для
 * конкретной лампы правильное значение — в её паспорте, поэтому поле
 * можно поправить.
 */
export type LampPreset = { key: string; label: string; hours: number };

export const LAMP_PRESETS: readonly LampPreset[] = [
  { key: "db-lamp", label: "Лампа ДБ 15 / 30 / 36 (облучатели ОБН, ОБП)", hours: 8000 },
  { key: "tuv", label: "Philips TUV 15W / 30W / 36W", hours: 9000 },
  { key: "hns", label: "OSRAM HNS 15W / 30W", hours: 9000 },
  { key: "recirculator", label: "Рециркулятор (Дезар, Армед и др.)", hours: 9000 },
  { key: "drb", label: "Облучатель ДРБ-8 / ДРБ-16", hours: 8000 },
  { key: "other", label: "Другая — ресурс из паспорта", hours: 8000 },
];

export const UV_LAMP_TYPE = "uv_lamp";

/** Порог «скоро конец ресурса» — осталось 10 % и меньше. */
export const LAMP_WARN_SHARE = 0.1;

export function isUvLampType(type: string | null | undefined): boolean {
  if (!type) return false;
  const value = type.trim().toLowerCase();
  return value === UV_LAMP_TYPE || /(^|[^a-zа-я])(уф|uv|бактерицид|облучател)/i.test(value);
}

export function lampRemainingHours(lifetimeHours: number | null | undefined, usedHours: number): number | null {
  if (!lifetimeHours || lifetimeHours <= 0) return null;
  return Math.max(0, lifetimeHours - usedHours);
}

export type LampWarnLevel = "warn" | "over" | null;

export function lampWarnLevel(lifetimeHours: number | null | undefined, usedHours: number): LampWarnLevel {
  const remaining = lampRemainingHours(lifetimeHours, usedHours);
  if (remaining === null) return null;
  if (remaining <= 0) return "over";
  if (remaining <= (lifetimeHours as number) * LAMP_WARN_SHARE) return "warn";
  return null;
}

/** Нужно ли отправить предупреждение: порог новый и «хуже» отправленного. */
export function shouldSendLampWarning(level: LampWarnLevel, alreadySent: string | null | undefined): boolean {
  if (!level) return false;
  if (!alreadySent) return true;
  return alreadySent === "warn" && level === "over";
}

/** Часы сеанса «включил → выключил». */
export function sessionHours(startedAt: Date, endedAt: Date): number {
  const ms = endedAt.getTime() - startedAt.getTime();
  return ms > 0 ? Math.round((ms / 3_600_000) * 100) / 100 : 0;
}

/** «1 ч 20 мин», «35 мин», «6 540 ч». */
export function formatDuration(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} мин`;
  if (m === 0) return `${h} ч`;
  return `${h} ч ${m} мин`;
}

export function formatHours(hours: number): string {
  return `${Math.round(hours).toLocaleString("ru-RU")} ч`;
}
