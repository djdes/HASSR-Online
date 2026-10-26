import { NextResponse } from "next/server";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { planLabel } from "@/lib/plan-limits";
import { ensurePlanForHeadcount } from "@/lib/plan-limits.server";
import { BILLING_LIMIT_CODE, BILLING_PAY_HREF } from "@/lib/billing-period";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/settings/subscription/upgrade
 *
 * Прежний «ручной переход на платный» без оплаты. С тарифов 2026-10
 * «Стандарт» и «Премиум» подключаются только оплатой (`/order`), поэтому
 * ответ — 402 со ссылкой на страницу тарифа. Маршрут оставлен для старых
 * клиентов, чтобы они получали понятный ответ, а не 404.
 */
export async function POST() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;

  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json(
      { error: "Только руководитель может менять тариф" },
      { status: 403 }
    );
  }

  const orgId = getActiveOrgId(auth.session);
  const result = await ensurePlanForHeadcount(orgId, { force: true });
  if (result.paymentRequired && !result.upgraded) {
    return NextResponse.json(
      {
        error: "Тариф «Стандарт» или «Премиум» подключается после оплаты",
        code: BILLING_LIMIT_CODE,
        payUrl: BILLING_PAY_HREF,
        plan: result.plan,
      },
      { status: 402 }
    );
  }

  return NextResponse.json({
    ok: true,
    plan: result.plan,
    planLabel: planLabel(result.plan),
    upgraded: result.upgraded,
    activeUsers: result.activeUsers,
  });
}
