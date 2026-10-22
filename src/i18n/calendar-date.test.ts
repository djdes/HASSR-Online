import assert from "node:assert/strict";
import { test } from "node:test";
import { formatCalendarDate } from "./calendar-date";
import data from "./calendar-data/uz.json";

const shapes = Object.keys(data.patterns).map(key => Object.fromEntries(key ? key.split("|").map(item => item.split(":")) : []) as Intl.DateTimeFormatOptions);
function implementation(mode: "healthy" | "deficient" | "wrongOrder") {
  let constructions = 0;
  const Formatter = function (locale: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
    constructions++;
    const native = new Intl.DateTimeFormat(mode === "deficient" && locale === "uz-Latn-UZ" ? "en-US" : locale, options);
    if (mode !== "wrongOrder" || locale !== "uz-Latn-UZ") return native;
    return new Proxy(native, {
      get(target, property) {
        if (property === "format") return (value: Date | number) => target.formatToParts(value).reverse().map(part => part.value).join("");
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  } as unknown as typeof Intl.DateTimeFormat;
  return { Formatter, count: () => constructions };
}

test("all frozen date shapes preserve healthy bytes and repair missing data/order in isolated implementations", () => {
  const variants = [implementation("healthy"), implementation("deficient"), implementation("wrongOrder")];
  const dates = [
    ...Array.from({ length: 12 }, (_, month) => new Date(Date.UTC(2026, month, 1))),
    ...Array.from({ length: 7 }, (_, day) => new Date(Date.UTC(2026, 9, day + 11))),
    new Date("2024-02-29T23:30:00Z"), new Date("2026-12-31T21:30:00Z"),
    new Date("2026-03-29T00:30:00Z"), new Date("2026-03-29T01:30:00Z"),
    new Date("0099-01-01T00:00:00Z"), new Date("0001-01-01T00:00:00Z"),
  ];
  for (const locale of ["ru-RU", "en-GB", "uz-Latn-UZ"]) for (const timeZone of ["UTC", "Europe/Moscow", "Asia/Tashkent", "Europe/Berlin", "America/Los_Angeles"]) for (const date of dates) for (const options of shapes) {
    const timestamp = date.getTime();
    const expected = new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(date);
    for (const variant of variants) assert.equal(formatCalendarDate(locale, date, timeZone, options, variant.Formatter), expected, `${locale}/${timeZone}/${date.toISOString()}/${JSON.stringify(options)}`);
    assert.equal(date.getTime(), timestamp);
  }
});

test("constructor cache is isolated and current timezone/options always remain authoritative", () => {
  for (const mode of ["healthy", "deficient", "wrongOrder"] as const) {
    const variant = implementation(mode);
    const date = Date.parse("2026-12-31T21:30:00Z");
    const options: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long", timeZone: "America/Los_Angeles" };
    assert.equal(formatCalendarDate("uz-Latn-UZ", date, "Europe/Moscow", options, variant.Formatter), "juma, 1-yanvar");
    const previous = variant.count();
    assert.equal(formatCalendarDate("uz-Latn-UZ", date, "UTC", options, variant.Formatter), "payshanba, 31-dekabr");
    assert.equal(variant.count() - previous, mode === "healthy" ? 1 : 2);
  }
});

test("unsupported option combinations and time-only calls retain native implementation behavior", () => {
  const variant = implementation("deficient");
  const date = new Date("2026-10-16T21:30:00Z");
  const shapes: Intl.DateTimeFormatOptions[] = [
    { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
    { dateStyle: "full" }, { day: "numeric", month: "long", hour: "numeric" },
    { month: "long", calendar: "islamic" }, { month: "long", numberingSystem: "arab" },
    { day: "numeric", month: "long", era: "long" }, { year: "numeric" },
    { timeZoneName: "long" }, { month: "long", formatMatcher: "basic" },
    Object.create({ month: "long", calendar: "islamic" }) as Intl.DateTimeFormatOptions,
  ];
  for (const options of shapes) {
    const expected = new variant.Formatter("uz-Latn-UZ", { ...options, timeZone: "UTC" }).format(date);
    assert.equal(formatCalendarDate("uz-Latn-UZ", date, "UTC", options, variant.Formatter), expected);
  }
});

test("invalid values/zones/options preserve native error constructors and messages before fallback", () => {
  const variant = implementation("deficient");
  const cases: [Date | number, string, Intl.DateTimeFormatOptions?][] = [
    [new Date(NaN), "UTC"], [NaN, "UTC"], [Infinity, "UTC"],
    [0, "Invalid/Timezone"], [0, "UTC", { month: "invalid" as "long" }],
    [0, "UTC", { dateStyle: "full", month: "long" }],
  ];
  for (const locale of ["ru-RU", "en-GB", "uz-Latn-UZ"]) for (const [value, zone, options] of cases) {
    let expected: unknown;
    try { new variant.Formatter(locale, { ...options, timeZone: zone }).format(value); } catch (error) { expected = error; }
    assert.ok(expected instanceof Error);
    assert.throws(() => formatCalendarDate(locale, value, zone, options, variant.Formatter), error => error instanceof Error && error.constructor === expected.constructor && error.message === expected.message);
  }
});

test("valid extreme instants retain Gregorian weekdays when local civil dates exceed Date bounds", () => {
  const variants = [implementation("healthy"), implementation("deficient"), implementation("wrongOrder")];
  const values = [
    -8640000000000000, -8639999999999999, 8639999999999999, 8640000000000000, 0,
    Date.parse("0000-01-01T00:00:00Z"), Date.parse("0001-01-01T00:00:00Z"),
    Date.parse("0099-12-31T23:30:00Z"), Date.parse("-000001-01-01T00:00:00Z"),
    Date.parse("0000-02-29T00:00:00Z"), Date.parse("-000400-02-29T00:00:00Z"),
  ];
  for (const locale of ["ru-RU", "en-GB", "uz-Latn-UZ"]) for (const timeZone of ["UTC", "America/Los_Angeles", "Pacific/Honolulu", "Pacific/Kiritimati", "Europe/Moscow", "Asia/Tashkent"]) for (const value of values) for (const options of shapes) {
    const expected = new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(value);
    for (const variant of variants) for (const input of [value, new Date(value)]) {
      assert.equal(formatCalendarDate(locale, input, timeZone, options, variant.Formatter), expected, `${locale}/${timeZone}/${value}/${JSON.stringify(options)}`);
      if (input instanceof Date) assert.equal(input.getTime(), value);
    }
  }
  for (const value of [-8640000000000001, 8640000000000001]) for (const variant of variants) {
    assert.throws(() => formatCalendarDate("uz-Latn-UZ", value, "UTC", { weekday: "long" }, variant.Formatter), RangeError);
  }
});

test("only the effective enumerable option copy determines the fallback shape", () => {
  const date = Date.parse("2026-10-16T00:00:00Z");
  const cases: Intl.DateTimeFormatOptions[] = [
    Object.defineProperty({}, "month", { value: "long", enumerable: false }),
    Object.defineProperty({ day: "numeric", month: "long" }, "weekday", { value: "long", enumerable: false }),
    Object.defineProperty({ month: "long" }, "day", { value: "numeric", enumerable: false }),
    Object.defineProperty({ month: "long" }, "calendar", { value: "islamic", enumerable: false }),
    Object.defineProperty({ month: "long" }, "monthIgnored", { get() { throw new Error("hidden getter must not run"); }, enumerable: false }),
    Object.assign(Object.create(null), { weekday: "long", day: "numeric", month: "long" }),
  ];
  for (const mode of ["healthy", "deficient", "wrongOrder"] as const) {
    const variant = implementation(mode);
    for (const locale of ["ru-RU", "en-GB", "uz-Latn-UZ"]) for (const options of cases) {
      const expected = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(date);
      assert.equal(formatCalendarDate(locale, date, "UTC", options, variant.Formatter), expected);
    }
  }
});

test("enumerable option getters are evaluated once and the captured values drive both paths", () => {
  const date = Date.parse("2026-10-16T00:00:00Z");
  for (const mode of ["healthy", "deficient", "wrongOrder"] as const) for (const locale of ["ru-RU", "en-GB", "uz-Latn-UZ"]) {
    const variant = implementation(mode);
    let monthReads = 0, zoneReads = 0, symbolReads = 0;
    const options: Intl.DateTimeFormatOptions = {
      get month() { return ++monthReads === 1 ? "long" : "numeric"; },
      get timeZone() { zoneReads++; return "Invalid/Overridden"; },
    };
    Object.defineProperty(options, Symbol("copied"), { enumerable: true, get() { symbolReads++; return "ignored"; } });
    const expected = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(date);
    assert.equal(formatCalendarDate(locale, date, "UTC", options, variant.Formatter), expected);
    assert.deepEqual([monthReads, zoneReads, symbolReads], [1, 1, 1]);
  }
});

test("throwing enumerable getters retain their exact error before native construction", () => {
  for (const locale of ["ru-RU", "en-GB", "uz-Latn-UZ"]) {
    const variant = implementation("deficient"), failure = new Error("caller getter failure");
    let reads = 0;
    const options: Intl.DateTimeFormatOptions = { get month(): "long" { reads++; throw failure; } };
    assert.throws(() => formatCalendarDate(locale, 0, "UTC", options, variant.Formatter), error => error === failure);
    assert.equal(reads, 1);
    assert.equal(variant.count(), 0);
  }
});

test("custom prototypes remain outside the envelope and inherited getters stay unread", () => {
  const date = Date.parse("2026-10-16T00:00:00Z");
  for (const mode of ["healthy", "deficient", "wrongOrder"] as const) {
    const variant = implementation(mode);
    const prototype = { get calendar() { throw new Error("inherited getter must not run"); } };
    const options = Object.assign(Object.create(prototype), { month: "long" }) as Intl.DateTimeFormatOptions;
    const expected = new variant.Formatter("uz-Latn-UZ", { ...options, timeZone: "UTC" }).format(date);
    assert.equal(formatCalendarDate("uz-Latn-UZ", date, "UTC", options, variant.Formatter), expected);
  }
});
