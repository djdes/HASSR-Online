import { db } from "@/lib/db";

/**
 * Автопост новой статьи в каналы с включённым автоанонсом (ROOT →
 * «Каналы Telegram и MAX»). Старый `TELEGRAM_BLOG_CHANNEL_ID` работает,
 * пока Telegram-канал там не подключён. Шлём один
 * раз — когда статья впервые становится опубликованной (`publishedAt` из
 * null в дату не позже сейчас).
 */
export async function announceArticleIfPublished(input: {
  before: { publishedAt: Date | null };
  after: { slug: string; title: string; excerpt: string; publishedAt: Date | null };
}): Promise<boolean> {
  const wasPublic = Boolean(input.before.publishedAt && input.before.publishedAt <= new Date());
  const isPublic = Boolean(input.after.publishedAt && input.after.publishedAt <= new Date());
  if (wasPublic || !isPublic) return false;
  const [telegram, max] = await Promise.all([announceToTelegram(input.after), announceToMax(input.after)]);
  return telegram || max;
}

async function announceToTelegram(article: { slug: string; title: string; excerpt: string }): Promise<boolean> {
  const channel = process.env.TELEGRAM_BLOG_CHANNEL_ID?.trim();
  if (!channel) return false;
  // Канал подключён в «Каналах Telegram и MAX» — анонс уходит оттуда.
  const connected = await db.maxChannel.count({ where: { platform: "telegram", removed: false } });
  if (connected) return false;
  const { sendTelegramMessage, escapeTelegramHtml } = await import("@/lib/telegram");
  const text = [
    `📝 <b>${escapeTelegramHtml(article.title)}</b>`,
    "",
    escapeTelegramHtml(article.excerpt),
    "",
    `https://wesetup.ru/blog/${article.slug}`,
  ].join("\n");
  try {
    await sendTelegramMessage(channel, text);
    return true;
  } catch (error) {
    console.error("[blog-announce] failed", error);
    return false;
  }
}

async function announceToMax(article: { slug: string; title: string; excerpt: string }): Promise<boolean> {
  try {
    const { announceArticleToChannels } = await import("@/lib/max/channel.server");
    return (await announceArticleToChannels(article)) > 0;
  } catch (error) {
    console.error("[blog-announce] max failed", error instanceof Error ? error.name : "UnknownError");
    return false;
  }
}

/** Для маршрутов ROOT: состояние статьи до правки. */
export async function articlePublishState(id: string): Promise<{ publishedAt: Date | null } | null> {
  return db.article.findUnique({ where: { id }, select: { publishedAt: true } });
}
