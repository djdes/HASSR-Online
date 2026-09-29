import { NICHES } from "@/content/niches";
import { nicheLandingForSphere } from "@/lib/badge/niche-link";
import type { OrgSphere } from "@/lib/org-profile";
import { normalizePromoCode } from "@/lib/promo/rules";

import { isProposalPromoExpired } from "./price";
import type { ProposalVars } from "./types";

/**
 * Куда ведут кнопка и QR КП.
 *
 *   • есть промокод (и он не истёк) → `https://wesetup.ru/promo/<CODE>?s=<sphere>`.
 *     Маршрут и сохранение кода делает соседняя задача promo-personal —
 *     адрес зафиксирован контрактом, не менять;
 *   • промокода нет → нишевая страница сферы (`/dlya-kafe` и т. п.):
 *     регистрация сферу из адреса не принимает (`register-client.tsx`
 *     читает только email/next/source/journal/ref), а на нишевой
 *     странице — описание для этой сферы и кнопка регистрации. Для
 *     «Другое» ниши нет — сразу `/register`;
 *   • `vars.ctaUrl` — явная ссылка вызывающего (рассылка), только http(s).
 *
 * Адреса — боевого сайта: КП уходит клиентам, а в рабочей копии
 * `NEXTAUTH_URL` смотрит на localhost.
 */

export const PROPOSAL_SITE_ORIGIN = "https://wesetup.ru";

export type ProposalCtaKind = "promo" | "landing" | "custom";

export type ProposalCta = { url: string; kind: ProposalCtaKind };

/** Контракт promo-personal: `https://wesetup.ru/promo/<CODE>?s=<sphere>`. */
export function proposalPromoUrl(code: string, sphere: OrgSphere | null | undefined): string {
  const normalized = normalizePromoCode(code);
  const base = `${PROPOSAL_SITE_ORIGIN}/promo/${encodeURIComponent(normalized)}`;
  return sphere ? `${base}?s=${encodeURIComponent(sphere)}` : base;
}

const NICHE_SLUG_BY_SPHERE: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const niche of Object.values(NICHES)) {
    if (!map.has(niche.sphere)) map.set(niche.sphere, niche.slug);
  }
  return map;
})();

/** Нишевая страница сферы: «/dlya-kafe»; у «Другое» — «/register». */
export function sphereLandingPath(sphere: OrgSphere): string {
  const slug = NICHE_SLUG_BY_SPHERE.get(sphere);
  if (slug) return `/${slug}`;
  const fallback = nicheLandingForSphere(sphere);
  return fallback === "/journals-info" ? "/register" : fallback;
}

/** Только абсолютные http(s)-адреса: `javascript:` и относительные не пропускаем. */
export function isSafeAbsoluteUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function proposalCta(vars: Pick<ProposalVars, "sphere" | "promo" | "ctaUrl">, now: Date = new Date()): ProposalCta {
  if (isSafeAbsoluteUrl(vars.ctaUrl)) return { url: vars.ctaUrl, kind: "custom" };
  const promo = vars.promo;
  if (promo && promo.code && !isProposalPromoExpired(promo, now)) {
    return { url: proposalPromoUrl(promo.code, vars.sphere), kind: "promo" };
  }
  return { url: `${PROPOSAL_SITE_ORIGIN}${sphereLandingPath(vars.sphere)}`, kind: "landing" };
}

/** Короткий адрес для текста: «wesetup.ru/dlya-kafe». */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
