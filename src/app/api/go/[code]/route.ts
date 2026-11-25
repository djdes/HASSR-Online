import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { withUtm } from "@/lib/max/channel-post";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Превью ссылок мессенджеров и поисковые боты — не переходы людей. */
const BOT_UA = /bot|crawler|spider|preview|telegram|whatsapp|vkshare|facebookexternalhit|slack|discord|curl|wget/i;

/**
 * GET /api/go/<код> — короткая ссылка кнопки поста в канале (A16): считает
 * переход (A28) и ведёт на адрес кнопки с UTM площадки.
 */
export async function GET(request: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  if (!/^[A-Za-z0-9]{4,16}$/.test(code)) return NextResponse.redirect(new URL("/", request.url));
  const post = await db.maxChannelPost.findUnique({
    where: { shortCode: code },
    select: { id: true, buttonUrl: true, campaign: true },
  });
  if (!post?.buttonUrl) return NextResponse.redirect("https://wesetup.ru/");
  const source = new URL(request.url).searchParams.get("c") === "tg" ? "telegram" : "max";
  if (!BOT_UA.test(request.headers.get("user-agent") ?? "")) {
    await db.maxChannelPost.update({ where: { id: post.id }, data: { clicks: { increment: 1 } } }).catch(() => {});
  }
  return NextResponse.redirect(withUtm(post.buttonUrl, post.campaign, source), 302);
}
