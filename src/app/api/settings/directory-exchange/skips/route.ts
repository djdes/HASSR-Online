import { NextResponse } from "next/server";
import { z } from "zod";

import { exchangeErrorResponse, requireExchangeOwner } from "@/lib/directory-exchange/access.server";
import { ignoreExchangeSkip, linkExchangeSkip, listExchangeSkips } from "@/lib/directory-exchange/skips.server";
import { createRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Карточка читает список при каждом открытии; разбор — по одной записи.
const readLimiter = createRateLimiter({ tokensPerInterval: 60, intervalMs: 60_000 });
const actionLimiter = createRateLimiter({ tokensPerInterval: 60, intervalMs: 60_000 });
const TOO_MANY = "Слишком много запросов. Подождите минуту.";

const id = z.string().trim().min(1).max(64);
const actionSchema = z.discriminatedUnion("action", [
  z.object({ id, action: z.literal("ignore") }),
  z.object({ id, action: z.literal("link"), entityId: id }),
]);

/**
 * GET /api/settings/directory-exchange/skips — записи, которые обмен не смог
 * создать у своих организаций аккаунта (нет мест в тарифе, такое название
 * уже есть): `{ total, organizations: [{ organizationId, name, items }] }`,
 * у строк «такое название уже есть» — `candidates` для «Связать с …».
 * Только владелец аккаунта.
 */
export async function GET() {
  const owner = await requireExchangeOwner({ allowLocked: true });
  if (!owner.ok) return owner.response;
  const { accountId, actor } = owner.context;
  if (!readLimiter.consume(`directory-exchange:skips:${actor.userId}`)) {
    return NextResponse.json({ error: TOO_MANY }, { status: 429 });
  }
  try {
    return NextResponse.json(await listExchangeSkips({ accountId }));
  } catch (error) {
    return exchangeErrorResponse(error);
  }
}

/**
 * POST /api/settings/directory-exchange/skips
 * `{ id, action: "ignore" }` — «Не переносить»: обмен больше не создаёт эту
 * запись у организации; `{ id, action: "link", entityId }` — «Связать с …»:
 * запись организации с тем же названием становится той же записью, её данные
 * не меняются. → `{ ok: true }`. Чужое — 404, обмен идёт — 409.
 */
export async function POST(request: Request) {
  const owner = await requireExchangeOwner();
  if (!owner.ok) return owner.response;
  const { accountId, actor } = owner.context;
  if (!actionLimiter.consume(`directory-exchange:skips-action:${actor.userId}`)) {
    return NextResponse.json({ error: TOO_MANY }, { status: 429 });
  }
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Проверьте поля" }, { status: 400 });
  }
  try {
    const body = parsed.data;
    const result =
      body.action === "ignore"
        ? await ignoreExchangeSkip({ accountId, actor }, body.id)
        : await linkExchangeSkip({ accountId, actor }, body.id, body.entityId);
    return NextResponse.json(result);
  } catch (error) {
    return exchangeErrorResponse(error);
  }
}
