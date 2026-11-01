/**
 * Пауза между напоминаниями руководителя в Max (2026-11-01): у каждой точки
 * своя. Раньше одна отметка на организацию — руководитель точки А на
 * полчаса блокировал напоминание руководителю точки Б.
 *
 * `MaxOrganizationIntegration.lastReminderByPoint` = { [ключ области]: ISO-время }.
 * Ключ — точка руководителя (несколько точек — через «+»), «org» — вся
 * компания. Пока карты нет (до выкладки), действует старая общая отметка.
 */
export const REMIND_INTERVAL_MS = 30 * 60_000;
/** Отметки старше суток не храним — карта не разрастается. */
const KEEP_MS = 24 * 60 * 60_000;

export function remindScopeKey(scope: { points: readonly string[] } | null): string {
  return scope && scope.points.length > 0 ? [...scope.points].sort().join("+") : "org";
}

function asMap(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  for (const [key, at] of Object.entries(value as Record<string, unknown>)) {
    if (typeof at === "string" && Number.isFinite(Date.parse(at))) out[key] = at;
  }
  return out;
}

/** Последнее напоминание области: из карты, а без карты — общая старая отметка. */
export function lastReminderFor(map: unknown, key: string, legacy: Date | null | undefined): Date | null {
  const parsed = asMap(map);
  if (!parsed || Object.keys(parsed).length === 0) return legacy ?? null;
  return parsed[key] ? new Date(parsed[key]) : null;
}

/** Сколько минут ждать до следующего напоминания; null — можно сейчас. */
export function remindWaitMinutes(last: Date | null, now: number = Date.now()): number | null {
  if (!last) return null;
  const left = last.getTime() + REMIND_INTERVAL_MS - now;
  return left > 0 ? Math.ceil(left / 60_000) : null;
}

/** Карта после напоминания области: своя отметка — сейчас, старые — выброшены. */
export function withReminder(map: unknown, key: string, now: Date): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [entry, at] of Object.entries(asMap(map) ?? {})) {
    if (now.getTime() - Date.parse(at) < KEEP_MS) next[entry] = at;
  }
  next[key] = now.toISOString();
  return next;
}
