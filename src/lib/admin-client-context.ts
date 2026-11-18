/**
 * Хвост уведомления продажам о действии клиента: строка места с местным
 * временем и ссылка «Открыть» на клиента в админке (спека
 * tg-client-location-2026-11). Чистые функции — проверяются тестом.
 */

import { escapeHtml } from "@/lib/html-escape";

export type AdminClientInfo = {
  /** «🇷🇺 Россия, Барнаул · 09:29» (`clientLocationLine`), без экранирования. */
  location: string | null;
  /** Абсолютная ссылка на карточку клиента в /root. */
  adminUrl: string | null;
  /** Откуда пришёл клиент, коротко: «Поиск Яндекса» (`signupSourceShort`). */
  source?: string | null;
};

export function adminAppUrl(): string {
  return (process.env.NEXTAUTH_URL || process.env.APP_URL || "https://wesetup.ru").replace(/\/+$/, "");
}

/** Карточка организации в админке. */
export function adminOrganizationUrl(organizationId: string): string {
  return `${adminAppUrl()}/root/organizations/${encodeURIComponent(organizationId)}`;
}

/** Карточка контакта CRM — когда кабинета у клиента нет. */
export function adminCrmContactUrl(contactId: string): string {
  return `${adminAppUrl()}/root/crm/contacts/${encodeURIComponent(contactId)}`;
}

/** `<a href="…">Открыть</a>` для Telegram (parse_mode HTML) и письма. */
export function adminOpenLink(url: string, label = "Открыть"): string {
  return `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
}

/**
 * Дописывает к тексту уведомления источник визита, место клиента и
 * «Открыть» (спеки tg-client-location-2026-11, visit-source-2026-11). Уже есть в
 * тексте — не дублирует. Место встаёт перед ссылками в конце текста
 * (панель обращений, модерация), «Открыть» — последней строкой; при своей
 * ссылке в тексте наша подписана «Открыть клиента», чтобы их не путать.
 */
export function appendAdminClientLines(text: string, info: AdminClientInfo | null | undefined): string {
  if (!info) return text;
  const lines = text.replace(/\s+$/, "").split("\n");
  let tail = lines.length;
  while (tail > 0 && /^\s*<a\s/i.test(lines[tail - 1])) tail -= 1;
  const body = lines.slice(0, tail);
  const links = lines.slice(tail);
  // Источник — один раз: у заявки на показ своя строка «Источник:».
  if (info.source && !/(^|\n)Источник:/.test(text)) body.push(`Источник: ${escapeHtml(info.source)}`);
  if (info.location) {
    const location = escapeHtml(info.location);
    if (!text.includes(location) && !text.includes(info.location)) body.push(location);
  }
  if (info.adminUrl && !text.includes(escapeHtml(info.adminUrl)) && !text.includes(info.adminUrl)) {
    links.push(adminOpenLink(info.adminUrl, /<a\s/i.test(text) ? "Открыть клиента" : "Открыть"));
  }
  return [...body, ...links].join("\n");
}
