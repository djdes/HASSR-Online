import { db } from "@/lib/db";
import { escapeHtml } from "@/lib/html-escape";
import type { IngestedItem } from "@/lib/crm/ingest.server";
import { claim, listSalesHeads, settle } from "@/lib/crm/notify.server";
import { telegramBotConfigured } from "@/lib/mailing/channels.server";
import { sendTelegramMessage } from "@/lib/telegram";
import { avitoBalances } from "@/lib/avito/account.server";
import { avitoChatIdFromKey, avitoChatUrl } from "@/lib/avito/messenger";
import {
  AVITO_NOTIFY_KEY,
  composeAvitoAlert,
  composeLowBalanceAlert,
  normalizeAvitoNotify,
  type AvitoNotifySettings,
} from "@/lib/avito/notify";

/**
 * Уведомления по Авито в Telegram: новое сообщение в чате (сразу, в любое
 * время — лид с Авито остывает за час) и аванс ниже порога (раз в день).
 * Получатели — РОП, ответственный за контакт и список из настроек
 * (CRM → Авито). Повторов нет: ключ в `CrmReminderLog` берётся до отправки.
 */

const APP_URL = () => process.env.NEXTAUTH_URL || "https://wesetup.ru";
/** Старее — это догрузка истории, а не живое сообщение: не шумим. */
const FRESH_MS = 6 * 60 * 60 * 1000;

export async function readAvitoNotify(): Promise<AvitoNotifySettings> {
  const row = await db.platformSetting.findUnique({ where: { key: AVITO_NOTIFY_KEY } });
  if (!row) return normalizeAvitoNotify(null);
  try {
    return normalizeAvitoNotify(JSON.parse(row.value));
  } catch {
    return normalizeAvitoNotify(null);
  }
}

export async function writeAvitoNotify(settings: AvitoNotifySettings): Promise<void> {
  const value = JSON.stringify(settings);
  await db.platformSetting.upsert({ where: { key: AVITO_NOTIFY_KEY }, create: { key: AVITO_NOTIFY_KEY, value }, update: { value } });
}

async function telegramTargets(ownerId: string | null, settings: AvitoNotifySettings): Promise<string[]> {
  const chats = new Set<string>();
  for (const head of await listSalesHeads()) if (head.telegramChatId) chats.add(head.telegramChatId);
  if (ownerId) {
    const owner = await db.user.findFirst({ where: { id: ownerId, isActive: true, archivedAt: null }, select: { telegramChatId: true } });
    if (owner?.telegramChatId) chats.add(owner.telegramChatId);
  }
  for (const chat of settings.chats) chats.add(chat.chatId);
  return [...chats];
}

async function broadcast(chatIds: string[], text: string, kind: string, dedupeKey: string): Promise<number> {
  let delivered = 0;
  for (const chatId of chatIds) {
    const ok = await sendTelegramMessage(chatId, text, { delivery: { kind: `crm:${kind}`, dedupeKey: `${dedupeKey}:${chatId}` } }).catch((error: unknown) => {
      console.error("[avito] Telegram не ушёл", error);
      return false;
    });
    if (ok) delivered += 1;
  }
  return delivered;
}

/** Входящие сообщения одного прохода по чату → одно уведомление на чат. */
export async function notifyAvitoMessages(ingested: readonly IngestedItem[], now = new Date()): Promise<number> {
  if (!telegramBotConfigured()) return 0;
  const fresh = ingested.filter(
    (entry) => entry.contactId && entry.item.direction === "in" && now.getTime() - entry.item.occurredAt.getTime() < FRESH_MS,
  );
  const byChat = new Map<string, IngestedItem[]>();
  for (const entry of fresh) {
    const chatId = avitoChatIdFromKey(entry.item.externalKey);
    if (!chatId) continue;
    byChat.set(chatId, [...(byChat.get(chatId) ?? []), entry]);
  }
  if (!byChat.size) return 0;
  const settings = await readAvitoNotify();
  let sent = 0;
  for (const [chatId, entries] of byChat) {
    const last = entries[entries.length - 1];
    const contact = await db.crmContact.findUnique({ where: { id: last.contactId! }, select: { id: true, name: true, ownerId: true, stage: true } });
    if (!contact || contact.stage === "spam") continue;
    const dedupeKey = `crm:avito:${last.item.externalKey}`;
    const logId = await claim(dedupeKey, "avito_message", contact.id);
    if (!logId) continue;
    const text = composeAvitoAlert({
      isNewContact: entries.some((entry) => entry.isNewContact),
      name: contact.name ?? last.item.identity.name ?? null,
      adTitle: last.item.subject?.replace(/^Авито:\s*/, "") || null,
      messages: entries.map((entry) => entry.item.body),
      crmUrl: `${APP_URL()}/root/crm/contacts/${contact.id}`,
      chatUrl: avitoChatUrl(chatId),
      escape: escapeHtml,
    });
    const delivered = await broadcast(await telegramTargets(contact.ownerId, settings), text, "avito_message", dedupeKey);
    await settle(logId, delivered);
    if (delivered) sent += 1;
  }
  return sent;
}

let lastBalanceCheck = 0;

/** Аванс ниже порога — одно напоминание в день (днём по Москве). Смотрим не чаще раза в час. */
export async function checkAvitoBalance(now = new Date()): Promise<{ advanceRub: number | null; alerted: boolean }> {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Moscow", hour: "2-digit", hourCycle: "h23" }).format(now));
  if (hour < 9 || hour >= 21 || now.getTime() - lastBalanceCheck < 60 * 60 * 1000) return { advanceRub: null, alerted: false };
  lastBalanceCheck = now.getTime();
  const settings = await readAvitoNotify();
  if (!settings.lowBalanceRub || !telegramBotConfigured()) return { advanceRub: null, alerted: false };
  const balances = await avitoBalances();
  if (balances.advanceRub === null || balances.advanceRub >= settings.lowBalanceRub) return { advanceRub: balances.advanceRub, alerted: false };
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(now);
  const dedupeKey = `crm:avito-balance:${day}`;
  const logId = await claim(dedupeKey, "avito_balance", null);
  if (!logId) return { advanceRub: balances.advanceRub, alerted: false };
  const text = composeLowBalanceAlert({
    advanceRub: balances.advanceRub,
    walletRub: balances.walletRub ?? 0,
    threshold: settings.lowBalanceRub,
    pageUrl: `${APP_URL()}/root/crm/avito`,
  });
  const delivered = await broadcast(await telegramTargets(null, settings), text, "avito_balance", dedupeKey);
  await settle(logId, delivered);
  return { advanceRub: balances.advanceRub, alerted: delivered > 0 };
}
