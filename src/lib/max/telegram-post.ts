import { escapeHtml } from "@/lib/html-escape";
import { tagSiteLinks, withUtm } from "./channel-post";

/**
 * Пост в Telegram-канал — чистая логика без сети. Текст пишется один раз
 * в разметке MAX (**жирный**, *курсив*, `код`, ~~зачёркнутый~~,
 * [текст](ссылка)) и для Telegram переводится в HTML (`parse_mode: HTML`).
 *
 * Ограничения Telegram: текст сообщения — до 4096 символов, подпись к
 * фото — до 1024, в альбоме до 10 фото и под альбомом нельзя повесить
 * кнопку. Поэтому длинный текст или несколько картинок уходят двумя
 * сообщениями: сначала фото, следом текст с кнопкой.
 */

export const TELEGRAM_TEXT_LIMIT = 4096;
export const TELEGRAM_CAPTION_LIMIT = 1024;

const LINK = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;

function emphasis(escaped: string): string {
  return escaped
    .replace(/\*\*([^*\n]+?)\*\*/g, "<b>$1</b>")
    .replace(/~~([^~\n]+?)~~/g, "<s>$1</s>")
    .replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?![\w*])/g, "$1<i>$2</i>");
}

function inlineToHtml(segment: string): string {
  let html = "";
  let last = 0;
  for (const match of segment.matchAll(LINK)) {
    const index = match.index ?? 0;
    html += emphasis(escapeHtml(segment.slice(last, index)));
    html += `<a href="${escapeHtml(match[2])}">${emphasis(escapeHtml(match[1]))}</a>`;
    last = index + match[0].length;
  }
  return html + emphasis(escapeHtml(segment.slice(last)));
}

/** Разметка MAX → HTML Telegram; ссылки на wesetup.ru получают UTM. */
export function markdownToTelegramHtml(text: string, campaign: string | null | undefined): string {
  const tagged = tagSiteLinks(text, campaign, "telegram");
  return tagged
    .split(/(`[^`\n]+`)/g)
    .map((part) => (/^`[^`\n]+`$/.test(part) ? `<code>${escapeHtml(part.slice(1, -1))}</code>` : inlineToHtml(part)))
    .join("");
}

/** Сколько символов увидит Telegram (лимиты считаются без тегов). */
export function telegramVisibleLength(html: string): number {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&(lt|gt|amp|quot|#39|#x27);/g, "_").length;
}

export type TelegramPostPlan = {
  /**
   * text — одно сообщение; caption — фото с подписью и кнопкой;
   * photos-then-text — фото (альбом), следом текст с кнопкой.
   */
  mode: "text" | "caption" | "photos-then-text";
  html: string;
  replyMarkup: { inline_keyboard: Array<Array<{ text: string; url: string }>> } | undefined;
};

export function planTelegramPost(post: {
  text: string;
  images: string[];
  buttonText?: string | null;
  buttonUrl?: string | null;
  campaign?: string | null;
}): TelegramPostPlan {
  const html = markdownToTelegramHtml(post.text, post.campaign);
  const buttonText = post.buttonText?.trim();
  const buttonUrl = post.buttonUrl?.trim();
  const replyMarkup =
    buttonText && buttonUrl
      ? { inline_keyboard: [[{ text: buttonText, url: withUtm(buttonUrl, post.campaign, "telegram") }]] }
      : undefined;
  const mode =
    post.images.length === 0
      ? "text"
      : post.images.length === 1 && telegramVisibleLength(html) <= TELEGRAM_CAPTION_LIMIT
        ? "caption"
        : "photos-then-text";
  return { mode, html, replyMarkup };
}

/** Ссылка на сообщение: публичный канал — по имени, закрытый — по id. */
export function telegramMessageUrl(username: string | null, chatId: string, messageId: number): string | null {
  if (username) return `https://t.me/${username}/${messageId}`;
  const internal = /^-100(\d+)$/.exec(chatId)?.[1];
  return internal ? `https://t.me/c/${internal}/${messageId}` : null;
}

/**
 * Что ввели в поле «Канал Telegram»: @wesetup, wesetup, t.me/wesetup или
 * числовой id -100… → то, что понимает Bot API. null — не похоже на канал.
 */
export function normalizeTelegramChannelRef(input: string): string | null {
  const value = input.trim();
  if (/^-100\d{5,15}$/.test(value)) return value;
  const name = value
    .replace(/^https?:\/\//i, "")
    .replace(/^(www\.)?(t|telegram)\.me\//i, "")
    .replace(/^@/, "")
    .replace(/\/+$/, "");
  return /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(name) ? `@${name}` : null;
}
