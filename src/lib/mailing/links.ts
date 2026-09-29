import { absoluteUrl, isSafeLinkUrl } from "@/lib/mailing/text-format";

/**
 * Учёт кликов по ссылкам рассылки.
 *
 * В письме каждая ссылка заменена на `https://…/r/<token>/<n>`. Сам адрес
 * при этом НЕ в ссылке: при подготовке письма он записывается в список
 * ссылок получателя (`MailingRecipient.links`), и редирект берёт его
 * только оттуда по номеру. Подставить в `/r/…` свой адрес нельзя —
 * открытого редиректа нет.
 */

export const MAX_TRACKED_LINKS = 50;

export function clickPath(token: string, index: number): string {
  return `/r/${encodeURIComponent(token)}/${index}`;
}

/**
 * Трекер ссылок одного получателя: номер ссылки стабилен (повторная —
 * тот же номер), список потом сохраняется у получателя.
 */
export function createLinkTracker(appUrl: string, token: string, initial: readonly string[] = []) {
  const links = [...initial];
  const base = appUrl.replace(/\/+$/, "");
  return {
    links,
    track(url: string): string {
      const value = url.trim();
      if (!isSafeLinkUrl(value)) return absoluteUrl(value, base);
      let index = links.indexOf(value);
      if (index === -1) {
        if (links.length >= MAX_TRACKED_LINKS) return absoluteUrl(value, base);
        links.push(value);
        index = links.length - 1;
      }
      return `${base}${clickPath(token, index)}`;
    },
  };
}

/**
 * Куда вести по клику: только адрес из сохранённого списка получателя.
 * Номер — целое 0…49; что-то другое или небезопасный адрес — null.
 */
export function resolveTrackedLink(storedLinks: unknown, indexRaw: string | null | undefined): string | null {
  if (!Array.isArray(storedLinks)) return null;
  const raw = (indexRaw ?? "").trim();
  if (!/^\d{1,2}$/.test(raw)) return null;
  const index = Number(raw);
  if (index >= storedLinks.length || index >= MAX_TRACKED_LINKS) return null;
  const url = storedLinks[index];
  if (typeof url !== "string" || !isSafeLinkUrl(url)) return null;
  return url.trim();
}
