import { NextResponse } from "next/server";

import { exchangeErrorResponse, requireExchangeManager } from "@/lib/directory-exchange/access.server";
import { undoTransfer } from "@/lib/directory-exchange/transfer-undo.server";
import { createRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = createRateLimiter({ tokensPerInterval: 10, intervalMs: 60_000 });
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/settings/directory-exchange/transfers/[id]/undo — отменить разовый
 * перенос (серия B, Р12.2) → `{ ok: true, result: { undone, kept } }`:
 * продукты выключены, сотрудники в архиве, остальное созданное удалено;
 * правленное и используемое осталось — с причиной. Владелец аккаунта (или управляющий сетью)
 * получателя: чужой и несуществующий перенос — 404; срок 7 дней вышел или
 * перенос уже отменён — 409.
 */
export async function POST(_request: Request, ctx: Ctx) {
  const owner = await requireExchangeManager({ allowLocked: true });
  if (!owner.ok) return owner.response;
  const { actor } = owner.context;
  if (!limiter.consume(`directory-exchange:transfer-undo:${actor.userId}`)) {
    return NextResponse.json({ error: "Слишком много запросов. Подождите минуту." }, { status: 429 });
  }
  const { id } = await ctx.params;
  if (!ID_PATTERN.test(id)) return NextResponse.json({ error: "Перенос не найден" }, { status: 404 });
  try {
    const result = await undoTransfer({ id, ownerUserId: actor.userId, ownerName: actor.userName });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return exchangeErrorResponse(error);
  }
}
