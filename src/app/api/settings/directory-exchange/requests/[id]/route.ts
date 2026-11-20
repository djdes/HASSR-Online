import { NextResponse } from "next/server";

import { exchangeErrorResponse, requireExchangeOwner } from "@/lib/directory-exchange/access.server";
import { REQUEST_NOT_FOUND_MESSAGE, endExchangeRequest } from "@/lib/directory-exchange/requests.server";
import { createRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const endLimiter = createRateLimiter({ tokensPerInterval: 20, intervalMs: 60_000 });
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

type Ctx = { params: Promise<{ id: string }> };

/**
 * DELETE /api/settings/directory-exchange/requests/[id] → `{ ok: true }`.
 * Заявитель (владелец аккаунта активной организации): отменить ждущий запрос
 * или выйти из подтверждённой связи. Владелец мастер-кабинета: отключить
 * участника из другого аккаунта. `id` — id запроса, id связи
 * (`foreignLinks[].id`, `foreignMembers[].id`) или id организации-участника
 * (`foreignMembers[].organizationId`). Закончить связь можно и в закрытой
 * организации. Чужое и несуществующее — 404; уже закрытый запрос — 409.
 */
export async function DELETE(_request: Request, ctx: Ctx) {
  const owner = await requireExchangeOwner({ allowLocked: true });
  if (!owner.ok) return owner.response;
  const { organizationId, accountId, actor } = owner.context;
  if (!endLimiter.consume(`directory-exchange:requests:end:${actor.userId}`)) {
    return NextResponse.json({ error: "Слишком много запросов. Подождите минуту." }, { status: 429 });
  }
  const { id } = await ctx.params;
  if (!ID_PATTERN.test(id)) {
    return NextResponse.json({ error: REQUEST_NOT_FOUND_MESSAGE }, { status: 404 });
  }
  try {
    await endExchangeRequest({ id, organizationId, accountId, actor });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return exchangeErrorResponse(error);
  }
}
