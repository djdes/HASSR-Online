/**
 * Главная кабинета руководителя (`/home`, эскиз 2026-10-28, лист 1): знак
 * «сетап», «Ваш электронный ХАССП», контакты, «Начальная настройка» и три
 * слота «Избранного». Модуль без БД и React: его читают страница, API и тесты.
 */

import { hasCapability } from "@/lib/permission-presets";
import type { NavModelSection } from "@/lib/app-nav.server";

export const HOME_HREF = "/home";

/** Сколько слотов «Избранного» на главной. */
export const HOME_FAVORITES_MAX = 3;

/** Телефон на главной (эскиз). */
export const HOME_PHONE = { display: "8 (925) 305-80-77", tel: "+79253058077" };

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
 * Что можно закрепить: пункты меню человека (без пунктов-разделов — у них
 * свой корень) и корни разделов без меню. Адрес встречается один раз.
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
    if (!section.menu) {
      add({ href: section.rootHref, label: section.label, icon: section.icon, sectionLabel: section.label });
      continue;
    }
    for (const group of section.menu) {
      for (const item of group.items) {
        if (item.section) continue;
        add({ href: item.href, label: item.label, icon: item.icon, sectionLabel: section.label });
      }
    }
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
