const formats = new Map<string, Intl.DateTimeFormat>();

function timestampFormat(timeZone: string): Intl.DateTimeFormat {
  let format = formats.get(timeZone);
  if (!format) {
    try {
      format = new Intl.DateTimeFormat("ru-RU", { timeZone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    } catch {
      return timestampFormat("Europe/Moscow");
    }
    formats.set(timeZone, format);
  }
  return format;
}

/**
 * Audit timestamps are instants; show the same journal time in UI and PDF —
 * in the organization's time zone (spec tg-client-location-2026-11), Moscow by default.
 */
export function formatChecklistTimestamp(value: Date | string, timeZone = "Europe/Moscow"): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(date.getTime())) return "—";
  const parts = Object.fromEntries(timestampFormat(timeZone || "Europe/Moscow").formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.day}-${parts.month}-${parts.year}, ${parts.hour}:${parts.minute}`;
}
