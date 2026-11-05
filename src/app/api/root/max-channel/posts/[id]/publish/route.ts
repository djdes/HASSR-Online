import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { publishPost } from "@/lib/max/channel.server";
import { maxChannelFailure } from "@/lib/max/channel-api.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — опубликовать черновик, запланированный или упавший пост сейчас. */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireRoot();
  const { id } = await ctx.params;
  try {
    const result = await publishPost(id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return maxChannelFailure(error);
  }
}
