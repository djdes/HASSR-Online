import { NextResponse } from "next/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/settings/subscription/resume — вернуть организацию с паузы
 * за неактивность. Возвращаем тот план, с которого ушли в паузу
 * (`pausedFromPlan`), иначе бесплатный. Серия предупреждений
 * сбрасывается: следующие 100 дней отсчитываются заново от момента
 * возобновления (пишем `inactivityResumedAt`), а не от последней записи,
 * которой могло не быть очень давно.
 */
export async function POST() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const organizationId = getActiveOrgId(session);

  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { subscriptionPlan: true, pausedFromPlan: true },
  });
  if (!org) return NextResponse.json({ error: "Организация не найдена" }, { status: 404 });
  if (org.subscriptionPlan !== "paused") {
    return NextResponse.json({ ok: true, plan: org.subscriptionPlan, alreadyActive: true });
  }

  const plan = org.pausedFromPlan && org.pausedFromPlan !== "paused" ? org.pausedFromPlan : "free";
  await db.organization.update({
    where: { id: organizationId },
    data: {
      subscriptionPlan: plan,
      pausedFromPlan: null,
      inactivityWarnedStage: null,
      inactivityWarnedForActivityAt: null,
      inactivityResumedAt: new Date(),
    },
  });
  await db.auditLog.create({
    data: {
      organizationId,
      userId: session.user.id,
      action: "subscription.resumed",
      entity: "organization",
      entityId: organizationId,
      details: { plan },
    },
  });

  return NextResponse.json({ ok: true, plan });
}
