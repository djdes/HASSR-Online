import { NextResponse, type NextRequest } from "next/server";

import { authOptions } from "@/lib/auth";
import { getActiveOrgId, isImpersonating } from "@/lib/auth-helpers";
import { resolveCheckoutDiscount } from "@/lib/promo/checkout";
import { discountForPrice, discountLabel, type AppliedDiscount } from "@/lib/promo/discounts";
import { getSubscriptionOffer } from "@/lib/promo/offer";
import { createRateLimiter } from "@/lib/rate-limit";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { getServerSession } from "@/lib/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Перебор кодов — 20 попыток в 10 минут на IP.
const limiter = createRateLimiter({ tokensPerInterval: 20, intervalMs: 10 * 60 * 1000 });

function clientIp(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

/**
 * POST { code, tariffKey } — проверить промокод до оформления. Ответ —
 * ровно то, что потом посчитает сервер при создании заказа
 * (`resolveCheckoutDiscount`): скидка от цены подписки С АКЦИЕЙ,
 * выгоднейшая из кода и скидки навсегда аккаунта, с пояснением.
 *
 * Плательщик — из сессии. Без входа почту здесь не спрашиваем: «только
 * новым» и персональный код проверит создание заказа (иначе этот открытый
 * адрес подсказывал бы, какие почты платили). Персональный код анониму —
 * `personalPending`: «проверим по почте при оплате».
 */
export async function POST(request: NextRequest) {
  if (!limiter.consume(clientIp(request))) {
    return NextResponse.json({ ok: false, message: "Слишком много попыток — подождите несколько минут" }, { status: 429 });
  }
  const body = (await request.json().catch(() => ({}))) as { code?: unknown; tariffKey?: unknown };
  const code = typeof body.code === "string" ? body.code : "";
  const tariffKey = typeof body.tariffKey === "string" ? body.tariffKey : "";
  const now = new Date();
  const offer = await getSubscriptionOffer(now, tariffKey);
  if (!offer) return NextResponse.json({ ok: false, message: "Тариф недоступен" }, { status: 400 });

  const session = await getServerSession(authOptions).catch(() => null);
  const organizationId =
    session?.user && hasFullWorkspaceAccess(session.user) && !isImpersonating(session)
      ? getActiveOrgId(session)
      : null;
  const result = await resolveCheckoutDiscount({
    promoRaw: code,
    organizationId,
    email: session?.user?.email ?? null,
    offerRub: offer.priceRub,
    now,
    scope: "check",
  });
  // Цена с акцией едет в ответ: если акция началась или кончилась, пока
  // человек был на странице, клиент увидит расхождение и обновит сумму.
  const price = { offerRub: offer.priceRub, promotionId: offer.promotion?.id ?? null };
  const view = (applied: AppliedDiscount | null) => (applied ? { ...applied, label: discountLabel(applied) } : null);
  if (!result.ok) {
    // Код не подошёл, но скидка навсегда аккаунта остаётся — покажем её.
    const fallback: AppliedDiscount | null = result.lifetime
      ? {
          source: "lifetime",
          code: result.lifetime.code,
          kind: result.lifetime.kind,
          value: result.lifetime.value,
          lifetime: true,
          discountRub: discountForPrice(result.lifetime, offer.priceRub),
          lifetimeDiscountId: result.lifetime.id,
        }
      : null;
    return NextResponse.json({
      ok: false,
      message: result.message,
      reason: result.reason,
      fallback: fallback && fallback.discountRub > 0 ? view(fallback) : null,
      ...price,
    });
  }
  const applied = result.applied;
  return NextResponse.json({
    ok: true,
    // Прежние поля — для совместимости: код и скидка, которые применятся.
    code: applied?.code ?? result.typedCode,
    discountRub: applied?.discountRub ?? 0,
    subscriptionRub: offer.priceRub - (applied?.discountRub ?? 0),
    kind: applied?.kind ?? null,
    value: applied?.value ?? null,
    typedCode: result.typedCode,
    applied: view(applied),
    notice: result.notice,
    personalPending: result.personalPending,
    ...price,
  });
}
