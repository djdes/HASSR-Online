import { NextResponse } from "next/server";

import { exchangeErrorResponse, requireExchangeManager } from "@/lib/directory-exchange/access.server";
import { listExchangeHistory } from "@/lib/directory-exchange/history.server";
import { createRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = createRateLimiter({ tokensPerInterval: 30, intervalMs: 60_000 });

/**
 * GET /api/settings/directory-exchange/history — что обмен справочниками
 * создал или изменил у активной организации за 30 дней (серия D, Р5) →
 * `{ changes: [{ id, createdAt, entity, kind, op, name, from: { name,
 * cabinet, foreign }, undoneAt, undoable }] }`, новые первыми. Организации
 * другого аккаунта источник называется только мастер-кабинетом. Только
 * владелец аккаунта или управляющий сетью.
 */
export async function GET() {
  const owner = await requireExchangeManager({ allowLocked: true });
  if (!owner.ok) return owner.response;
  const { organizationId, actor } = owner.context;
  if (!limiter.consume(`directory-exchange:history:${actor.userId}`)) {
    return NextResponse.json({ error: "Слишком много запросов. Подождите минуту." }, { status: 429 });
  }
  try {
    return NextResponse.json({ changes: await listExchangeHistory({ organizationId }) });
  } catch (error) {
    return exchangeErrorResponse(error);
  }
}
