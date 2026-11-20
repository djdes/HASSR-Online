import { NextResponse } from "next/server";

import { exchangeErrorResponse, requireExchangeOwner } from "@/lib/directory-exchange/access.server";
import { regenerateExchangeCode } from "@/lib/directory-exchange/settings.server";
import { createRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = createRateLimiter({ tokensPerInterval: 5, intervalMs: 60_000 });

/**
 * POST /api/settings/directory-exchange/cabinet/code — «Выдать новый код»
 * мастер-кабинета для запросов от других компаний (серия B, Р13.2) →
 * `{ ok: true, code }`. Прежний код перестаёт приниматься для новых
 * запросов; подключённые компании, ждущие запросы и подключения к меню и
 * сырью не меняются. Только владелец аккаунта; кабинета нет — 404.
 */
export async function POST() {
  const owner = await requireExchangeOwner({ allowLocked: true });
  if (!owner.ok) return owner.response;
  const { accountId, organizationId, actor } = owner.context;
  if (!limiter.consume(`directory-exchange:cabinet-code:${actor.userId}`)) {
    return NextResponse.json({ error: "Слишком много запросов. Подождите минуту." }, { status: 429 });
  }
  try {
    const { code } = await regenerateExchangeCode({
      ownerUserId: actor.userId,
      ownerName: actor.userName,
      accountId,
      organizationId,
    });
    return NextResponse.json({ ok: true, code });
  } catch (error) {
    return exchangeErrorResponse(error);
  }
}
