import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { revokeLifetimeDiscountById } from "@/lib/promo/lifetime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST — отменить скидку навсегда аккаунта (ROOT → «Промокоды» →
 * «Скидки навсегда»). Следующие оплаты — без неё; уже оплаченные заказы
 * не трогаем. Лог `[promo] lifetime revoked …` и аудит
 * `promo.lifetime.revoke` — внутри revokeLifetimeDiscount.
 */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await ctx.params;
  const result = await revokeLifetimeDiscountById(id, {
    id: session.user.id,
    name: session.user.name ?? session.user.email ?? null,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({
    ok: true,
    revokedAt: result.binding.revokedAt?.toISOString() ?? null,
  });
}
