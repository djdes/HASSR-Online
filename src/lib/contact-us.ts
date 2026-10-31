/**
 * Контакты окна «Свяжитесь с нами» — его открывают вместо цены услуги
 * (владелец, 2026-10-29: «где указаны цены на услуги, кроме тарифов, —
 * „Свяжитесь с нами“ и по клику контакты крупно»).
 *
 * Модуль без БД и React: адрес Telegram вычисляет сервер (переменная
 * окружения) и передаёт в клиентское окно пропом.
 */

import { HOME_PHONE, homeContacts } from "@/lib/home-page";
import { SUPPORT_EMAIL } from "@/lib/support-chat-bus";

/** Телефон — тот же, что на главной кабинета. */
export const CONTACT_PHONE = HOME_PHONE;

/** Почта поддержки. */
export const CONTACT_EMAIL = SUPPORT_EMAIL;

/** Telegram WeSetup, уже открытый на сайте (подвал, лендинг). */
export const CONTACT_TELEGRAM_FALLBACK = "https://t.me/wesetupbot";

/**
 * Telegram отдела продаж (`WESETUP_TG_SALES_URL`, только `https://t.me/...`),
 * пока его нет — бот WeSetup.
 */
export function contactTelegramUrl(env: Record<string, string | undefined>): string {
  const sales = homeContacts(env).find((contact) => contact.id === "sales");
  return sales?.external ? sales.href : CONTACT_TELEGRAM_FALLBACK;
}

/**
 * MAX — по настройке `NEXT_PUBLIC_WESETUP_MAX_URL` (переменная сборки: адрес
 * публичный, и так он доходит до окна на всех страницах без пропов). Только
 * `https://max.ru/…`; иначе — null, и строки MAX в окне нет.
 */
export function contactMaxUrl(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.hostname !== "max.ru" || url.pathname.length <= 1) return null;
    return url.toString();
  } catch {
    return null;
  }
}
