/**
 * Чистые помощники уведомлений администраторам платформы: адресаты и
 * письмо из текста Telegram-уведомления. Без БД и транспорта — для тестов.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** «a@x.ru, b@y.ru» → ["a@x.ru", "b@y.ru"]. */
export function parseEmailList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Адреса без дублей (регистр не важен) в порядке появления. Служебные
 * `*.local` (приглашённые без почты, демо) и мусор отбрасываются.
 */
export function mergeAdminEmails(lists: ReadonlyArray<ReadonlyArray<string | null | undefined>>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const raw of list) {
      const email = raw?.trim();
      if (!email || !EMAIL_RE.test(email)) continue;
      const key = email.toLowerCase();
      if (key.endsWith(".local") || seen.has(key)) continue;
      seen.add(key);
      out.push(email);
    }
  }
  return out;
}

/** Chat id без дублей и пустых. */
export function mergeChatIds(lists: ReadonlyArray<ReadonlyArray<string | null | undefined>>): string[] {
  const out = new Set<string>();
  for (const list of lists) {
    for (const raw of list) {
      const id = raw?.trim();
      if (id) out.add(id);
    }
  }
  return Array.from(out);
}

const ENTITIES: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&amp;": "&" };

/** Telegram-HTML → простой текст (для темы письма). */
export function telegramHtmlToPlain(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&(lt|gt|quot|#39|amp);/g, (entity) => ENTITIES[entity] ?? entity);
}

const ALLOWED_TAGS = new Set(["b", "strong", "i", "em", "u", "s", "code", "pre", "blockquote", "a"]);

/**
 * Telegram-HTML уведомления → безопасный HTML письма. Тексты собираются с
 * `escapeTelegramHtml`, поэтому остаются только теги разметки Telegram;
 * из них пропускаем знакомые (у ссылки — только http(s)-адрес), прочее
 * вырезаем. Переводы строк → `<br>`.
 */
export function telegramHtmlToEmailHtml(html: string): string {
  const cleaned = html.replace(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g, (_match, slash: string, rawName: string, attrs: string) => {
    const name = rawName.toLowerCase();
    if (!ALLOWED_TAGS.has(name)) return "";
    if (slash) return `</${name}>`;
    if (name === "a") {
      const href = /href\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ?? /href\s*=\s*'([^']*)'/i.exec(attrs)?.[1] ?? "";
      return /^https?:\/\//i.test(href) ? `<a href="${href}" style="color:#3848c7">` : "<a>";
    }
    if (name === "pre" || name === "code") return `<${name} style="white-space:pre-wrap;font-family:Menlo,Consolas,monospace;font-size:13px">`;
    if (name === "blockquote") return `<blockquote style="margin:8px 0;padding:4px 12px;border-left:3px solid #c7cdfb;color:#3f3f46">`;
    return `<${name}>`;
  });
  return cleaned.replace(/\r?\n/g, "<br>\n");
}

export type AdminNotificationEmail = {
  subject: string;
  /** Заголовок письма — первая строка уведомления, простым текстом. */
  title: string;
  /** Остальные строки — HTML тела письма. */
  bodyHtml: string;
};

/**
 * Письмо из того же текста, что уходит админам в Telegram: первая строка —
 * тема и заголовок, остальное — тело. Так письмо и сообщение не расходятся.
 */
export function adminNotificationEmail(text: string): AdminNotificationEmail {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const firstIndex = lines.findIndex((line) => telegramHtmlToPlain(line).trim().length > 0);
  const title = firstIndex >= 0 ? telegramHtmlToPlain(lines[firstIndex]).replace(/\s+/g, " ").trim() : "Уведомление платформы";
  const rest = (firstIndex >= 0 ? lines.slice(firstIndex + 1) : lines).join("\n").replace(/^\s*\n/, "").trimEnd();
  const shortTitle = title.length > 140 ? `${title.slice(0, 139)}…` : title;
  return {
    subject: `WeSetup · ${shortTitle}`,
    title: shortTitle,
    bodyHtml: rest ? telegramHtmlToEmailHtml(rest) : "",
  };
}
