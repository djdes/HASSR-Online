import { NextResponse } from "next/server";

import { exchangeErrorResponse, requireExchangeOwner } from "@/lib/directory-exchange/access.server";
import { ensureExchangeCabinet, exchangeCabinetCode } from "@/lib/directory-exchange/settings.server";
import { createRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = createRateLimiter({ tokensPerInterval: 10, intervalMs: 60_000 });

/**
 * POST /api/settings/directory-exchange/cabinet — код мастер-кабинета для
 * обмена с другой компанией. Кабинета у аккаунта ещё нет (одна организация,
 * обмен не настраивали) — заводится «Мастер-кабинет». Код владелец передаёт
 * той компании; её запрос придёт ему на почту. Только владельцу аккаунта.
 * → `{ ok: true, cabinet: { id, name, code } }`.
 */
export async function POST() {
  const owner = await requireExchangeOwner();
  if (!owner.ok) return owner.response;
  const { accountId, actor } = owner.context;
  if (!limiter.consume(`directory-exchange:cabinet:${actor.userId}`)) {
    return NextResponse.json({ error: "Слишком много запросов. Подождите минуту." }, { status: 429 });
  }
  try {
    const cabinet = await ensureExchangeCabinet(actor.userId, accountId);
    const code = await exchangeCabinetCode(cabinet.id);
    if (!code) return NextResponse.json({ error: "Не удалось получить код — попробуйте ещё раз" }, { status: 409 });
    return NextResponse.json({ ok: true, cabinet: { id: cabinet.id, name: cabinet.name, code } });
  } catch (error) {
    return exchangeErrorResponse(error);
  }
}
