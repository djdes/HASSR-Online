import type { Locale } from "@/i18n/locales";

export type MailingLocale = Locale;

const BILLING_KEYS = {
  paid: "billing.paid",
  free: "billing.free",
  free_period: "billing.free_period",
  needs_decision: "billing.needs_decision",
  legacy: "billing.legacy",
  exempt: "billing.exempt",
} as const;

const SPHERE_KEYS = {
  restaurant: "spheres.restaurant",
  cafe: "spheres.cafe",
  bar: "spheres.bar",
  canteen: "spheres.canteen",
  fastfood: "spheres.fastfood",
  bakery: "spheres.bakery",
  catering: "spheres.catering",
  hotel: "spheres.hotel",
  retail: "spheres.retail",
  gas_station: "spheres.gas_station",
  education: "spheres.education",
  medical: "spheres.medical",
  production: "spheres.production",
  fitness: "spheres.fitness",
  beauty: "spheres.beauty",
  other: "spheres.other",
} as const;

export function billingDisplayKey(value: string): (typeof BILLING_KEYS)[keyof typeof BILLING_KEYS] | null {
  return Object.hasOwn(BILLING_KEYS, value) ? BILLING_KEYS[value as keyof typeof BILLING_KEYS] : null;
}

export function sphereDisplayKey(value: string): (typeof SPHERE_KEYS)[keyof typeof SPHERE_KEYS] | null {
  return Object.hasOwn(SPHERE_KEYS, value) ? SPHERE_KEYS[value as keyof typeof SPHERE_KEYS] : null;
}

/** Preserve bare JSX counters, including an absent response total; never group or default to zero. */
export function literalMailingCounter(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

/** The audience date is Moscow date-only; healthy UZ uses the measured numeric en-GB profile. */
export function formatMailingDate(iso: string | null, locale: MailingLocale): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const options: Intl.DateTimeFormatOptions = { timeZone: "Europe/Moscow" };
  if (locale === "ru") return date.toLocaleDateString("ru-RU", options);
  if (locale === "uz" && !Number.isFinite(date.getTime())) return date.toLocaleDateString("uz", options);
  return date.toLocaleDateString("en-GB", options);
}

/** Preserve the original host-local save clock, distinct from the Moscow audience date. */
export function formatMailingSaveClock(timestamp: number, locale: MailingLocale): string {
  return new Date(timestamp).toLocaleTimeString(locale === "ru" ? "ru-RU" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
