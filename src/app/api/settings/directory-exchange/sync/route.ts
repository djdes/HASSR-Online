import { NextResponse, after } from "next/server";

import { exchangeErrorResponse, requireExchangeOwner } from "@/lib/directory-exchange/access.server";
import { runDirectoryExchangeWithin } from "@/lib/directory-exchange/run.server";
import { findExchangeCabinet } from "@/lib/directory-exchange/settings.server";
import { createRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// «Синхронизировать сейчас» проходит по всем участникам кабинета — частить незачем.
const syncLimiter = createRateLimiter({ tokensPerInterval: 6, intervalMs: 60_000 });

/**
 * POST /api/settings/directory-exchange/sync — «Синхронизировать сейчас»:
 * обмен по всем участникам мастер-кабинета аккаунта → `{ ok: true, summary }`;
 * дольше 8 секунд — `{ ok: true, running: true }`, итог появится в карточке.
 * Только владелец аккаунта; обмен уже идёт или организация закрыта — 409.
 */
export async function POST() {
  const owner = await requireExchangeOwner();
  if (!owner.ok) return owner.response;
  const { accountId, actor } = owner.context;
  if (!syncLimiter.consume(`directory-exchange:sync:${actor.userId}`)) {
    return NextResponse.json({ error: "Слишком много запросов. Подождите минуту." }, { status: 429 });
  }

  const cabinet = await findExchangeCabinet(accountId);
  if (!cabinet) {
    return NextResponse.json({ error: "Обмен справочниками ещё не настроен" }, { status: 400 });
  }
  try {
    const outcome = await runDirectoryExchangeWithin(cabinet.id, { actor });
    if (outcome.running) {
      after(outcome.done);
      return NextResponse.json({ ok: true, running: true });
    }
    return NextResponse.json({ ok: true, summary: outcome.summary });
  } catch (error) {
    return exchangeErrorResponse(error);
  }
}
