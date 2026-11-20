import { NextResponse } from "next/server";

import { accountTransferErrorResponse, requireAccountTransferSession } from "@/lib/balance/account-transfer-access.server";
import { loadAccountBalances } from "@/lib/balance/account-transfer.server";
import { createRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = createRateLimiter({ tokensPerInterval: 60, intervalMs: 60_000 });

/**
 * GET /api/balance/account — «Баланс по аккаунту» (Р10.1): `{ accountId,
 * activeOrganizationId, organizations: [{ id, name, balanceRub, active }],
 * totalRub }`. Только владелец аккаунта активной организации (иначе 403);
 * демо и мастер-кабинеты в список не входят.
 */
export async function GET() {
  const access = await requireAccountTransferSession();
  if (!access.ok) return access.response;
  const { session, organizationId } = access;
  if (!limiter.consume(`balance-account:${session.user.id}`)) {
    return NextResponse.json({ error: "Слишком много запросов. Подождите минуту." }, { status: 429 });
  }
  try {
    return NextResponse.json(await loadAccountBalances(session.user.id, organizationId));
  } catch (error) {
    return accountTransferErrorResponse(error);
  }
}
