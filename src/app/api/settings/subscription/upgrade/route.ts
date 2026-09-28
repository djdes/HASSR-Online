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
 * Ручной переход на платный тариф со страницы «Улучшение тарифа».
 * Тела нет: тариф ровно один, выбирать нечего.
 *
 * Логика — та же `ensurePlanForHeadcount`, что срабатывает автоматически
 * при превышении 3 бесплатных места, только с `force: true`. Второго
 * места, где организации меняют тариф, быть не должно.
 *
 * Оплата не запрашивается, пока не закончился бесплатный период (и в
 * тестовом режиме до него). После — платный тариф только после оплаты:
 * ответ 402 со ссылкой на оплату, тихого перевода нет.
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
        error: "Бесплатный период закончился — подписка подключается после оплаты",
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
