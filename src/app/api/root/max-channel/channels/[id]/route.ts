import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH { announceBlog } — автоанонс новых статей блога в этот канал. */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireRoot();
  const { id } = await ctx.params;
  const raw = (await request.json().catch(() => null)) as { announceBlog?: unknown } | null;
  if (typeof raw?.announceBlog !== "boolean") return NextResponse.json({ error: "Нечего менять." }, { status: 400 });
  const updated = await db.maxChannel.updateMany({ where: { id }, data: { announceBlog: raw.announceBlog } });
  if (!updated.count) return NextResponse.json({ error: "Канал не найден." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
