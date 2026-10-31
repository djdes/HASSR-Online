/**
 * Повторная отправка ссылки на достройку профиля после оплаты.
 *
 * Новый клиент платит без регистрации; ссылка «задайте пароль и название
 * организации» уходит письмом с одноразовым токеном. Письмо теряется в спаме —
 * и человек, уже заплативший, не может войти. Кнопка «Выслать ссылку ещё раз»
 * выпускает новый токен (старая ссылка перестаёт работать) и шлёт письмо на
 * почту заказа — не чаще раза в минуту и не больше пяти раз на заказ.
 */

export const COMPLETION_RESEND_MIN_INTERVAL_MS = 60 * 1000;
export const COMPLETION_RESEND_MAX = 5;
/** Запись в AuditLog о каждой повторной отправке — по ней считаем лимит. */
export const COMPLETION_RESEND_ACTION = "payment.completion_link.resent";

export type CompletionResendDecision = "send" | "not_needed" | "too_soon" | "limit";

export function completionResendDecision(args: {
  /** Статус заказа: ссылка нужна только оплаченному (не `completed`). */
  status: string;
  /** У заказа есть токен достройки — значит, это новый клиент. */
  hasCompletionToken: boolean;
  /** Время прошлых повторных отправок. */
  previousSends: ReadonlyArray<Date>;
  now: Date;
}): CompletionResendDecision {
  if (args.status !== "paid" || !args.hasCompletionToken) return "not_needed";
  if (args.previousSends.length >= COMPLETION_RESEND_MAX) return "limit";
  const last = Math.max(0, ...args.previousSends.map((d) => d.getTime()));
  if (last > 0 && args.now.getTime() - last < COMPLETION_RESEND_MIN_INTERVAL_MS) return "too_soon";
  return "send";
}

/** Письмо со ссылкой на достройку. `link` содержит только токен, без личных данных. */
export function composeCompletionLinkEmail(args: { link: string; ttlDays: number }): {
  subject: string;
  title: string;
  html: string;
} {
  const P = 'style="margin:0 0 16px;color:#3f3f46;line-height:1.6"';
  const NOTE = 'style="margin:16px 0 0;color:#6f7282;line-height:1.6;font-size:13px"';
  const BUTTON =
    'style="display:inline-block;background:#5566f6;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px"';
  return {
    subject: "Ссылка для входа в WeSetup",
    title: "Завершите настройку WeSetup",
    html:
      `<p ${P}>Здравствуйте! Оплата получена. Чтобы открыть кабинет, задайте пароль и название организации — это займёт минуту.</p>` +
      `<a href="${args.link}" ${BUTTON}>Завершить настройку</a>` +
      `<p ${NOTE}>Ссылка одноразовая и действует ${args.ttlDays} дней. Предыдущие ссылки больше не работают. Если вы не оплачивали WeSetup, просто удалите это письмо.</p>`,
  };
}
