/**
 * Мессенджер Авито → лента CRM. Чистый модуль: разбор ответов API
 * (`/messenger/v2/.../chats`, `/messenger/v3/.../messages`) в записи CRM.
 *
 * Ключ записи — `avito:<chat_id>:<message_id>`: по нему сбор идемпотентен,
 * а ответ из карточки CRM находит чат по последней записи Авито.
 */
import type { CrmIngestItem } from "@/lib/crm/sources";

export type AvitoChatUser = { id: number | string; name?: string | null };
export type AvitoChat = {
  id: string;
  created?: number;
  updated?: number;
  users?: AvitoChatUser[];
  context?: { type?: string; value?: { id?: number; title?: string; url?: string; price_string?: string } } | null;
  last_message?: { id?: string; created?: number; direction?: string } | null;
};
export type AvitoMessage = {
  id: string;
  author_id?: number | string;
  created: number;
  direction?: "in" | "out" | string;
  type?: string;
  content?: {
    text?: string;
    link?: { text?: string; url?: string };
    item?: { title?: string; item_url?: string; price_string?: string };
    image?: unknown;
    voice?: unknown;
    call?: { status?: string };
    location?: { title?: string; text?: string };
    file?: { name?: string };
  } | null;
};

export const AVITO_CHANNEL = "avito";

export function avitoChatUrl(chatId: string): string {
  return `https://www.avito.ru/profile/messenger/channel/${encodeURIComponent(chatId)}`;
}

/** Собеседник чата — не наш аккаунт. */
export function avitoPeer(chat: AvitoChat, ownUserId: string): AvitoChatUser | null {
  return chat.users?.find((user) => String(user.id) !== ownUserId) ?? null;
}

/** Текст сообщения; служебные (системные, удалённые) — null. */
export function avitoMessageBody(message: AvitoMessage): string | null {
  const content = message.content ?? {};
  switch (message.type) {
    case "text":
      return content.text?.trim() || null;
    case "link":
      return [content.link?.text, content.link?.url].filter(Boolean).join(" — ") || content.text?.trim() || null;
    case "item":
      return `[Объявление] ${[content.item?.title, content.item?.price_string].filter(Boolean).join(", ")}${content.item?.item_url ? ` — ${content.item.item_url}` : ""}`;
    case "image":
      return "[Фото]";
    case "voice":
      return "[Голосовое сообщение — прослушать в чате Авито]";
    case "call":
      return `[Звонок через Авито${content.call?.status ? `: ${content.call.status}` : ""}]`;
    case "location":
      return `[Геолокация] ${content.location?.title ?? content.location?.text ?? ""}`.trim();
    case "file":
      return `[Файл] ${content.file?.name ?? ""}`.trim();
    case "system":
    case "deleted":
      return null;
    default:
      return content.text?.trim() || null;
  }
}

export function avitoExternalKey(chatId: string, messageId: string): string {
  return `avito:${chatId}:${messageId}`;
}

/** Id чата из ключа записи CRM (`avito:<chat>:<message>`). */
export function avitoChatIdFromKey(key: string): string | null {
  const match = /^avito:(.+):[^:]+$/.exec(key);
  return match ? match[1] : null;
}

export function mapAvitoMessage(chat: AvitoChat, message: AvitoMessage, ownUserId: string, accountLabel: string): CrmIngestItem | null {
  const body = avitoMessageBody(message);
  if (!body) return null;
  const peer = avitoPeer(chat, ownUserId);
  if (!peer) return null;
  const out = message.direction ? message.direction === "out" : String(message.author_id) === ownUserId;
  const title = chat.context?.value?.title?.trim();
  return {
    externalKey: avitoExternalKey(chat.id, message.id),
    channel: AVITO_CHANNEL,
    direction: out ? "out" : "in",
    subject: title ? `Авито: ${title}` : "Авито",
    body,
    href: avitoChatUrl(chat.id),
    occurredAt: new Date(message.created * 1000),
    authorName: out ? accountLabel : null,
    identity: { avitoUserId: String(peer.id), name: peer.name?.trim() || null },
  };
}
