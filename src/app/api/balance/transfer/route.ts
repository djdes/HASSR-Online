import { NextResponse } from "next/server";

import { parseAccountTransfer } from "@/lib/balance/account-transfer";
import { accountTransferErrorResponse, requireAccountTransferSession } from "@/lib/balance/account-transfer-access.server";
import { loadAccountBalances, transferBetweenOwnOrganizations } from "@/lib/balance/account-transfer.server";
import { clientIp } from "@/lib/client-ip";
import { createRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Перевод — деньги: десяти в минуту человеку хватит с запасом.
const limiter = createRateLimiter({ tokensPerInterval: 10, intervalMs: 60_000 });

/**
 * POST /api/balance/transfer `{ fromId, toId, amountRub, comment?,
 * idempotencyKey }` — перевод между своими организациями аккаунта (Р10.2)
 * → `{ ok: true, duplicate, transfer: { fromId, toId, amountRub, createdAt },
 * account }` (`account` — свежая сводка, как у `GET /api/balance/account`).
 *
 * Отказы `{ error, code }`: 400 — поля; 403 — не владелец аккаунта, «войти
 * как», руководитель точки; 404 — организация не из аккаунта; 409 — больше
 * остатка (`params: { name, balanceRub }`). Повтор с тем же ключом —
 * прежний перевод с `duplicate: true`, второй раз не списывается.
 */
export async function POST(request: Request) {
  const access = await requireAccountTransferSession();
  if (!access.ok) return access.response;
  const { session, organizationId } = access;
  if (!limiter.consume(`balance-transfer:${session.user.id}`)) {
    return NextResponse.json({ error: "Слишком много запросов. Подождите минуту." }, { status: 429 });
  }

  const parsed = parseAccountTransfer(await request.json().catch(() => null));
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error, code: parsed.code }, { status: 400 });
  }

  try {
    const result = await transferBetweenOwnOrganizations({
      ownerUserId: session.user.id,
      actorName: session.user.name ?? session.user.email ?? null,
      activeOrgId: organizationId,
      ...parsed.value,
      ipAddress: clientIp(request),
    });
    const account = await loadAccountBalances(session.user.id, organizationId);
    return NextResponse.json({ ok: true, ...result, account });
  } catch (error) {
    return accountTransferErrorResponse(error);
  }
}
