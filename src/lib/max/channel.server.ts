import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { db } from "@/lib/db";
import { uploadsDir } from "@/lib/uploads-path";
import { maxConfig } from "./config";
import { buildMaxPostBody, parseChannelMembershipUpdate } from "./channel-post";
import {
  deleteTelegramMessages,
  editTelegramPost,
  inspectTelegramChannel,
  parseTelegramMessageIds,
  sendTelegramPost,
} from "./telegram-channel.server";
import { normalizeTelegramChannelRef } from "./telegram-post";

/**
 * Публикации в каналы WeSetup (ROOT → «Каналы Telegram и MAX»). Здесь —
 * общий конвейер (черновик → расписание → публикация) и площадка MAX;
 * отправка в Telegram — `telegram-channel.server.ts`.
 *
 * Бот: `MAX_CHANNEL_BOT_TOKEN`, если задан отдельный, иначе основной
 * бот WeSetup (`MAX_BOT_TOKEN`). Бот должен быть администратором канала.
 *
 * chat_id канала API отдаёт только событием `bot_added` (GET /chats с
 * июня 2026 не работает): основной бот получает его вебхуком, отдельный —
 * опросом `GET /updates` по кнопке «Найти канал».
 */

import { MaxChannelError } from "./channel-error";

export { MaxChannelError };

export function channelBotToken(): { token: string; separate: boolean } {
  const separate = process.env.MAX_CHANNEL_BOT_TOKEN?.trim() ?? "";
  if (separate) return { token: separate, separate: true };
  return { token: process.env.MAX_BOT_TOKEN?.trim() ?? "", separate: false };
}

type ApiOptions = { method?: string; body?: unknown; timeoutMs?: number };

class MaxApiFailure extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function channelApi<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { token } = channelBotToken();
  if (!token) throw new MaxChannelError("Бот MAX не подключён: на сервере не задан токен.", 503);
  const response = await fetch(maxConfig().apiBase + path, {
    method: options.method ?? "GET",
    headers: { Authorization: token, "Content-Type": "application/json" },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    cache: "no-store",
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    // Только код и короткое сообщение MAX — без заголовков и токена.
    const info = (data ?? {}) as { code?: unknown; message?: unknown };
    const code = typeof info.code === "string" ? info.code : "";
    const message = typeof info.message === "string" ? info.message.slice(0, 300) : "";
    throw new MaxApiFailure(response.status, code, message || `MAX API ${response.status}`);
  }
  return data as T;
}

/** Человеческое объяснение ошибки MAX для истории постов. */
export function explainMaxFailure(error: unknown): string {
  if (error instanceof MaxChannelError) return error.message;
  if (error instanceof MaxApiFailure) {
    if (error.status === 401) return "MAX не принял токен бота — проверьте MAX_CHANNEL_BOT_TOKEN / MAX_BOT_TOKEN.";
    if (error.status === 403) return "У бота нет прав публиковать в канале — сделайте его администратором.";
    if (error.status === 404) return "Канал или сообщение не найдено в MAX — возможно, бота удалили из канала.";
    if (error.status === 429) return "MAX ограничил частоту запросов — повторите через минуту.";
    return `MAX ответил ошибкой ${error.status}${error.message ? `: ${error.message}` : ""}`;
  }
  if (error instanceof Error && error.name === "TimeoutError") return "MAX не ответил вовремя — повторите позже.";
  return "Не удалось связаться с MAX.";
}

export type MaxBotInfo = { name: string; username: string };

export async function channelBotInfo(): Promise<MaxBotInfo | null> {
  if (!channelBotToken().token) return null;
  try {
    const me = await channelApi<{ first_name?: string; username?: string }>("/me", { timeoutMs: 8_000 });
    return { name: me.first_name ?? "Бот", username: me.username ?? "" };
  } catch {
    return null;
  }
}

type MaxChat = { chat_id: number | string; type?: string; title?: string | null; link?: string | null };

/** Сохраняет канал по chat_id: название, ссылка и права бота — из MAX. */
export async function upsertChannel(chatId: string) {
  const chat = await channelApi<MaxChat>(`/chats/${encodeURIComponent(chatId)}`);
  if (chat.type && chat.type !== "channel") {
    throw new MaxChannelError("Это не канал, а чат. Для публикаций нужен канал MAX.");
  }
  let botIsAdmin = false;
  try {
    const me = await channelApi<{ is_admin?: boolean }>(`/chats/${encodeURIComponent(chatId)}/members/me`);
    botIsAdmin = me.is_admin === true;
  } catch {
    botIsAdmin = false;
  }
  const data = {
    title: (chat.title ?? "").trim().slice(0, 200) || `Канал ${chatId}`,
    link: chat.link ?? null,
    botIsAdmin,
    removed: false,
  };
  return db.maxChannel.upsert({ where: { chatId }, create: { chatId, platform: "max", ...data }, update: data });
}

/** Подключает Telegram-канал по @имени, ссылке t.me или id. */
export async function connectTelegramChannel(input: string) {
  const ref = normalizeTelegramChannelRef(input);
  if (!ref) throw new MaxChannelError("Укажите канал как @wesetup, ссылку t.me/wesetup или id -100….");
  const info = await inspectTelegramChannel(ref);
  const data = { title: info.title, link: info.link, botIsAdmin: info.botIsAdmin, removed: false };
  return db.maxChannel.upsert({
    where: { chatId: info.chatId },
    create: { chatId: info.chatId, platform: "telegram", ...data },
    update: data,
  });
}

/**
 * Событие «бота добавили/удалили». Вызывается из вебхука основного бота
 * (только если отдельного бота для канала нет) и из опроса отдельного.
 * Возвращает true, если событие было про канал.
 */
export async function recordChannelMembership(update: unknown): Promise<boolean> {
  const parsed = parseChannelMembershipUpdate(update);
  if (!parsed) return false;
  if (parsed.kind === "removed") {
    await db.maxChannel.updateMany({ where: { chatId: parsed.chatId }, data: { removed: true, botIsAdmin: false } });
    return true;
  }
  try {
    await upsertChannel(parsed.chatId);
  } catch (error) {
    // Чат, а не канал, — просто не запоминаем.
    if (!(error instanceof MaxChannelError)) throw error;
  }
  return true;
}

/** Вебхук основного бота: события каналов, если канал ведёт он же. */
export async function handleChannelWebhookUpdate(update: unknown): Promise<boolean> {
  if (channelBotToken().separate) return false;
  return recordChannelMembership(update);
}

/**
 * «Найти канал»: забирает накопившиеся события отдельного бота. У бота с
 * вебхуком (основного) опрос не работает — там события приходят сами.
 */
export async function discoverChannels(): Promise<{ found: number; refreshed: number }> {
  let found = 0;
  if (channelBotToken().separate) {
    const result = await channelApi<{ updates?: unknown[] }>(
      "/updates?limit=100&timeout=0&types=bot_added,bot_removed",
      { timeoutMs: 20_000 },
    );
    for (const update of result.updates ?? []) {
      if (await recordChannelMembership(update)) found += 1;
    }
  }
  // Освежаем названия и права уже известных каналов.
  let refreshed = 0;
  const known = await db.maxChannel.findMany({ where: { removed: false }, select: { chatId: true, platform: true } });
  for (const channel of known) {
    try {
      if (channel.platform === "telegram") await connectTelegramChannel(channel.chatId);
      else await upsertChannel(channel.chatId);
      refreshed += 1;
    } catch (error) {
      if (channel.platform === "telegram") continue;
      if (error instanceof MaxApiFailure && (error.status === 403 || error.status === 404)) {
        await db.maxChannel.updateMany({ where: { chatId: channel.chatId }, data: { removed: true, botIsAdmin: false } });
      }
    }
  }
  return { found, refreshed };
}

type ImagePayload = { token: string } | { photos: Record<string, unknown> };

async function uploadImage(relativePath: string): Promise<ImagePayload> {
  const bytes = await readFile(join(uploadsDir(), ...relativePath.split("/")));
  const slot = await channelApi<{ url?: string }>("/uploads?type=image", { method: "POST" });
  if (!slot.url) throw new MaxChannelError("MAX не выдал адрес для загрузки картинки.", 502);
  const form = new FormData();
  const name = relativePath.split("/").pop() ?? "image.jpg";
  form.append("data", new Blob([new Uint8Array(bytes)]), name);
  const response = await fetch(slot.url, {
    method: "POST",
    headers: { Authorization: channelBotToken().token },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new MaxApiFailure(response.status, "", "Не удалось загрузить картинку в MAX");
  const result = (await response.json().catch(() => ({}))) as { token?: unknown; photos?: unknown };
  if (typeof result.token === "string" && result.token) return { token: result.token };
  if (result.photos && typeof result.photos === "object") return { photos: result.photos as Record<string, unknown> };
  throw new MaxChannelError("MAX не вернул ключ загруженной картинки.", 502);
}

type PostForSend = {
  text: string;
  images: string[];
  buttonText: string | null;
  buttonUrl: string | null;
  campaign: string | null;
};

async function messageBody(post: PostForSend) {
  const payloads: ImagePayload[] = [];
  for (const path of post.images) payloads.push(await uploadImage(path));
  const body = buildMaxPostBody(post);
  const images = payloads.map((payload) => ({ type: "image" as const, payload }));
  return { ...body, attachments: [...images, ...body.attachments] };
}

/** Картинка ещё обрабатывается в MAX — ждём и повторяем. */
async function withAttachmentRetry<T>(send: () => Promise<T>): Promise<T> {
  const delays = [1_000, 2_000, 4_000, 8_000];
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await send();
    } catch (error) {
      const notReady = error instanceof MaxApiFailure && /attachment\.not\.ready|not\.processed/.test(error.code + error.message);
      if (!notReady || attempt >= delays.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}

type SentMessage = { message?: { body?: { mid?: string }; url?: string } };

/**
 * Публикует пост, если он ещё не отправляется другим процессом. Повторный
 * вызов для опубликованного поста — no-op.
 */
export async function publishPost(postId: string): Promise<{ ok: boolean; error?: string }> {
  const claimed = await db.maxChannelPost.updateMany({
    where: { id: postId, status: { in: ["draft", "scheduled", "failed"] } },
    data: { status: "sending", attempts: { increment: 1 }, error: null },
  });
  if (!claimed.count) return { ok: false, error: "Пост уже опубликован или отправляется." };
  const post = await db.maxChannelPost.findUniqueOrThrow({ where: { id: postId }, include: { channel: true } });
  try {
    if (post.channel.removed) throw new MaxChannelError("Бота удалили из канала — добавьте его снова администратором.");
    if (post.channel.platform === "telegram") {
      const sent = await sendTelegramPost(post.channel, post);
      await db.maxChannelPost.update({
        where: { id: postId },
        data: { status: "sent", sentAt: new Date(), messageId: sent.messageIds.join(","), url: sent.url, error: null },
      });
      return { ok: true };
    }
    const body = await messageBody(post);
    const sent = await withAttachmentRetry(() =>
      channelApi<SentMessage>(`/messages?chat_id=${encodeURIComponent(post.channel.chatId)}`, {
        method: "POST",
        body,
        timeoutMs: 30_000,
      }),
    );
    await db.maxChannelPost.update({
      where: { id: postId },
      data: {
        status: "sent",
        sentAt: new Date(),
        messageId: sent.message?.body?.mid ?? null,
        url: sent.message?.url ?? null,
        error: null,
      },
    });
    return { ok: true };
  } catch (error) {
    const message = explainMaxFailure(error);
    // Сетевой сбой (TypeError «fetch failed») — с кодом причины, без токена.
    const cause = (error as { cause?: { code?: unknown } })?.cause?.code;
    console.error(`[${post.channel.platform}-channel] publish failed`, error instanceof MaxApiFailure ? error.status : (error as Error)?.name, (error as Error)?.message?.slice(0, 200), typeof cause === "string" ? cause : "");
    await db.maxChannelPost.update({ where: { id: postId }, data: { status: "failed", error: message } });
    return { ok: false, error: message };
  }
}

/** Правка уже опубликованного поста прямо в канале. */
export async function editPublishedPost(postId: string, previous: { text: string; images: string[] }): Promise<void> {
  const post = await db.maxChannelPost.findUniqueOrThrow({ where: { id: postId }, include: { channel: true } });
  if (post.status !== "sent" || !post.messageId) throw new MaxChannelError("Пост ещё не опубликован.");
  if (post.channel.platform === "telegram") {
    await editTelegramPost(post.channel.chatId, parseTelegramMessageIds(post.messageId), post, previous);
    return;
  }
  const body = await messageBody(post);
  await withAttachmentRetry(() =>
    channelApi(`/messages?message_id=${encodeURIComponent(post.messageId!)}`, { method: "PUT", body, timeoutMs: 30_000 }),
  );
}

/** Удаляет пост из канала; запись остаётся в истории со статусом «Удалён». */
export async function deletePublishedPost(postId: string): Promise<void> {
  const post = await db.maxChannelPost.findUniqueOrThrow({ where: { id: postId }, include: { channel: true } });
  if (post.status !== "sent" || !post.messageId) throw new MaxChannelError("Пост ещё не опубликован.");
  if (post.channel.platform === "telegram") {
    await deleteTelegramMessages(post.channel.chatId, parseTelegramMessageIds(post.messageId));
    await db.maxChannelPost.update({ where: { id: postId }, data: { status: "deleted" } });
    return;
  }
  try {
    await channelApi(`/messages?message_id=${encodeURIComponent(post.messageId)}`, { method: "DELETE" });
  } catch (error) {
    // Уже удалён в самом MAX — это тот же результат.
    if (!(error instanceof MaxApiFailure && error.status === 404)) throw error;
  }
  await db.maxChannelPost.update({ where: { id: postId }, data: { status: "deleted" } });
}

/** Cron: публикует запланированные посты, чьё время пришло. */
export async function publishDuePosts(now: Date = new Date()): Promise<{ published: number; failed: number }> {
  // «Отправляется» дольше 10 минут — процесс упал посреди отправки. Не
  // повторяем вслепую (пост мог уйти): помечаем ошибкой, решает человек.
  await db.maxChannelPost.updateMany({
    where: { status: "sending", updatedAt: { lt: new Date(now.getTime() - 10 * 60_000) } },
    data: { status: "failed", error: "Отправка прервалась. Проверьте канал: если поста там нет — опубликуйте снова." },
  });
  const due = await db.maxChannelPost.findMany({
    where: { status: "scheduled", scheduledAt: { lte: now } },
    orderBy: { scheduledAt: "asc" },
    take: 10,
    select: { id: true },
  });
  let published = 0;
  let failed = 0;
  for (const post of due) {
    const result = await publishPost(post.id);
    if (result.ok) published += 1;
    else failed += 1;
    // MAX: не больше двух сообщений в секунду в один канал.
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  return { published, failed };
}

/** Анонс новой статьи блога во все каналы (MAX и Telegram) с включённым автоанонсом. */
export async function announceArticleToChannels(article: { slug: string; title: string; excerpt: string }): Promise<number> {
  const channels = await db.maxChannel.findMany({ where: { removed: false, announceBlog: true } });
  let sent = 0;
  for (const channel of channels) {
    const post = await db.maxChannelPost.create({
      data: {
        channelId: channel.id,
        text: `**${article.title}**\n\n${article.excerpt}`,
        buttonText: "Читать статью",
        buttonUrl: `https://wesetup.ru/blog/${article.slug}`,
        campaign: `blog-${article.slug}`.slice(0, 60),
        source: "blog",
      },
    });
    const result = await publishPost(post.id);
    if (result.ok) sent += 1;
  }
  return sent;
}
