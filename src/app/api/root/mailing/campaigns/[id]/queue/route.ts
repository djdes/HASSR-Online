import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { mailingErrorResponse } from "@/lib/mailing/http.server";
import { getQueueState } from "@/lib/mailing/operations.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — «Состояние очереди»: сколько ждут и почему, план по часам, обработчик, прогноз. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireRoot();
  const { id } = await ctx.params;
  try {
    const state = await getQueueState(id);
    if (!state) return NextResponse.json({ error: "Рассылка не найдена" }, { status: 404 });
    return NextResponse.json(state);
  } catch (error) {
    return mailingErrorResponse(error, "queue state");
  }
}
