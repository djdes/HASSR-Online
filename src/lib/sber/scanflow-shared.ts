/** Чистые помощники канала ScanFlow — без БД и сети, проверяются тестами. */

export const digitsOnly = (value: unknown): string => String(value ?? "").replace(/\D+/g, "");

/** UTC-строка ScanFlow («2026-11-05 14:32:32», без пояса) → ISO; пусто или мусор — null. */
export function scanflowUtcToIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = new Date(`${String(value).trim().replace(" ", "T")}Z`).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Токен истекает в ближайшие 2 минуты. Срок неизвестен — не трогаем. */
export function isExpiringSoon(expiresAt: string | null | undefined, nowMs: number): boolean {
  const iso = scanflowUtcToIso(expiresAt);
  if (!iso) return false;
  return Date.parse(iso) - nowMs < 2 * 60_000;
}

/** Сколько полных дней до даты (отрицательное — уже прошла). */
export function daysUntil(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor((t - nowMs) / 86_400_000) : null;
}
