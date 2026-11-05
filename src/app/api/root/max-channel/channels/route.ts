import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { MaxChannelError, connectTelegramChannel, discoverChannels, upsertChannel } from "@/lib/max/channel.server";
import { maxChannelFailure } from "@/lib/max/channel-api.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/root/max-channel/channels
 *  { action: "discover" } — найти каналы, куда добавили бота, и обновить права;
 *  { chatId: "-123…" }   — добавить канал MAX по ID вручную;
 *  { platform: "telegram", chatId: "@wesetup" } — подключить Telegram-канал.
 */
export async function POST(request: Request) {
  await requireRoot();
  try {
    const raw = (await request.json().catch(() => null)) as { action?: unknown; chatId?: unknown; platform?: unknown } | null;
    if (raw?.action === "discover") return NextResponse.json(await discoverChannels());
    const chatId = typeof raw?.chatId === "string" ? raw.chatId.trim() : "";
    if (raw?.platform === "telegram") {
      const channel = await connectTelegramChannel(chatId);
      return NextResponse.json({ id: channel.id, title: channel.title, botIsAdmin: channel.botIsAdmin });
    }
    if (!/^-?\d{1,20}$/.test(chatId)) throw new MaxChannelError("ID канала — число, например -71234567890.");
    const channel = await upsertChannel(chatId);
    return NextResponse.json({ id: channel.id, title: channel.title, botIsAdmin: channel.botIsAdmin });
  } catch (error) {
    return maxChannelFailure(error);
  }
}
