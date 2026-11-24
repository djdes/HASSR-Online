/**
 * Журнал исходящих писем (`OutgoingEmail`, спека client-mail-templates-2026-11-24):
 * чистые функции — кому записывать, что из текста можно хранить.
 *
 * В журнал попадает то, что видят сотрудники панели в «Переписках» клиента,
 * поэтому секретов там быть не должно: письма с кодом, паролем или ссылкой
 * входа отправитель помечает `sensitive` — их текст не хранится вовсе, а в
 * остальных письмах у ссылок срезаются query, fragment и сегменты-токены
 * (ссылки отписки, приглашений, кликов рассылки).
 */

export const OUTGOING_EMAIL_TEXT_LIMIT = 20_000;
const SUBJECT_LIMIT = 500;
const ERROR_LIMIT = 1_000;

export type OutgoingEmailAttachmentInfo = { filename: string; size: number; contentType: string };

export type OutgoingEmailInput = {
  to: string | readonly string[];
  subject: string;
  text: string | null | undefined;
  /** Код, пароль или ссылка входа: текст не сохраняется. */
  sensitive?: boolean;
  via: "system" | "personal";
  fromEmail?: string | null;
  senderUserId?: string | null;
  attachments?: readonly { filename?: string | null; content?: unknown; size?: number | null; contentType?: string | null }[] | null;
  status: "sent" | "failed";
  error?: string | null;
  messageId?: string | null;
};

export type OutgoingEmailRow = {
  to: string;
  via: "system" | "personal";
  fromEmail: string | null;
  senderUserId: string | null;
  subject: string;
  text: string | null;
  attachmentsJson: OutgoingEmailAttachmentInfo[] | null;
  status: "sent" | "failed";
  error: string | null;
  messageId: string | null;
};

const ADDRESS = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

/** «Анна <Anna@Mail.ru>, b@x.ru» → ["anna@mail.ru", "b@x.ru"]; мусор отбрасывается. */
export function outgoingEmailRecipients(to: string | readonly string[]): string[] {
  const parts = (Array.isArray(to) ? to : [to]).flatMap((item) => String(item ?? "").split(/[,;]/));
  const out: string[] = [];
  for (const part of parts) {
    const inBrackets = /<([^<>]+)>/.exec(part)?.[1];
    const address = (inBrackets ?? part).trim().toLowerCase();
    if (address.length <= 254 && ADDRESS.test(address) && !out.includes(address)) out.push(address);
  }
  return out;
}

/**
 * Сегмент пути похож на токен. Слова через дефис (`kak-vesti-zhurnal`,
 * `wesetup-presentation.pdf`) — не токен; длинная строка или смесь букв и
 * цифр в одном слове (`cmwdgd42y…`, `<id>.<подпись>`) — токен.
 */
function tokenLike(segment: string): boolean {
  let value = segment;
  try {
    value = decodeURIComponent(segment);
  } catch {
    // оставить как есть
  }
  const base = value.replace(/\.[a-z0-9]{1,5}$/i, "");
  const words = base.split(/[-_]/);
  if (/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(base) && words.every((part) => /^[a-z]+$/.test(part) || /^\d{1,8}$/.test(part))) return false;
  if (value.length >= 20) return true;
  return value.length >= 12 && /\d/.test(value) && /[a-z]/i.test(value);
}

/** Ссылка без query, fragment и токенов: `https://wesetup.ru/invite/…`. */
export function redactUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return raw;
  const segments = url.pathname.split("/");
  const cut = segments.findIndex((segment) => segment && tokenLike(segment));
  const path = cut >= 0 ? `${segments.slice(0, cut).join("/")}/…` : url.pathname;
  const hidden = cut >= 0 || url.search.length > 1 || url.hash.length > 1;
  const clean = `${url.origin}${path === "/" && !hidden ? "" : path}`;
  return hidden && cut < 0 ? `${clean}?…` : clean;
}

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'«»)\]]+/gi;

/** Текст письма для журнала: ссылки без секретов, лишние пробелы, ограничение длины. */
export function redactOutgoingEmailText(text: string): string {
  const cleaned = text
    .replace(URL_PATTERN, (match) => {
      // Точка или запятая в конце — знак препинания, а не часть ссылки.
      const tail = /[.,;:!?]+$/.exec(match)?.[0] ?? "";
      return redactUrl(match.slice(0, match.length - tail.length)) + tail;
    })
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned.length > OUTGOING_EMAIL_TEXT_LIMIT ? `${cleaned.slice(0, OUTGOING_EMAIL_TEXT_LIMIT - 1).trimEnd()}…` : cleaned;
}

function attachmentInfo(items: OutgoingEmailInput["attachments"]): OutgoingEmailAttachmentInfo[] | null {
  if (!items?.length) return null;
  return items.map((item) => {
    const content = item.content;
    const size =
      typeof item.size === "number" && Number.isFinite(item.size)
        ? item.size
        : typeof content === "string"
          ? Buffer.byteLength(content)
          : content instanceof Uint8Array
            ? content.byteLength
            : 0;
    return { filename: String(item.filename || "file").slice(0, 200), size, contentType: String(item.contentType || "application/octet-stream").slice(0, 100) };
  });
}

/** Строки журнала: по одной на получателя. Пустой список — записывать нечего. */
export function outgoingEmailRows(input: OutgoingEmailInput): OutgoingEmailRow[] {
  const recipients = outgoingEmailRecipients(input.to);
  if (!recipients.length) return [];
  const subject = String(input.subject ?? "").replace(/\s+/g, " ").trim().slice(0, SUBJECT_LIMIT);
  const text = input.sensitive ? null : input.text ? redactOutgoingEmailText(input.text) : "";
  const attachmentsJson = attachmentInfo(input.attachments);
  return recipients.map((to) => ({
    to,
    via: input.via,
    fromEmail: outgoingEmailRecipients(input.fromEmail ?? "")[0] ?? null,
    senderUserId: input.senderUserId ?? null,
    subject,
    text,
    attachmentsJson,
    status: input.status,
    error: input.error ? String(input.error).slice(0, ERROR_LIMIT) : null,
    messageId: input.messageId?.trim() || null,
  }));
}
