/**
 * Главная кабинета руководителя (`/home`, эскиз 2026-10-28, лист 1): знак
 * «сетап», «Ваш электронный ХАССП», контакты, «Начальная настройка» и три
 * слота «Избранного». Модуль без БД и React: его читают страница, API и тесты.
 */

import { COMPANY_MOBILE, COMPANY_PHONES } from "@/lib/company-contacts";
import { hasCapability } from "@/lib/permission-presets";
import type { NavModelSection } from "@/lib/app-nav.server";
import { sectionEntryHref } from "@/lib/nav-layout";

export const HOME_HREF = "/home";

/**
 * Сколько страниц в «Избранном» (было три слота; 2026-11-23 — звёздочка у
 * любого пункта меню, до семи страниц: второй ряд карточек на главной).
 */
export const HOME_FAVORITES_MAX = 7;

/** Сколько карточек «Избранного» на главной: не меньше трёх, одна пустая «Добавить», пока есть место. */
export function homeFavoriteSlots(filled: number): number {
  return Math.max(3, Math.min(HOME_FAVORITES_MAX, filled + 1));
}

/** Телефоны на главной: основной и мобильный, как на визитке (2026-11-06). */
export const HOME_PHONES = COMPANY_PHONES;

/** Телефон в письме после регистрации — мобильный. */
export const HOME_PHONE = COMPANY_MOBILE;

type HomeActor = { permissionPreset?: string | null; role?: string | null; isRoot?: boolean | null };

/**
 * Главная — у основного аккаунта: владелец и управляющая (`admin.full`).
 * Остальных она уводит на прежнюю домашнюю (`getWebHomeHref`).
 */
export function canSeeHomePage(actor: HomeActor): boolean {
  return actor.isRoot === true || hasCapability(actor, "admin.full");
}

/** Страница, которую можно закрепить в «Избранном». */
export type FavoriteCandidate = { href: string; label: string; icon: string; sectionLabel: string };

/**
 * Что можно закрепить — любой пункт меню человека (2026-11-23: «при наведении
 * на любое меню — звёздочка»): пункты разделов и их вкладки, вложенные разделы
 * (своим названием) и корни разделов. Адрес встречается один раз: у адреса,
 * который есть и пунктом, и корнем раздела, — подпись пункта.
 */
export function favoriteCandidates(sections: readonly NavModelSection[]): FavoriteCandidate[] {
  const result: FavoriteCandidate[] = [];
  const seen = new Set<string>();
  const add = (candidate: FavoriteCandidate) => {
    if (seen.has(candidate.href)) return;
    seen.add(candidate.href);
    result.push(candidate);
  };
  for (const section of sections) {
    for (const group of section.menu ?? []) {
      for (const item of group.items) {
        add({ href: item.href, label: item.label, icon: item.icon, sectionLabel: section.label });
        if (item.section) continue;
        for (const tab of item.tabs ?? []) {
          add({ href: tab.href, label: tab.label, icon: item.icon, sectionLabel: item.label });
        }
      }
    }
    add({ href: sectionEntryHref(section), label: section.label, icon: section.icon, sectionLabel: section.label });
  }
  return result;
}

/**
 * Список избранного к сохранению: только адреса из `allowed`, без повторов,
 * не больше `HOME_FAVORITES_MAX`. Мусор (не строки) отбрасывается.
 */
export function normalizeFavorites(input: unknown, allowed: ReadonlySet<string>): string[] {
  if (!Array.isArray(input)) return [];
  const result: string[] = [];
  for (const value of input) {
    if (typeof value !== "string" || !allowed.has(value) || result.includes(value)) continue;
    result.push(value);
    if (result.length === HOME_FAVORITES_MAX) break;
  }
  return result;
}

/** Строка контактов главной: Telegram, если адрес задан, иначе — страница кабинета. */
export type HomeContact = { id: "support" | "sales" | "consulting"; href: string; external: boolean };

/** Только `https://t.me/...` — иначе строка ведёт в кабинет. */
function telegramUrl(value: string | undefined): string | null {
  const url = value?.trim();
  return url && /^https:\/\/t\.me\/[A-Za-z0-9_+/?=&.-]+$/.test(url) ? url : null;
}

/**
 * Поддержка, отдел продаж, консалтинг. Адреса Telegram — переменные
 * окружения (`WESETUP_TG_*_URL`); пока их нет: поддержка — чат на сайте,
 * продажи — тариф, консалтинг — «Подготовка с экспертом».
 */
export function homeContacts(env: Record<string, string | undefined>): HomeContact[] {
  const rows: { id: HomeContact["id"]; env: string; fallback: string }[] = [
    { id: "support", env: "WESETUP_TG_SUPPORT_URL", fallback: `${HOME_HREF}?support=chat` },
    { id: "sales", env: "WESETUP_TG_SALES_URL", fallback: "/settings/subscription" },
    { id: "consulting", env: "WESETUP_TG_CONSULTING_URL", fallback: "/inspection/experts" },
  ];
  return rows.map((row) => {
    const url = telegramUrl(env[row.env]);
    return { id: row.id, href: url ?? row.fallback, external: Boolean(url) };
  });
}
