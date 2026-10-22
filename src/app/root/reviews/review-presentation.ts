import type { useTranslations } from "next-intl";
import { formatDate, type Locale } from "@/i18n/locales";
import type { ReviewView } from "@/lib/balance/review-view";

export type ReviewCopy = ReturnType<typeof useTranslations<"rootReviews">>;
export type RootReviewView = ReviewView & { organizationTypeOrigin?: string | null };
const KIND_KEYS = { text: "kindText", photo: "kindPhoto", video: "kindVideo" } as const;
const SPHERE_KEYS = {
  restaurant: "sphereRestaurant", cafe: "sphereCafe", bar: "sphereBar",
  canteen: "sphereCanteen", fastfood: "sphereFastfood", bakery: "sphereBakery",
  catering: "sphereCatering", hotel: "sphereHotel", retail: "sphereRetail",
  gas_station: "sphereGasStation", education: "sphereEducation", medical: "sphereMedical",
  production: "sphereProduction", fitness: "sphereFitness", beauty: "sphereBeauty",
  meat: "sphereProduction", dairy: "sphereProduction", confectionery: "sphereBakery",
  school: "sphereEducation", hospital: "sphereMedical",
} as const;

/** Origin is supplied only by the opt-in ROOT loader, never inferred from visible text. */
export function reviewSphere(review: RootReviewView, t: ReviewCopy): string {
  const origin = review.organizationTypeOrigin?.trim().toLowerCase();
  return review.organizationSphere && origin && Object.hasOwn(SPHERE_KEYS, origin)
    ? t(SPHERE_KEYS[origin as keyof typeof SPHERE_KEYS])
    : review.organizationSphere ?? "";
}

export function reviewKindLabel(kind: string, t: ReviewCopy): string {
  return Object.hasOwn(KIND_KEYS, kind) ? t(KIND_KEYS[kind as keyof typeof KIND_KEYS]) : kind;
}

export function formatReviewDate(value: string, locale: Locale): string {
  const date = new Date(value);
  if (locale === "ru" || !Number.isFinite(date.getTime())) return date.toLocaleDateString("ru-RU");
  return formatDate(locale, date, new Intl.DateTimeFormat().resolvedOptions().timeZone);
}

export function localizedReviewSocialText(review: RootReviewView, t: ReviewCopy): string {
  const author = review.anonymous ? t("anonymousAuthor") : review.authorName;
  const place = review.anonymous ? reviewSphere(review, t) : review.place;
  const lines = [`«${review.text}»`, "", `— ${[author, place].filter(Boolean).join(", ")}`];
  if (review.mediaUrl) lines.push("", review.mediaUrl);
  lines.push("", t("clipboardBrand"));
  return lines.join("\n");
}
