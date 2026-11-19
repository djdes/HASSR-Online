import { NextResponse } from "next/server";

import { requireApiAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { planOrgCreation } from "@/lib/org-trial.server";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/organizations/creation-preview — на каких условиях аккаунт заведёт
 * ещё одну организацию: займёт оплаченную точку, получит свои 14 дней,
 * останется в пробном периоде аккаунта или будет отказ. Окно «Новая
 * организация» показывает это до отправки; считает то же, что `POST
 * /api/organizations` (`planOrgCreation`). Только владельцу аккаунта.
 */
export async function GET() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
  }
  const account = await db.account.findUnique({
    where: { ownerUserId: session.user.id },
    select: { id: true },
  });
  if (!account) {
    return NextResponse.json(
      { error: "Создавать организации может только владелец аккаунта" },
      { status: 403 },
    );
  }

  const plan = await planOrgCreation(account.id);
  const decision = plan.decision;
  if (!decision.ok) {
    return NextResponse.json({
      ok: false,
      reason: decision.reason,
      limit: decision.limit,
      lockedName: plan.lockedName,
    });
  }
  return NextResponse.json({
    ok: true,
    mode: decision.mode,
    // В пробном периоде аккаунта без свободной выдачи — срок общий, своих 14 дней нет.
    ownTrial: decision.mode === "org_trial" || (decision.mode === "account_trial" && decision.grant),
    trialEndsAt: "trialEndsAt" in decision ? decision.trialEndsAt.toISOString() : null,
    used: decision.mode === "paid_point" ? decision.used : null,
    limit: decision.mode === "paid_point" ? decision.limit : null,
    grantsLeft: plan.grantsLeft,
  });
}
