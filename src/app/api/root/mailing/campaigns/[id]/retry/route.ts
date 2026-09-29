import { NextResponse, after } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { retryFailed } from "@/lib/mailing/campaigns.server";
import { mailingErrorResponse } from "@/lib/mailing/http.server";
import { nudgeMailingQueue } from "@/lib/mailing/worker.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — вернуть в очередь каналы с ошибкой (адреса из стоп-листа всё равно пропустятся). */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await ctx.params;
  try {
    const result = await retryFailed(id, { request, session });
    after(() => nudgeMailingQueue("retry"));
    return NextResponse.json(result);
  } catch (error) {
    return mailingErrorResponse(error, "retry");
  }
}
