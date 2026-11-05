import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { channelBotInfo, channelBotToken } from "@/lib/max/channel.server";
import { telegramBotInfo, telegramChannelBotToken } from "@/lib/max/telegram-channel.server";
import { MaxChannelClient, type ChannelView, type PostView } from "./max-channel-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = { title: "Каналы Telegram и MAX" };

/**
 * ROOT → «Каналы Telegram и MAX»: СММ-посты в каналы WeSetup —
 * сразу, по расписанию (cron /api/cron/max-channel) или черновиком;
 * правка и удаление опубликованного; автоанонс статей блога.
 */
export default async function RootMaxChannelPage() {
  await requireRoot();
  const [bot, telegramBot, channels, posts, articles] = await Promise.all([
    channelBotInfo(),
    telegramBotInfo(),
    db.maxChannel.findMany({ orderBy: [{ removed: "asc" }, { createdAt: "asc" }] }),
    db.maxChannelPost.findMany({ orderBy: { createdAt: "desc" }, take: 60 }),
    db.article.findMany({
      where: { publishedAt: { not: null, lte: new Date() } },
      orderBy: { publishedAt: "desc" },
      take: 30,
      select: { slug: true, title: true, excerpt: true },
    }),
  ]);
  const maxToken = channelBotToken();
  const telegramToken = telegramChannelBotToken();

  const channelViews: ChannelView[] = channels.map((channel) => ({
    id: channel.id,
    platform: channel.platform === "telegram" ? "telegram" : "max",
    chatId: channel.chatId,
    title: channel.title,
    link: channel.link,
    botIsAdmin: channel.botIsAdmin,
    removed: channel.removed,
    announceBlog: channel.announceBlog,
  }));
  const postViews: PostView[] = posts.map((post) => ({
    id: post.id,
    channelId: post.channelId,
    text: post.text,
    images: post.images,
    buttonText: post.buttonText,
    buttonUrl: post.buttonUrl,
    campaign: post.campaign,
    status: post.status as PostView["status"],
    scheduledAt: post.scheduledAt?.toISOString() ?? null,
    sentAt: post.sentAt?.toISOString() ?? null,
    url: post.url,
    error: post.error,
    source: post.source,
    createdAt: post.createdAt.toISOString(),
  }));

  return (
    <MaxChannelClient
      bots={{
        max: { info: bot, tokenConfigured: Boolean(maxToken.token), separate: maxToken.separate },
        telegram: { info: telegramBot, tokenConfigured: Boolean(telegramToken.token), separate: telegramToken.separate },
      }}
      channels={channelViews}
      posts={postViews}
      articles={articles}
    />
  );
}
