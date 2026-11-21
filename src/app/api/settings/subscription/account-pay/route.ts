import { NextResponse } from "next/server";
import { z } from "zod";

import { getActiveOrgId, isImpersonating, requireApiAuth } from "@/lib/auth-helpers";
import {
  ACCOUNT_PAY_OWNER_ONLY_MESSAGE,
  AccountPayError,
  payFromAccountBalances,
  previewAccountPayment,
} from "@/lib/balance/account-pay.server";
import { clientIp } from "@/lib/client-ip";
import { refuseMobileAppPayment } from "@/lib/mobile-app-payments";
import { parseCheckoutTarget } from "@/lib/plan-checkout.server";
import { isPointScoped } from "@/lib/point-scope";
import { createRateLimiter } from "@/lib/rate-limit";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { MAX_POINTS } from "@/lib/tariff-plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Оплата — деньги: десяти в минуту человеку хватит; просмотр — чаще (смена точек и периода).
const payLimiter = createRateLimiter({ tokensPerInterval: 10, intervalMs: 60_000 });
const previewLimiter = createRateLimiter({ tokensPerInterval: 60, intervalMs: 60_000 });

const bodySchema = z.object({
  plan: z.string().trim().min(1).max(40),
  cycle: z.enum(["year", "month"]),
  points: z.number().int().min(1).max(MAX_POINTS),
  promoCode: z.string().trim().max(64).nullish(),
  idempotencyKey: z.string().max(100).optional(),
  expectedPriceRub: z.number().int().min(0).max(100_000_000).optional(),
});

/**
 * Оплата тарифа из балансов организаций аккаунта (серия E, Р9–Р10).
 *
 * POST `?preview=1` `{ plan, cycle, points, promoCode? }` → `{ price,
 * activeBalance, missing, sources: [{ orgId, name, amount }], canPay, … }` —
 * что будет при оплате; ничего не двигает.
 *
 * POST `{ plan, cycle, points, promoCode?, idempotencyKey, expectedPriceRub }`
 * → `{ ok: true, status: "paid" | "already", orderId, … }`: недостающее
 * переводится с других организаций аккаунта (сначала с самых больших
 * балансов), затем оплата с баланса активной организации. Повтор с тем же
 * ключом второй раз не переводит и не списывает.
 *
 * Только владелец аккаунта: не «войти как», не руководитель точки, не в
 * приложении WeSetup (там без оплаты). Отказы `{ error, code, params? }`:
 * 400 — поля, промокод; 403 — не владелец; 409 — цена изменилась
 * (`price_changed`), по аккаунту не хватает (`account_short`), перевод или
 * оплата не прошли (`transfer_failed`, `charge_failed` — что уже переведено,
 * в `params`), тариф так не оплатить (`scheduled`, `points`, `exempt`, …).
 */
export async function POST(request: Request) {
  const appRefusal = refuseMobileAppPayment(request);
  if (appRefusal) return appRefusal;
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  if (!hasFullWorkspaceAccess(session.user) || isImpersonating(session) || isPointScoped(session.user) || session.user.partnerAccess) {
    return NextResponse.json({ error: ACCOUNT_PAY_OWNER_ONLY_MESSAGE, code: "not_owner" }, { status: 403 });
  }
  const preview = new URL(request.url).searchParams.get("preview") === "1";
  const limiter = preview ? previewLimiter : payLimiter;
  if (!limiter.consume(`account-pay:${preview ? "preview" : "pay"}:${session.user.id}`)) {
    return NextResponse.json({ error: "Слишком много запросов. Подождите минуту.", code: "rate_limited" }, { status: 429 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  const target = parsed.success ? parseCheckoutTarget({ plan: parsed.data.plan, cycle: parsed.data.cycle, points: parsed.data.points }) : null;
  if (!parsed.success || !target) {
    return NextResponse.json({ error: "Выберите тариф", code: "invalid" }, { status: 400 });
  }
  const base = {
    ownerUserId: session.user.id,
    activeOrganizationId: getActiveOrgId(session),
    target,
    promoCode: parsed.data.promoCode ?? null,
  };

  try {
    if (preview) {
      const result = await previewAccountPayment(base);
      return NextResponse.json({
        price: result.priceRub,
        activeBalance: result.activeBalanceRub,
        missing: result.missingRub,
        accountTotal: result.accountTotalRub,
        activeName: result.activeName,
        sources: result.sources.map((row) => ({ orgId: row.orgId, name: row.name, amount: row.amountRub })),
        canPay: result.canPay,
      });
    }
    if (!parsed.data.idempotencyKey) {
      return NextResponse.json({ error: "Обновите страницу и повторите оплату", code: "invalid" }, { status: 400 });
    }
    const result = await payFromAccountBalances({
      ...base,
      idempotencyKey: parsed.data.idempotencyKey,
      expectedPriceRub: parsed.data.expectedPriceRub ?? null,
      actorName: session.user.name ?? session.user.email ?? null,
      ipAddress: clientIp(request),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof AccountPayError) {
      return NextResponse.json(
        { error: error.message, code: error.code, ...(error.params ? { params: error.params } : {}) },
        { status: error.status },
      );
    }
    throw error;
  }
}
