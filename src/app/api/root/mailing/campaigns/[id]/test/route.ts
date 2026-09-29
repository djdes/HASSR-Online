import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { sendTestToMe } from "@/lib/mailing/campaigns.server";
import { mailingErrorResponse } from "@/lib/mailing/http.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — «Тестовая отправка мне»: во все отмеченные каналы текущему ROOT, сразу, мимо очереди. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await ctx.params;
  try {
    return NextResponse.json(await sendTestToMe(id, { request, session }));
  } catch (error) {
    return mailingErrorResponse(error, "test send");
  }
}
