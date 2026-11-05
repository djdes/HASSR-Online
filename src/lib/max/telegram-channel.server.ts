import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Bot, GrammyError, HttpError, InputFile } from "grammy";

import { telegramClientOptions } from "@/lib/telegram";
import { uploadsDir } from "@/lib/uploads-path";
import { MaxChannelError } from "./channel-error";
import { planTelegramPost, telegramMessageUrl } from "./telegram-post";

/**
 * Публикации в Telegram-канал (ROOT → «Каналы Telegram и MAX»).
 *
 * Бот: `TELEGRAM_CHANNEL_BOT_TOKEN`, если задан отдельный, иначе основной
 * бот WeSetup (`TELEGRAM_BOT_TOKEN`). Бот должен быть администратором
 * канала с правом публиковать. Сеть — та же, что у основного бота
 * (TELEGRAM_API_ROOT / TELEGRAM_PROXY_URL / TELEGRAM_FORCE_IP).
 */

export function telegramChannelBotToken(): { token: string; separate: boolean } {
  const separate = process.env.TELEGRAM_CHANNEL_BOT_TOKEN?.trim() ?? "";
  if (separate) return { token: separate, separate: true };
  return { token: process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "", separate: false };
}

let cached: { token: string; bot: Bot } | null = null;

function channelBot(): Bot {
  const { token } = telegramChannelBotToken();
  if (!token) throw new MaxChannelError("Бот Telegram не подключён: на сервере не задан токен.", 503);
  if (cached?.token !== token) cached = { token, bot: new Bot(token, { client: telegramClientOptions() }) };
  return cached.bot;
}

/** Ошибка Telegram → понятный текст; токен в сообщения не попадает. */
export function explainTelegramFailure(error: unknown): string {
  if (error instanceof MaxChannelError) return error.message;
  if (error instanceof GrammyError) {
    const description = error.description.toLowerCase();
    if (error.error_code === 401) return "Telegram не принял токен бота — проверьте TELEGRAM_CHANNEL_BOT_TOKEN.";
    if (error.error_code === 429) return "Telegram ограничил частоту запросов — повторите через минуту.";
    if (description.includes("chat not found")) return "Канал не найден в Telegram — проверьте имя и что бот добавлен в канал.";
    if (error.error_code === 403 || description.includes("not enough rights") || description.includes("need administrator rights")) {
      return "У бота нет прав публиковать в канале — сделайте его администратором с правом «Публикация сообщений».";
    }
    if (description.includes("message to edit not found") || description.includes("message to delete not found")) {
      return "Сообщение не найдено в канале — возможно, его удалили вручную.";
    }
    return `Telegram ответил ошибкой ${error.error_code}: ${error.description.slice(0, 200)}`;
  }
  if (error instanceof HttpError) return "Не удалось связаться с Telegram — повторите позже.";
  return "Не удалось связаться с Telegram.";
}

async function call<T>(run: (bot: Bot) => Promise<T>): Promise<T> {
  const bot = channelBot();
  try {
    return await run(bot);
  } catch (error) {
    if (error instanceof MaxChannelError) throw error;
    console.error(
      "[telegram-channel] api failed",
      error instanceof GrammyError ? `${error.method} ${error.error_code} ${error.description.slice(0, 200)}` : (error as Error)?.name,
    );
    const status = error instanceof GrammyError && error.error_code === 429 ? 429 : 502;
    const wrapped = new MaxChannelError(explainTelegramFailure(error), status);
    (wrapped as { cause?: unknown }).cause = error;
    throw wrapped;
  }
}

function isGrammy(error: unknown, pattern: RegExp): boolean {
  const cause = (error as { cause?: unknown })?.cause ?? error;
  return cause instanceof GrammyError && pattern.test(cause.description.toLowerCase());
}

export async function telegramBotInfo(): Promise<{ name: string; username: string } | null> {
  if (!telegramChannelBotToken().token) return null;
  try {
    const me = await call((bot) => bot.api.getMe());
    return { name: me.first_name, username: me.username };
  } catch {
    return null;
  }
}

export type TelegramChannelInfo = { chatId: string; title: string; link: string | null; botIsAdmin: boolean };

/** Канал по @имени или id: название, ссылка и права бота — из Telegram. */
export async function inspectTelegramChannel(ref: string): Promise<TelegramChannelInfo> {
  const chat = await call((bot) => bot.api.getChat(ref));
  if (chat.type !== "channel") throw new MaxChannelError("Это не канал, а чат или группа. Для публикаций нужен канал Telegram.");
  const me = await call((bot) => bot.api.getMe());
  let botIsAdmin = false;
  try {
    const member = await call((bot) => bot.api.getChatMember(chat.id, me.id));
    botIsAdmin =
      member.status === "creator" || (member.status === "administrator" && member.can_post_messages !== false);
  } catch {
    botIsAdmin = false;
  }
  const username = "username" in chat && chat.username ? chat.username : null;
  return {
    chatId: String(chat.id),
    title: ("title" in chat && chat.title ? chat.title : "").trim().slice(0, 200) || `Канал ${chat.id}`,
    link: username ? `https://t.me/${username}` : null,
    botIsAdmin,
  };
}

type TelegramPost = { text: string; images: string[]; buttonText: string | null; buttonUrl: string | null; campaign: string | null };

async function photo(relativePath: string): Promise<InputFile> {
  const bytes = await readFile(join(uploadsDir(), ...relativePath.split("/")));
  return new InputFile(bytes, relativePath.split("/").pop() ?? "image.jpg");
}

function usernameFromLink(link: string | null): string | null {
  return /^https:\/\/t\.me\/([A-Za-z0-9_]+)$/.exec(link ?? "")?.[1] ?? null;
}

/**
 * Отправка поста. Возвращает id сообщений по порядку (фото, затем текст)
 * и ссылку на первое. Если текст после фото не ушёл — фото убираем, чтобы
 * в канале не остался обрывок.
 */
export async function sendTelegramPost(
  channel: { chatId: string; link: string | null },
  post: TelegramPost,
): Promise<{ messageIds: number[]; url: string | null }> {
  const plan = planTelegramPost(post);
  const chatId = channel.chatId;
  const ids: number[] = [];
  if (plan.mode === "caption") {
    const file = await photo(post.images[0]);
    const sent = await call((bot) =>
      bot.api.sendPhoto(chatId, file, { caption: plan.html, parse_mode: "HTML", reply_markup: plan.replyMarkup }),
    );
    ids.push(sent.message_id);
  } else {
    if (plan.mode === "photos-then-text") {
      const files = await Promise.all(post.images.slice(0, 10).map(photo));
      if (files.length === 1) {
        const sent = await call((bot) => bot.api.sendPhoto(chatId, files[0]));
        ids.push(sent.message_id);
      } else {
        const sent = await call((bot) => bot.api.sendMediaGroup(chatId, files.map((media) => ({ type: "photo" as const, media }))));
        ids.push(...sent.map((message) => message.message_id));
      }
    }
    try {
      const sent = await call((bot) =>
        bot.api.sendMessage(chatId, plan.html, {
          parse_mode: "HTML",
          reply_markup: plan.replyMarkup,
          ...(ids.length ? { link_preview_options: { is_disabled: true } } : {}),
        }),
      );
      ids.push(sent.message_id);
    } catch (error) {
      if (ids.length) await deleteTelegramMessages(chatId, ids).catch(() => undefined);
      throw error;
    }
  }
  return { messageIds: ids, url: telegramMessageUrl(usernameFromLink(channel.link), chatId, ids[0]) };
}

/**
 * Правка вышедшего поста: меняются текст и кнопка. Картинки в Telegram
 * после публикации не заменяем — для этого пост удаляют и публикуют снова.
 */
export async function editTelegramPost(
  chatId: string,
  messageIds: number[],
  post: TelegramPost,
  previous: { text: string; images: string[] },
): Promise<void> {
  if (post.images.join("|") !== previous.images.join("|")) {
    throw new MaxChannelError("В Telegram картинки вышедшего поста не меняются — удалите пост и опубликуйте заново.");
  }
  const plan = planTelegramPost(post);
  const before = planTelegramPost({ ...post, text: previous.text });
  if (plan.mode !== before.mode) {
    throw new MaxChannelError(
      "Текст с картинкой стал длиннее 1024 знаков (или короче) — Telegram так не правит. Удалите пост и опубликуйте заново.",
    );
  }
  const last = messageIds[messageIds.length - 1];
  if (!last) throw new MaxChannelError("Пост ещё не опубликован.");
  const replyMarkup = plan.replyMarkup ?? { inline_keyboard: [] };
  try {
    if (plan.mode === "caption") {
      await call((bot) => bot.api.editMessageCaption(chatId, last, { caption: plan.html, parse_mode: "HTML", reply_markup: replyMarkup }));
    } else {
      await call((bot) =>
        bot.api.editMessageText(chatId, last, plan.html, {
          parse_mode: "HTML",
          reply_markup: replyMarkup,
          ...(messageIds.length > 1 ? { link_preview_options: { is_disabled: true } } : {}),
        }),
      );
    }
  } catch (error) {
    // Ничего не поменялось — это не ошибка.
    if (!isGrammy(error, /message is not modified/)) throw error;
  }
}

export async function deleteTelegramMessages(chatId: string, messageIds: number[]): Promise<void> {
  for (const id of messageIds) {
    try {
      await call((bot) => bot.api.deleteMessage(chatId, id));
    } catch (error) {
      // Уже удалено вручную — тот же результат.
      if (!isGrammy(error, /message to delete not found/)) throw error;
    }
  }
}

export function parseTelegramMessageIds(stored: string | null): number[] {
  return (stored ?? "")
    .split(",")
    .map((part) => Number(part))
    .filter((id) => Number.isInteger(id) && id > 0);
}
