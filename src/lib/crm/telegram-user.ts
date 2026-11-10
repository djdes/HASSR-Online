/**
 * Переписка рабочего аккаунта Telegram (клиент MTProto, не бот) → лента CRM.
 * Чистые функции: сбор (`telegram-user.server.ts`) читает диалоги и
 * сообщения, а что из них попадёт в CRM и как — решается здесь.
 */

import { CRM_BODY_MAX } from "@/lib/crm/constants";
import { truncateBody } from "@/lib/crm/mail-text";
import type { CrmIngestItem } from "@/lib/crm/sources";

/** Служебный аккаунт Telegram (коды входа, уведомления). */
export const TELEGRAM_SERVICE_USER_ID = "777000";

export type TgPeer = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  /** Без «+», как отдаёт Telegram; виден, если человек в контактах или открыл номер. */
  phone?: string | null;
  bot?: boolean;
  self?: boolean;
  deleted?: boolean;
};

export type TgMediaKind = "photo" | "video" | "video_note" | "voice" | "audio" | "sticker" | "document" | "contact" | "geo" | "poll" | "other";

export type TgMessage = {
  id: number;
  out: boolean;
  /** Секунды Unix. */
  date: number;
  text?: string | null;
  media?: { kind: TgMediaKind; fileName?: string | null; durationSec?: number | null } | null;
  /** Расшифровка голосового (если сделали). */
  transcript?: string | null;
};

/** С кем переписку в CRM не несём: боты, «Избранное», удалённые, служебный аккаунт и список исключений. */
export function isCrmPeer(peer: TgPeer, ignore: ReadonlySet<string>): boolean {
  return !peer.bot && !peer.self && !peer.deleted && peer.id !== TELEGRAM_SERVICE_USER_ID && !ignore.has(peer.id) && !(peer.username && ignore.has(`@${peer.username.toLowerCase()}`));
}

/** `TG_USER_IGNORE`: id и @username через запятую или пробел — коллеги, личные чаты. */
export function parseIgnoreList(raw: string | null | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(/[\s,;]+/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function peerName(peer: TgPeer): string | null {
  const name = [peer.firstName, peer.lastName].map((part) => part?.trim()).filter(Boolean).join(" ");
  return name || (peer.username ? `@${peer.username}` : null);
}

function clock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function mediaLabel(media: NonNullable<TgMessage["media"]>): string {
  const duration = media.durationSec ? ` ${clock(media.durationSec)}` : "";
  switch (media.kind) {
    case "photo":
      return "[Фото]";
    case "video":
      return `[Видео${duration}]`;
    case "video_note":
      return `[Видеосообщение${duration}]`;
    case "voice":
      return `[Голосовое${duration}]`;
    case "audio":
      return `[Аудио${duration}]`;
    case "sticker":
      return "[Стикер]";
    case "document":
      return media.fileName ? `[Файл: ${media.fileName}]` : "[Файл]";
    case "contact":
      return "[Контакт]";
    case "geo":
      return "[Геопозиция]";
    case "poll":
      return "[Опрос]";
    default:
      return "[Вложение]";
  }
}

/** Текст записи ленты: вложение, подпись, расшифровка голосового. Пустое сообщение — null. */
export function tgMessageBody(message: TgMessage): string | null {
  const parts = [message.media ? mediaLabel(message.media) : null, message.text?.trim() || null, message.transcript?.trim() ? `Расшифровка: ${message.transcript.trim()}` : null].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length ? truncateBody(parts.join("\n"), CRM_BODY_MAX) : null;
}

/** Номер из Telegram («79991234567») → «+79991234567». */
export function tgPhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? `+${digits}` : null;
}

/**
 * Сообщение → запись ленты. Склейка по Telegram id: у личного чата с ботом
 * WeSetup id чата тот же, что id человека, поэтому обращения через бота и
 * переписка с рабочего аккаунта попадают в одну карточку. Плюс телефон, если виден.
 */
export function mapTgMessage(peer: TgPeer, message: TgMessage, accountLabel: string): CrmIngestItem | null {
  const body = tgMessageBody(message);
  if (!body) return null;
  return {
    externalKey: `tguser:${peer.id}:${message.id}`,
    channel: "telegram",
    direction: message.out ? "out" : "in",
    subject: null,
    body,
    occurredAt: new Date(message.date * 1000),
    authorName: message.out ? accountLabel : null,
    identity: { telegramChatId: peer.id, phone: tgPhone(peer.phone), name: peerName(peer) },
  };
}

/** Состояние сбора: последний прочитанный id сообщения по каждому собеседнику. */
export type TgCursorState = Record<string, number>;

export function parseCursorState(raw: string | null | undefined): TgCursorState {
  try {
    const value: unknown = JSON.parse(raw ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const state: TgCursorState = {};
    for (const [key, id] of Object.entries(value)) if (/^\d+$/.test(key) && Number.isInteger(id) && (id as number) > 0) state[key] = id as number;
    return state;
  } catch {
    return {};
  }
}

/** Прокси для MTProto: только SOCKS (HTTP-прокси клиент Telegram не умеет). null — напрямую. */
export function parseSocksProxy(raw: string | null | undefined): { ip: string; port: number; socksType: 4 | 5; username?: string; password?: string } | null {
  if (!raw?.trim()) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const type = url.protocol === "socks5:" || url.protocol === "socks5h:" ? 5 : url.protocol === "socks4:" ? 4 : null;
  if (!type || !url.hostname || !url.port) return null;
  return {
    ip: url.hostname,
    port: Number(url.port),
    socksType: type,
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
  };
}
