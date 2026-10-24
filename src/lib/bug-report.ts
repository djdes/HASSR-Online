import { escapeHtml } from "@/lib/html-escape";

/**
 * Быстрый репорт о проблеме — ярлык с жуком у правого края кабинета.
 *
 * Чистые функции, общие для API и тестов: номер тикета, адрес страницы,
 * с которой пришёл репорт, и подпись к скриншоту в Telegram админу.
 */

export const BUG_REPORT_PAGE_URL_MAX = 2000;

/** Telegram режет подпись к фото на 1024 символах (после разбора HTML). */
const TELEGRAM_CAPTION_LIMIT = 1024;

/**
 * Короткий номер тикета для человека: последние 6 символов cuid
 * заглавными. Админ видит его рядом с якорем `#fb_<id>`, так что
 * «у меня тикет 4KX2QF» находится поиском по чату.
 */
export function ticketCode(reportId: string): string {
  return reportId.slice(-6).toUpperCase();
}

/**
 * Адрес страницы из браузера → только путь + query нашего сайта.
 *
 * Клиент шлёт `location.href`, но доверять хосту нельзя: ссылка уходит
 * в письмо и Telegram админу, и чужой домен там был бы фишингом под
 * видом «страницы с ошибкой». Хост отбрасываем, ссылку собираем от
 * своего `NEXTAUTH_URL`. Фрагмент (`#...`) не нужен для воспроизведения.
 */
export function normalizeReportPagePath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > BUG_REPORT_PAGE_URL_MAX) return null;
  let url: URL;
  try {
    url = new URL(trimmed, "https://placeholder.invalid");
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const path = `${url.pathname}${url.search}`;
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  return path.slice(0, BUG_REPORT_PAGE_URL_MAX);
}

export function absoluteReportPageUrl(path: string, appUrl: string): string {
  return `${appUrl.replace(/\/+$/, "")}${path}`;
}

/**
 * Подпись к вложениям (скриншоту) для админа: тикет, начало текста и
 * страница — скриншот в Telegram читается без поиска исходного сообщения.
 * Длинный текст обрезаем ДО экранирования — сущности вроде `&lt;`
 * Telegram считает одним символом, а обрезка по экранированной строке
 * могла бы разрезать сущность пополам и сломать parse_mode HTML.
 */
export function composeAttachmentCaption(params: {
  reportId: string;
  message: string;
  pageUrl?: string | null;
}): string {
  const head = `📎 <b>Тикет ${ticketCode(params.reportId)}</b> · #fb_${params.reportId}`;
  const page = params.pageUrl ? `\n🔗 ${escapeHtml(params.pageUrl)}` : "";
  // Запас под заголовок, ссылку и переносы — считаем по сырому тексту.
  const reserved =
    `📎 Тикет XXXXXX · #fb_${params.reportId}`.length +
    (params.pageUrl ? params.pageUrl.length + 4 : 0) +
    4;
  const room = Math.max(0, TELEGRAM_CAPTION_LIMIT - reserved);
  const text = params.message.trim();
  const body =
    text.length > room ? `${text.slice(0, Math.max(0, room - 1))}…` : text;
  return `${head}\n\n${escapeHtml(body)}${page}`;
}
