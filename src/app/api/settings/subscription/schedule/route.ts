import { NextResponse } from "next/server";

import { getActiveOrgId, isImpersonating, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { clientIp } from "@/lib/client-ip";
import { formatMskDay } from "@/lib/billing-period";
import { cancelScheduledPlan, loadAccountBilling, scheduleDowngrade } from "@/lib/billing.server";
import { pointsLabel } from "@/lib/cabinet-plan";
import { parseCheckoutTarget } from "@/lib/plan-checkout.server";
import { quotePlanChange } from "@/lib/tariff-plans";
import { readPlanPricing } from "@/lib/tariffs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Понижение тарифа с конца оплаченного срока (тарифы 2026-10).
 *
 * POST   `{ plan, cycle, points }` — запомнить переход: «Премиум» → «Стандарт»,
 *        год → месяц, меньше точек. Сейчас платить нечего; со дня окончания
 *        срока оплачивается уже новый тариф. Повышение сюда не принимается —
 *        оно оформляется оплатой сразу (`/order`).
 * DELETE — отменить запланированный переход.
 *
 * Решает руководитель в своём кабинете: не ROOT «под видом» и не
 * консультант партнёра (как переход на бесплатный).
 */

async function authorize() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth;
  const { session } = auth;
  if (!hasFullWorkspaceAccess(session.user)) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Тариф выбирает руководитель" }, { status: 403 }),
    };
  }
  if (isImpersonating(session) || session.user.partnerAccess) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Тариф выбирает руководитель организации в своём кабинете" },
        { status: 403 }
      ),
    };
  }
  return auth;
}

export async function POST(request: Request) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const target = body ? parseCheckoutTarget({ plan: body.plan, cycle: body.cycle, points: body.points }) : null;
  if (!target) return NextResponse.json({ error: "Выберите тариф" }, { status: 400 });

  const orgId = getActiveOrgId(session);
  const now = new Date();
  const [loaded, pricing] = await Promise.all([loadAccountBilling(orgId, now), readPlanPricing()]);
  if (!loaded) return NextResponse.json({ error: "Организация не найдена" }, { status: 404 });
  const { state } = loaded;
  if (state.kind !== "paid" || !state.paidUntil || !state.paidTier) {
    return NextResponse.json(
      { error: "Запланировать переход можно, пока действует оплаченный тариф. Сейчас тариф подключается оплатой." },
      { status: 409 }
    );
  }
  if (!pricing.available[target.tier][target.cycle]) {
    return NextResponse.json({ error: "Тариф недоступен" }, { status: 400 });
  }
  if (target.points < state.pointsInUse) {
    return NextResponse.json(
      {
        error: `Сейчас в работе ${pointsLabel(state.pointsInUse)} — выберите не меньше или сначала удалите лишние точки.`,
      },
      { status: 409 }
    );
  }

  const change = quotePlanChange({
    rates: pricing.rates,
    legacyMonthlyRub: pricing.legacyMonthlyRub,
    current: { paidUntil: state.paidUntil, tier: state.paidTier, cycle: state.planCycle, points: state.planPoints },
    target,
    now,
  });
  if (change.kind !== "scheduled") {
    return NextResponse.json(
      { error: "Этот тариф подключается сразу — оформите оплату.", payUrl: "/settings/subscription" },
      { status: 409 }
    );
  }

  const result = await scheduleDowngrade({
    organizationId: orgId,
    target: { ...change.target, at: change.periodStart.toISOString() },
    actor: {
      userId: session.user.id,
      userName: session.user.name ?? session.user.email ?? null,
      ipAddress: clientIp(request),
    },
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({
    ok: true,
    scheduled: { ...change.target, at: change.periodStart.toISOString() },
    atLabel: formatMskDay(change.periodStart),
  });
}

export async function DELETE(request: Request) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  await cancelScheduledPlan({
    organizationId: getActiveOrgId(session),
    actor: {
      userId: session.user.id,
      userName: session.user.name ?? session.user.email ?? null,
      ipAddress: clientIp(request),
    },
  });
  return NextResponse.json({ ok: true });
}
