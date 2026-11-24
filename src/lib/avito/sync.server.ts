import { db } from "@/lib/db";
import { ingestCrmItems } from "@/lib/crm/ingest.server";
import type { CrmIngestItem } from "@/lib/crm/sources";
import { avitoConfigured, avitoFetch, avitoOwnUser } from "@/lib/avito/client.server";
import { avitoChatIdFromKey, mapAvitoMessage, type AvitoChat, type AvitoMessage } from "@/lib/avito/messenger";
import { checkAvitoBalance, notifyAvitoMessages } from "@/lib/avito/notify.server";

/**
 * Сбор чатов Авито в CRM: шаг цикла CRM (раз в 5 минут) и вебхук на новое
 * сообщение. Курсор — время последнего сообщения по каждому чату
 * (PlatformSetting `avito.messenger.cursor`), поэтому повторный проход
 * ничего не дублирует, а ключ записи страхует от гонки с вебхуком.
 */
const CURSOR_KEY = "avito.messenger.cursor";
const CHATS_PAGE = 100;
const MAX_PAGES = 5;
const MESSAGES_LIMIT = 100;

export type AvitoSyncResult = { configured: boolean; chats: number; created: number; errors: string[] };

type Cursor = Record<string, number>;

async function readCursor(): Promise<Cursor> {
  const row = await db.platformSetting.findUnique({ where: { key: CURSOR_KEY } });
  try {
    return row ? (JSON.parse(row.value) as Cursor) : {};
  } catch {
    return {};
  }
}

async function writeCursor(cursor: Cursor) {
  const value = JSON.stringify(cursor);
  await db.platformSetting.upsert({ where: { key: CURSOR_KEY }, create: { key: CURSOR_KEY, value }, update: { value } });
}

async function chatMessages(userId: string, chatId: string): Promise<AvitoMessage[]> {
  const data = await avitoFetch<{ messages?: AvitoMessage[] } | AvitoMessage[]>(
    `/messenger/v3/accounts/${userId}/chats/${encodeURIComponent(chatId)}/messages/?limit=${MESSAGES_LIMIT}`,
  );
  return Array.isArray(data) ? data : (data.messages ?? []);
}

async function ingestChat(chat: AvitoChat, own: { id: string; name: string }, since: number): Promise<{ created: number; last: number }> {
  const messages = await chatMessages(own.id, chat.id);
  const items: CrmIngestItem[] = [];
  let last = since;
  for (const message of messages) {
    last = Math.max(last, message.created);
    if (message.created < since) continue;
    const item = mapAvitoMessage(chat, message, own.id, own.name);
    if (item) items.push(item);
  }
  const result = await ingestCrmItems(items);
  // Уведомление — после записи: в нём ссылка на уже заведённый контакт.
  await notifyAvitoMessages(result.items).catch((error) => console.error("[avito] уведомление не ушло", error));
  return { created: result.created, last };
}

export async function syncAvitoMessenger(): Promise<AvitoSyncResult> {
  const result: AvitoSyncResult = { configured: avitoConfigured(), chats: 0, created: 0, errors: [] };
  if (!result.configured) return result;
  const own = await avitoOwnUser();
  const cursor = await readCursor();
  const next = { ...cursor };
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = await avitoFetch<{ chats?: AvitoChat[] }>(
      `/messenger/v2/accounts/${own.id}/chats?limit=${CHATS_PAGE}&offset=${page * CHATS_PAGE}`,
    );
    const chats = data.chats ?? [];
    let anyNew = false;
    for (const chat of chats) {
      const lastAt = chat.last_message?.created ?? chat.updated ?? 0;
      if (cursor[chat.id] && lastAt <= cursor[chat.id]) continue;
      anyNew = true;
      result.chats += 1;
      try {
        const done = await ingestChat(chat, own, cursor[chat.id] ?? 0);
        result.created += done.created;
        next[chat.id] = Math.max(done.last, lastAt);
      } catch (error) {
        result.errors.push(`${chat.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    // Чаты идут от свежих к старым: страница без новых — дальше нечего смотреть.
    if (chats.length < CHATS_PAGE || !anyNew) break;
  }
  await writeCursor(next);
  try {
    await checkAvitoBalance();
  } catch (error) {
    result.errors.push(`баланс: ${error instanceof Error ? error.message : String(error)}`);
  }
  return result;
}

/** Вебхук: одно новое сообщение — дочитать его чат целиком. */
export async function syncAvitoChat(chatId: string): Promise<number> {
  if (!avitoConfigured()) return 0;
  const own = await avitoOwnUser();
  const chat = await avitoFetch<AvitoChat>(`/messenger/v2/accounts/${own.id}/chats/${encodeURIComponent(chatId)}`);
  const cursor = await readCursor();
  const done = await ingestChat(chat, own, cursor[chatId] ?? 0);
  await writeCursor({ ...(await readCursor()), [chatId]: Math.max(done.last, cursor[chatId] ?? 0) });
  return done.created;
}

/** Последний чат Авито контакта CRM — куда отвечать из карточки. */
export async function avitoChatForContact(contactId: string): Promise<string | null> {
  const row = await db.crmInteraction.findFirst({
    where: { contactId, channel: "avito", externalKey: { startsWith: "avito:" } },
    orderBy: { occurredAt: "desc" },
    select: { externalKey: true },
  });
  return row ? avitoChatIdFromKey(row.externalKey) : null;
}

/** Отправить текст в чат Авито. Возвращает id сообщения у Авито. */
export async function sendAvitoMessage(chatId: string, text: string): Promise<{ id: string; created: number }> {
  const own = await avitoOwnUser();
  const sent = await avitoFetch<{ id: string; created: number }>(
    `/messenger/v1/accounts/${own.id}/chats/${encodeURIComponent(chatId)}/messages`,
    { method: "POST", json: { message: { text }, type: "text" } },
  );
  return sent;
}

/** Подписать вебхук мессенджера на наш адрес. */
export async function subscribeAvitoWebhook(url: string): Promise<unknown> {
  return avitoFetch("/messenger/v3/webhook", { method: "POST", json: { url } });
}
