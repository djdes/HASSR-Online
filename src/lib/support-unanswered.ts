import { buildSupportChatTag } from "@/lib/support-chat";

/**
 * Повторный сигнал админу, если сообщение клиента в чате поддержки осталось без
 * ответа. Первый сигнал уходит сразу (deliverClientMessage); этот — через 15
 * минут, один раз на каждое сообщение клиента. Через сутки молчим: дальше это
 * уже не «быстрый ответ», а разбор очереди в админке.
 */
export const UNANSWERED_AFTER_MS = 15 * 60 * 1000;
export const UNANSWERED_GIVE_UP_MS = 24 * 60 * 60 * 1000;

export type UnansweredCandidate = {
  /** Автор последней реплики ветки: "client" | "operator". */
  lastAuthor: string;
  lastMessageAt: Date;
};

/** Нужен ли повторный сигнал по ветке сейчас. */
export function needsUnansweredPing(candidate: UnansweredCandidate, now: Date): boolean {
  if (candidate.lastAuthor !== "client") return false;
  const age = now.getTime() - candidate.lastMessageAt.getTime();
  return age >= UNANSWERED_AFTER_MS && age <= UNANSWERED_GIVE_UP_MS;
}

/** Ключ от повторов: одно напоминание на одно сообщение клиента. */
export function unansweredPingKey(lastMessageId: string): string {
  return `support-unanswered:${lastMessageId}`;
}

/** Текст повторного сигнала. С меткой ветки — на него можно ответить свайпом. */
export function composeUnansweredPing(args: {
  threadId: string;
  preview: string;
  minutes: number;
  userName?: string | null;
  userEmail?: string | null;
  organizationName?: string | null;
  phone?: string | null;
  escape: (value: string) => string;
  appUrl: string;
}): string {
  const who = [args.userName, args.userEmail].filter(Boolean).join(" · ");
  return [
    `<b>⏰ Чат без ответа ${args.minutes} мин</b>`,
    "",
    args.escape(args.preview || "📎 Вложение"),
    "",
    who ? `👤 ${args.escape(who)}` : "",
    args.organizationName ? `🏢 ${args.escape(args.organizationName)}` : "",
    args.phone ? `📞 ${args.escape(args.phone)}` : "",
    "",
    buildSupportChatTag(args.threadId),
    "Ответить: свайп-реплай на это сообщение.",
    `<a href="${args.appUrl}/root/feedback">Открыть админку</a>`,
  ]
    .filter((line, index, lines) => line !== "" || (index > 0 && lines[index - 1] !== ""))
    .join("\n");
}
