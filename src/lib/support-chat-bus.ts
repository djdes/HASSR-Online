/**
 * Шина «открой чат поддержки». Виджет поддержки живёт в layout'е, а
 * открыть его нужно из всплывашки о новом сообщении, из колокольчика и
 * по deep-link'у `?support=chat`. Тот же приём, что в sanpin-chat-bus.
 */
export const SUPPORT_CHAT_OPEN_EVENT = "wesetup:support-chat-open";
/** Клиент прочитал чат — уведомитель может погасить бейдж без ожидания poll'а. */
export const SUPPORT_CHAT_READ_EVENT = "wesetup:support-chat-read";

/** Почта поддержки — когда виджета чата на странице нет. */
export const SUPPORT_EMAIL = "support@wesetup.ru";

/**
 * Открыть чат поддержки. Виджет, который открылся, гасит событие
 * (`preventDefault`) — так вызывающий узнаёт, что чат есть: `true`.
 */
export function openSupportChat(): boolean {
  if (typeof window === "undefined") return false;
  const event = new Event(SUPPORT_CHAT_OPEN_EVENT, { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

/** «Связаться»: чат поддержки, а без виджета — письмо с темой. */
export function contactSupport(subject: string): void {
  if (openSupportChat() || typeof window === "undefined") return;
  window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}

export function announceSupportChatRead(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SUPPORT_CHAT_READ_EVENT));
}
