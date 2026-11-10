import { readFile } from "node:fs/promises";

import { Api, TelegramClient } from "telegram";
import { Logger, LogLevel } from "telegram/extensions/Logger";
import { StringSession } from "telegram/sessions";

import { db } from "@/lib/db";
import { ingestCrmItems } from "@/lib/crm/ingest.server";
import {
  isCrmPeer,
  mapTgMessage,
  parseCursorState,
  parseIgnoreList,
  parseSocksProxy,
  type TgMediaKind,
  type TgMessage,
  type TgPeer,
} from "@/lib/crm/telegram-user";
import type { CrmIngestItem } from "@/lib/crm/sources";
import { transcribeCallAudio } from "@/lib/crm/telphin.server";

/**
 * Переписка рабочего аккаунта Telegram в CRM. Это клиент Telegram (MTProto,
 * библиотека GramJS), вошедший в рабочий аккаунт, а не бот: бот не видит
 * личных чатов человека. Каждый прогон CRM подключается, читает новые
 * сообщения личных чатов (кроме ботов, «Избранного» и списка исключений) и
 * отключается — постоянного процесса нет.
 *
 * Окружение: `TG_API_ID`, `TG_API_HASH` (my.telegram.org → API development
 * tools), сессия — `TG_USER_SESSION` или файл `TG_USER_SESSION_FILE`
 * (выпускает `scripts/telegram-user-login.ts`), `TG_USER_IGNORE`,
 * `TG_USER_PROXY_URL` (SOCKS; по умолчанию `TELEGRAM_PROXY_URL`, если он SOCKS).
 */

const STATE_KEY = "crm:tguser:state";
const DIALOGS_LIMIT = 200;
/** Первый проход по собеседнику — не глубже этого. */
const BACKFILL_MS = 30 * 24 * 60 * 60_000;
const PER_PEER_LIMIT = 300;
/** Голосовые длиннее не расшифровываем на лету — это уже не реплика, а запись. */
const VOICE_TRANSCRIBE_MAX_SEC = 5 * 60;
const VOICE_PER_RUN = 10;

export type TelegramUserSyncResult = { configured: boolean; dialogs: number; messages: number; created: number; voice: number; errors: string[] };

export async function telegramUserSession(): Promise<string | null> {
  const inline = process.env.TG_USER_SESSION?.trim();
  if (inline) return inline;
  const file = process.env.TG_USER_SESSION_FILE?.trim();
  if (!file) return null;
  return (await readFile(file, "utf8").catch(() => "")).trim() || null;
}

export function telegramApiCredentials(): { apiId: number; apiHash: string } | null {
  const apiId = Number(process.env.TG_API_ID);
  const apiHash = process.env.TG_API_HASH?.trim();
  return Number.isInteger(apiId) && apiId > 0 && apiHash ? { apiId, apiHash } : null;
}

export function telegramUserProxy() {
  return parseSocksProxy(process.env.TG_USER_PROXY_URL) ?? parseSocksProxy(process.env.TELEGRAM_PROXY_URL);
}

/** Клиент с сессией; общий для сбора и скрипта входа. Без логов GramJS в pm2. */
export function createTelegramClient(session: string, credentials: { apiId: number; apiHash: string }): TelegramClient {
  const proxy = telegramUserProxy();
  const client = new TelegramClient(new StringSession(session), credentials.apiId, credentials.apiHash, {
    connectionRetries: 3,
    requestRetries: 2,
    deviceModel: "WeSetup CRM",
    appVersion: "1.0",
    systemVersion: "server",
    baseLogger: new Logger(LogLevel.ERROR),
    ...(proxy ? { proxy } : {}),
  });
  return client;
}

function toPeer(user: Api.User): TgPeer {
  return {
    id: user.id.toString(),
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    username: user.username ?? null,
    phone: user.phone ?? null,
    bot: Boolean(user.bot),
    self: Boolean(user.self),
    deleted: Boolean(user.deleted),
  };
}

function documentInfo(document: Api.Document): { kind: TgMediaKind; fileName: string | null; durationSec: number | null } {
  let kind: TgMediaKind = "document";
  let fileName: string | null = null;
  let durationSec: number | null = null;
  for (const attribute of document.attributes) {
    if (attribute instanceof Api.DocumentAttributeFilename) fileName = attribute.fileName;
    else if (attribute instanceof Api.DocumentAttributeSticker) kind = "sticker";
    else if (attribute instanceof Api.DocumentAttributeAudio) {
      kind = attribute.voice ? "voice" : "audio";
      durationSec = attribute.duration;
    } else if (attribute instanceof Api.DocumentAttributeVideo) {
      kind = attribute.roundMessage ? "video_note" : "video";
      durationSec = Math.round(attribute.duration);
    }
  }
  return { kind, fileName, durationSec };
}

function toMessage(message: Api.Message): TgMessage {
  const media = message.media;
  let info: TgMessage["media"] = null;
  if (media instanceof Api.MessageMediaPhoto) info = { kind: "photo" };
  else if (media instanceof Api.MessageMediaDocument && media.document instanceof Api.Document) info = documentInfo(media.document);
  else if (media instanceof Api.MessageMediaContact) info = { kind: "contact" };
  else if (media instanceof Api.MessageMediaGeo || media instanceof Api.MessageMediaGeoLive || media instanceof Api.MessageMediaVenue) info = { kind: "geo" };
  else if (media instanceof Api.MessageMediaPoll) info = { kind: "poll" };
  else if (media && !(media instanceof Api.MessageMediaWebPage) && !(media instanceof Api.MessageMediaEmpty)) info = { kind: "other" };
  return { id: message.id, out: Boolean(message.out), date: message.date, text: message.message || null, media: info };
}

async function readState() {
  const row = await db.platformSetting.findUnique({ where: { key: STATE_KEY } });
  return parseCursorState(row?.value);
}

async function writeState(state: Record<string, number>) {
  const value = JSON.stringify(state);
  await db.platformSetting.upsert({ where: { key: STATE_KEY }, create: { key: STATE_KEY, value }, update: { value } });
}

/** Шаг прогона CRM: новые сообщения личных чатов рабочего аккаунта. */
export async function syncTelegramUser(now: Date): Promise<TelegramUserSyncResult> {
  const credentials = telegramApiCredentials();
  const session = credentials ? await telegramUserSession() : null;
  const result: TelegramUserSyncResult = { configured: Boolean(credentials && session), dialogs: 0, messages: 0, created: 0, voice: 0, errors: [] };
  if (!credentials || !session) return result;

  const client = createTelegramClient(session, credentials);
  try {
    await client.connect();
    if (!(await client.checkAuthorization())) throw new Error("сессия Telegram недействительна — войдите заново (scripts/telegram-user-login.ts)");
    const me = await client.getMe();
    const accountLabel = [me.firstName, me.lastName].filter(Boolean).join(" ") || "Рабочий Telegram";
    const ignore = parseIgnoreList(process.env.TG_USER_IGNORE);
    const state = await readState();
    const nextState = { ...state };
    const backfillFrom = Math.floor((now.getTime() - BACKFILL_MS) / 1000);
    let voiceBudget = VOICE_PER_RUN;

    const dialogs = await client.getDialogs({ limit: DIALOGS_LIMIT });
    for (const dialog of dialogs) {
      if (!(dialog.entity instanceof Api.User)) continue;
      const peer = toPeer(dialog.entity);
      if (!isCrmPeer(peer, ignore)) continue;
      const known = state[peer.id] ?? 0;
      const topId = dialog.message?.id ?? 0;
      if (topId && topId <= known) continue;
      // Старый диалог без новых сообщений за 30 дней при первом проходе не нужен.
      if (!known && (dialog.message?.date ?? 0) < backfillFrom) {
        if (topId) nextState[peer.id] = topId;
        continue;
      }
      result.dialogs += 1;
      try {
        const items: CrmIngestItem[] = [];
        let lastId = known;
        for await (const raw of client.iterMessages(dialog.entity, { reverse: true, limit: PER_PEER_LIMIT, ...(known ? { offsetId: known } : { offsetDate: backfillFrom }) })) {
          lastId = Math.max(lastId, raw.id);
          // Служебные (MessageService: «звонок», «закреплено») — только сдвигают курсор.
          if (raw.className !== "Message") continue;
          if (!known && raw.date < backfillFrom) continue;
          const message = toMessage(raw);
          if (message.media?.kind === "voice" && voiceBudget > 0 && (message.media.durationSec ?? 0) <= VOICE_TRANSCRIBE_MAX_SEC && process.env.GROQ_API_KEY) {
            voiceBudget -= 1;
            try {
              const bytes = await client.downloadMedia(raw, {});
              if (Buffer.isBuffer(bytes) && bytes.length) {
                message.transcript = await transcribeCallAudio(bytes, `voice-${peer.id}-${raw.id}.ogg`, "audio/ogg");
                result.voice += 1;
              }
            } catch (error) {
              console.warn(`[crm] голосовое ${peer.id}/${raw.id}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
          const item = mapTgMessage(peer, message, accountLabel);
          if (item) items.push(item);
          result.messages += 1;
        }
        const ingest = await ingestCrmItems(items);
        result.created += ingest.created;
        if (lastId > known) nextState[peer.id] = lastId;
      } catch (error) {
        result.errors.push(`${peer.id}: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`);
      }
    }
    await writeState(nextState);
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message.slice(0, 300) : String(error));
  } finally {
    await client.destroy().catch(() => undefined);
  }
  return result;
}
