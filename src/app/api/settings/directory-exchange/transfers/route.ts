import { NextResponse } from "next/server";

import { exchangeErrorResponse, requireExchangeManager } from "@/lib/directory-exchange/access.server";
import { listRecentTransfers } from "@/lib/directory-exchange/transfer-undo.server";
import { createRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = createRateLimiter({ tokensPerInterval: 30, intervalMs: 60_000 });

/**
 * GET /api/settings/directory-exchange/transfers — разовые переносы последних
 * 7 дней в организации аккаунта (серия B, п. 12) → `{ transfers: [{ id,
 * createdAt, from: { name, foreign }, to: { id, name }, counts, undoUntil,
 * undoable, undoneAt, undo }] }`. Владелец аккаунта или управляющий сетью.
 */
export async function GET() {
  const owner = await requireExchangeManager({ allowLocked: true });
  if (!owner.ok) return owner.response;
  const { accountId, actor } = owner.context;
  if (!limiter.consume(`directory-exchange:transfers:${actor.userId}`)) {
    return NextResponse.json({ error: "Слишком много запросов. Подождите минуту." }, { status: 429 });
  }
  try {
    return NextResponse.json({ transfers: await listRecentTransfers({ accountId, userId: actor.userId }) });
  } catch (error) {
    return exchangeErrorResponse(error);
  }
}
