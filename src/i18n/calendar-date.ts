import data from "./calendar-data/uz.json";

type Pattern = typeof data.patterns[keyof typeof data.patterns];
type Width = "long" | "short" | "narrow";
type CivilDate = { year: number; month: number; day: number; beforeCommonEra?: boolean };
const capability = new WeakMap<typeof Intl.DateTimeFormat, boolean>();

function shapeKey(options: Intl.DateTimeFormatOptions | undefined, effectiveOptions: Intl.DateTimeFormatOptions): string | null {
  if (options && Object.getPrototypeOf(options) !== Object.prototype && Object.getPrototypeOf(options) !== null) return null;
  return Object.getOwnPropertyNames(effectiveOptions).map(key => [key, effectiveOptions[key as keyof Intl.DateTimeFormatOptions]] as const)
    .filter(([key, value]) => key !== "timeZone" && value !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => `${key}:${value}`).join("|");
}

function renderCivil(pattern: Pattern, civil: CivilDate): string {
  const fields = pattern.fields as Partial<Record<"year" | "month" | "day" | "weekday", string>>;
  const weekday = new Date(0);
  const astronomicalYear = civil.beforeCommonEra ? 1 - civil.year : civil.year;
  // Gregorian weekdays repeat every 400 years; keep the surrogate inside Date's range.
  const weekdayYear = 2000 + ((astronomicalYear % 400) + 400) % 400;
  weekday.setUTCFullYear(weekdayYear, civil.month - 1, civil.day);
  const numeric = (value: number, width: string | undefined) => width === "2-digit" ? String(value).padStart(2, "0") : String(value);
  const monthWidth = fields.month;
  const month = monthWidth === "long" || monthWidth === "short" || monthWidth === "narrow"
    ? data.months[pattern.monthContext as "standalone" | "format"][monthWidth][civil.month - 1]
    : numeric(civil.month, monthWidth);
  const values: Record<string, string> = {
    year: String(civil.year), month, day: numeric(civil.day, fields.day),
    weekday: fields.weekday ? data.weekdays[fields.weekday as Width][weekday.getUTCDay()] : "",
  };
  return pattern.pattern.replace(/\{(year|month|day|weekday)\}/g, (_, field: string) => values[field]);
}

function hasCalendarData(Formatter: typeof Intl.DateTimeFormat): boolean {
  const cached = capability.get(Formatter);
  if (cached !== undefined) return cached;
  let healthy = true;
  for (const [key, pattern] of Object.entries(data.patterns)) {
    const options = Object.fromEntries(key ? key.split("|").map(item => item.split(":")) : []) as Intl.DateTimeFormatOptions;
    const formatter = new Formatter("uz-Latn-UZ", { ...options, timeZone: "UTC" });
    const dates = [
      ...Array.from({ length: 12 }, (_, month) => ({ year: 2026, month: month + 1, day: 1 })),
      ...Array.from({ length: 7 }, (_, day) => ({ year: 2026, month: 10, day: day + 11 })),
    ];
    if (dates.some(civil => formatter.format(Date.UTC(civil.year, civil.month - 1, civil.day)) !== renderCivil(pattern, civil))) {
      healthy = false;
      break;
    }
  }
  capability.set(Formatter, healthy);
  return healthy;
}

/** Date-only compatibility for the explicit app shapes; all other Intl options stay native. */
export function formatCalendarDate(
  formatLocale: string,
  value: Date | number,
  timeZone: string,
  options?: Intl.DateTimeFormatOptions,
  Formatter: typeof Intl.DateTimeFormat = Intl.DateTimeFormat,
): string {
  // Validate first and retain native output/error behavior, even on the fallback path.
  const effectiveOptions = { ...options, timeZone };
  const native = new Formatter(formatLocale, effectiveOptions).format(value);
  if (formatLocale !== "uz-Latn-UZ") return native;
  const key = shapeKey(options, effectiveOptions);
  if (key === null || !Object.hasOwn(data.patterns, key) || hasCalendarData(Formatter)) return native;
  const parts = new Formatter("en-GB", {
    calendar: "gregory", numberingSystem: "latn", timeZone,
    year: "numeric", month: "numeric", day: "numeric", era: "short",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value;
  return renderCivil(data.patterns[key as keyof typeof data.patterns], {
    year: Number(part("year")), month: Number(part("month")), day: Number(part("day")),
    beforeCommonEra: part("era") === "BC",
  });
}
