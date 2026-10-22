import { FORMAT_LOCALES, type Locale } from "@/i18n/locales";
import type { KpPromoOption } from "@/lib/mailing/kinds/kp-shared";
import { promotionEndLabel } from "@/lib/promo/promotions";

const SPHERE_KEYS = {
  restaurant: "spheres.restaurant", cafe: "spheres.cafe", bar: "spheres.bar",
  canteen: "spheres.canteen", fastfood: "spheres.fastfood", bakery: "spheres.bakery",
  catering: "spheres.catering", hotel: "spheres.hotel", retail: "spheres.retail",
  gas_station: "spheres.gas_station", education: "spheres.education", medical: "spheres.medical",
  production: "spheres.production", fitness: "spheres.fitness", beauty: "spheres.beauty", other: "spheres.other",
} as const;

/** Only known enum values enter the supplied shell catalog; extensions remain raw. */
export function fieldSphereKey(value: string): (typeof SPHERE_KEYS)[keyof typeof SPHERE_KEYS] | null {
  return Object.hasOwn(SPHERE_KEYS, value) ? SPHERE_KEYS[value as keyof typeof SPHERE_KEYS] : null;
}

export function fieldSphereLabel(value: string, rawLabel: string, translate: (key: NonNullable<ReturnType<typeof fieldSphereKey>>) => string): string {
  const key = fieldSphereKey(value);
  return key ? translate(key) : rawLabel;
}

export function fieldNumber(value: number, locale: Locale): string {
  return value.toLocaleString(FORMAT_LOCALES[locale === "uz" && Number.isFinite(value) ? "ru" : locale]);
}

/** Personal summary retains the outbound helper's NBSP; option labels retain normal spaces. */
export function fieldDiscountLabel(kind: "percent" | "fixed", value: number, locale: Locale, option = false): string {
  const space = option ? " " : "\u00a0";
  return `−${kind === "percent" ? String(value) : fieldNumber(value, locale)}${space}${kind === "percent" ? "%" : "₽"}`;
}

export type FieldOptionArguments = {
  code: string; discount: string; term: "lifetime" | "dated" | "none"; end: string;
  uses: "limited" | "unlimited"; count: string; clients: "new" | "all";
};

/** Reconstruct managed framing from typed data; never parse the legacy producer label. */
export function fieldPromoOptionLabel(option: KpPromoOption, locale: Locale, translate: (args: FieldOptionArguments) => string): string {
  if (option.kind !== "percent" && option.kind !== "fixed") return option.label;
  return translate({
    code: option.code,
    discount: fieldDiscountLabel(option.kind, option.value, locale, true),
    term: option.lifetime ? "lifetime" : option.endsAt ? "dated" : "none",
    end: !option.lifetime && option.endsAt ? promotionEndLabel(option.endsAt, locale) : "",
    uses: option.usesLeft !== null ? "limited" : "unlimited",
    count: option.usesLeft === null ? "" : String(option.usesLeft),
    clients: option.newClientsOnly ? "new" : "all",
  });
}
