/**
 * Обращения и чаты — всей команде поддержки (владелец, 2026-11-23: «всем, у
 * кого есть доступ к админу, в уведомлениях показывать все эти обращения,
 * всплывашкой, если на сайте находимся»).
 *
 * Чистая часть: что показать во всплывашке и колокольчике. Запись в БД и
 * живое событие — `support-staff-alerts.server.ts`.
 *
 * Живое событие здесь несёт данные (кто, кусок текста, ссылки) — исключение
 * из правила «событие — сигнал перечитать» (`live-events.ts`): всплывашка —
 * украшение, потерянное при переподключении событие не страшно, долговечная
 * запись остаётся в колокольчике.
 */

export type SupportStaffAlertKind = "report" | "chat";

export type SupportStaffAlert = {
  kind: SupportStaffAlertKind;
  /** id обращения или ветки чата. */
  id: string;
  /** Кто написал: «Анна · anna@mail.ru · Кафе Ромашка». */
  who: string;
  /** Кусок текста в одну строку. */
  preview: string;
  /** Тип обращения (bug/suggestion/support/partnership) — для заголовка. */
  reportType: string | null;
  /** Куда ведёт «Открыть» — обращение или ветка в /root/feedback. */
  href: string;
  /** Карточка клиента в админке; null — клиент неизвестен. */
  clientHref: string | null;
};

export const SUPPORT_ALERT_EVENT_KIND = "alert";
export const SUPPORT_ALERT_PREVIEW_LIMIT = 160;

export function supportAlertHref(kind: SupportStaffAlertKind, id: string): string {
  return `/root/feedback#${kind === "report" ? "report" : "chat"}-${encodeURIComponent(id)}`;
}

export function supportAlertPreview(text: string | null | undefined, attachments: ReadonlyArray<{ filename: string }> = []): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  const body = flat.length > SUPPORT_ALERT_PREVIEW_LIMIT ? `${flat.slice(0, SUPPORT_ALERT_PREVIEW_LIMIT - 1)}…` : flat;
  if (body) return attachments.length > 0 ? `${body} 📎${attachments.length}` : body;
  return attachments.length > 0 ? `📎 ${attachments.map((file) => file.filename).join(", ")}` : "";
}

export function supportAlertWho(parts: {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  organizationName?: string | null;
}): string {
  const values = [parts.name, parts.email, parts.phone, parts.organizationName]
    .map((value) => (value ?? "").trim())
    .filter((value, index, all) => value !== "" && all.indexOf(value) === index);
  return values.join(" · ");
}

/** Данные живого события → всплывашка; мусор — null. */
export function parseSupportStaffAlert(raw: unknown): SupportStaffAlert | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const kind = value.kind === "report" || value.kind === "chat" ? value.kind : null;
  if (!kind || typeof value.id !== "string" || !value.id) return null;
  const href = typeof value.href === "string" && value.href.startsWith("/root/") ? value.href : supportAlertHref(kind, value.id);
  const clientHref =
    typeof value.clientHref === "string" && value.clientHref.startsWith("/root/") ? value.clientHref : null;
  return {
    kind,
    id: value.id,
    who: typeof value.who === "string" ? value.who : "",
    preview: typeof value.preview === "string" ? value.preview : "",
    reportType: typeof value.reportType === "string" ? value.reportType : null,
    href,
    clientHref,
  };
}
