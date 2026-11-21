import { NextResponse } from "next/server";

import { exchangeErrorResponse, requireExchangeManager } from "@/lib/directory-exchange/access.server";
import { CHANGE_NOT_FOUND_MESSAGE, ExchangeChangeKeptError } from "@/lib/directory-exchange/history";
import { undoExchangeChange } from "@/lib/directory-exchange/history.server";
import { createRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = createRateLimiter({ tokensPerInterval: 10, intervalMs: 60_000 });
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/settings/directory-exchange/history/[id]/undo — отменить одно
 * изменение обмена (серия D, Р5) → `{ ok: true, result: { op, action } }`:
 * созданное удалено (в архиве, выключено) и больше не создаётся обменом;
 * изменённое вернулось к прежним значениям только в этой организации.
 * Владелец аккаунта организации или управляющий сетью: чужое и несуществующее — 404; уже
 * отменено — 409 `change_undone`; запись правили или она используется —
 * 409 `change_kept` с `reason`.
 */
export async function POST(_request: Request, ctx: Ctx) {
  const owner = await requireExchangeManager({ allowLocked: true });
  if (!owner.ok) return owner.response;
  const { actor, accountId } = owner.context;
  if (!limiter.consume(`directory-exchange:history-undo:${actor.userId}`)) {
    return NextResponse.json({ error: "Слишком много запросов. Подождите минуту." }, { status: 429 });
  }
  const { id } = await ctx.params;
  if (!ID_PATTERN.test(id)) return NextResponse.json({ error: CHANGE_NOT_FOUND_MESSAGE }, { status: 404 });
  try {
    // Только изменение в организации аккаунта, в котором человек сейчас работает.
    const result = await undoExchangeChange({ id, actor, accountId });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof ExchangeChangeKeptError) {
      return NextResponse.json({ error: error.message, code: error.code, reason: error.reason }, { status: error.status });
    }
    return exchangeErrorResponse(error);
  }
}
