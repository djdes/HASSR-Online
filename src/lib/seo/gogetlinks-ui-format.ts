export type GglBadgeTone = "indigo" | "emerald" | "amber" | "rose" | "slate";

export type OrderAttributionBadgeTone = "indigo" | "emerald" | "slate";

export interface FormattedOrderAttribution {
  primary: string;
  secondary?: string;
  badgeTone: OrderAttributionBadgeTone;
}

export interface FormattedStatusBadge {
  label: string;
  badgeTone: GglBadgeTone;
}

/**
 * Formats transparent Russian attribution ("Кто купил") for GoGetLinks link orders.
 */
export function formatOrderAttribution(order: {
  origin: string;
  initiatedByName?: string | null;
  approvedByName?: string | null;
}): FormattedOrderAttribution {
  const initiated = order.initiatedByName?.trim() || null;
  const approved = order.approvedByName?.trim() || null;

  if (order.origin === "scheduled_wesetup") {
    const primary = approved ? `По плану · подтв. ${approved}` : "По плану закупок";
    const secondary =
      initiated && initiated !== approved ? `План подготовил(а): ${initiated}` : undefined;
    return {
      primary,
      ...(secondary ? { secondary } : {}),
      badgeTone: "indigo",
    };
  }

  if (order.origin === "manual_wesetup") {
    const who = initiated || approved || "Администратор";
    const secondary =
      approved && initiated && approved !== initiated ? `Подтв.: ${approved}` : undefined;
    return {
      primary: `${who} (вручную)`,
      ...(secondary ? { secondary } : {}),
      badgeTone: "emerald",
    };
  }

  return {
    primary: "Из кабинета GoGetLinks",
    badgeTone: "slate",
  };
}

export function formatSlotStatusBadge(status: string): FormattedStatusBadge {
  switch (status) {
    case "planned":
      return { label: "В расписании", badgeTone: "slate" };
    case "preparing":
      return { label: "Подбор и статья…", badgeTone: "indigo" };
    case "pending_approval":
      return { label: "Ждёт подтверждения", badgeTone: "amber" };
    case "approved_sending":
      return { label: "Отправляется…", badgeTone: "indigo" };
    case "ordered":
      return { label: "Заявка отправлена", badgeTone: "emerald" };
    case "skipped":
      return { label: "Пропущен", badgeTone: "slate" };
    case "failed":
      return { label: "Ошибка подбора", badgeTone: "rose" };
    default:
      return { label: status || "Неизвестно", badgeTone: "slate" };
  }
}

export function formatOrderStatusBadge(status: string): FormattedStatusBadge {
  switch (status) {
    case "sending":
      return { label: "Отправляется…", badgeTone: "indigo" };
    case "pending_webmaster":
      return { label: "Ждёт вебмастера", badgeTone: "indigo" };
    case "in_progress":
      return { label: "В работе", badgeTone: "indigo" };
    case "on_check":
      return { label: "На проверке", badgeTone: "amber" };
    case "paid":
      return { label: "Оплачено", badgeTone: "emerald" };
    case "needs_replacement":
      return { label: "На замену", badgeTone: "rose" };
    case "rejected":
      return { label: "Отклонено", badgeTone: "slate" };
    case "failed":
      return { label: "Ошибка отправки", badgeTone: "rose" };
    default:
      return { label: status || "Неизвестно", badgeTone: "slate" };
  }
}

export function formatAccountStatusBadge(status: string | null | undefined): FormattedStatusBadge {
  switch (status) {
    case "ok":
    case "active":
      return { label: "Подключено", badgeTone: "emerald" };
    case "auth_error":
      return { label: "Ошибка входа", badgeTone: "rose" };
    case "blocked":
      return { label: "Заблокировано / капча", badgeTone: "rose" };
    case "error":
      return { label: "Сбой связи", badgeTone: "amber" };
    case "unchecked":
      return { label: "Не проверено", badgeTone: "slate" };
    default:
      return { label: "Не подключено", badgeTone: "slate" };
  }
}

export function formatPlacementFormatLabel(format: string | null | undefined): string {
  switch (format) {
    case "article":
      return "Статья";
    case "note":
      return "Заметка";
    case "context":
      return "Контекстная ссылка";
    case "image":
      return "Картинка";
    default:
      return format || "—";
  }
}

export function formatAnchorKindLabel(kind: string | null | undefined): string {
  switch (kind) {
    case "exact":
      return "Точный анкор";
    case "diluted":
      return "Разбавленный";
    case "url_brand":
      return "Безанкор / бренд";
    default:
      return "Естественный";
  }
}

export function formatRub(amount: number | null | undefined): string {
  const num = typeof amount === "number" && Number.isFinite(amount) ? amount : 0;
  const hasCents = Math.abs(num - Math.trunc(num)) > 0.004;
  const formatted = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  }).format(num);
  return `${formatted} ₽`;
}

export function badgeToneClass(tone: GglBadgeTone): string {
  switch (tone) {
    case "indigo":
      return "bg-[#eef1ff] text-[#3848c7] border-[#d8deff]";
    case "emerald":
      return "bg-[#ecfdf5] text-[#116b2a] border-[#bbf7d0]";
    case "amber":
      return "bg-[#fffbeb] text-[#92400e] border-[#fde68a]";
    case "rose":
      return "bg-[#fff4f2] text-[#a13a32] border-[#fecdd3]";
    case "slate":
    default:
      return "bg-[#f4f4f8] text-[#6f7282] border-[#dcdfed]";
  }
}

const ALLOWED_PREVIEW_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "ul",
  "ol",
  "li",
  "strong",
  "b",
  "em",
  "i",
  "a",
  "blockquote",
  "br",
  "code",
  "span",
]);

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Strips dangerous tags (`<script>`, `<iframe>`, `<style>`, `<object>`, `<embed>`),
 * event handlers (`on*=`) and `javascript:`/`data:` URLs so article drafts can be
 * safely previewed in `ArticleDrawer`.
 */
export function sanitizeArticleHtmlForPreview(rawHtml: string): string {
  if (!rawHtml) return "";

  let html = rawHtml
    .replace(/<\s*(script|iframe|style|object|embed|form|input|button|textarea|meta|link)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|iframe|style|object|embed|form|input|button|textarea|meta|link)\b[^>]*\/?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  html = html.replace(/<\/?([a-zA-Z0-9-]+)([^>]*)>/g, (_full, rawTag: string, rawAttrs: string) => {
    const tag = rawTag.toLowerCase();
    const isClosing = _full.startsWith("</");
    if (!ALLOWED_PREVIEW_TAGS.has(tag)) {
      return "";
    }
    if (isClosing) {
      return tag === "br" ? "" : `</${tag}>`;
    }
    if (tag === "br") {
      return "<br />";
    }
    if (tag === "a") {
      const hrefMatch = rawAttrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const rawHref = (hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? "").trim();
      const safeHref =
        /^https?:\/\//i.test(rawHref) || rawHref.startsWith("/") ? rawHref : "#";
      return `<a href="${escapeHtmlAttr(safeHref)}" target="_blank" rel="noopener noreferrer">`;
    }
    return `<${tag}>`;
  });

  return html.trim();
}

export function generateClientIdempotencyKey(prefix: string): string {
  const randomPart =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}:${randomPart}`;
}
