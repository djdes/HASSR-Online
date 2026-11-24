/**
 * Ответ на конкретное сообщение чата (владелец, 2026-11-23: «если я отвечаю —
 * должно быть видно, на что я отвечаю и кому»). Сообщение оператора хранит
 * `SupportMessage.replyToId`; цитату рисуют админка и чат клиента, находя
 * сообщение в своей переписке. Чистые функции — без БД, для клиента и сервера.
 */

export type QuotableMessage = {
  id: string;
  author: string;
  body: string;
  attachments?: ReadonlyArray<{ filename: string }> | null;
};

/** Короткая цитата: текст в одну строку или имя вложения. */
export function quotePreview(message: Pick<QuotableMessage, "body" | "attachments">, limit = 140): string {
  const flat = message.body.replace(/\s+/g, " ").trim();
  if (flat) return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
  const files = message.attachments ?? [];
  if (files.length === 0) return "";
  return `📎 ${files.map((file) => file.filename).join(", ")}`;
}

/** Сообщение, на которое ответили, — только из этой же переписки. */
export function findQuotedMessage<T extends { id: string }>(
  messages: readonly T[],
  replyToId: string | null | undefined,
): T | null {
  if (!replyToId) return null;
  return messages.find((message) => message.id === replyToId) ?? null;
}

/**
 * На что отвечает оператор по умолчанию: последнее сообщение клиента в ветке
 * (после него оператор ещё не писал — иначе отвечать не на что).
 */
export function defaultReplyTarget<T extends { id: string; author: string }>(messages: readonly T[]): T | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.author === "client") return message;
    if (message.author === "operator") return null;
  }
  return null;
}

/** id цитаты из запроса: строка cuid-подобного вида, иначе null. */
export function sanitizeReplyToId(raw: unknown): string | null {
  return typeof raw === "string" && /^[a-z0-9_-]{8,64}$/i.test(raw) ? raw : null;
}
