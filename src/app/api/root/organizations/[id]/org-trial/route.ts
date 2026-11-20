import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { parseOrgTrialAdminAction } from "@/lib/org-trial-admin";
import { applyOrgTrialAdminAction, OrgTrialAdminError } from "@/lib/org-trial-admin.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/root/organizations/[id]/org-trial — свои 14 дней организации
 * (серия B, Р11.2): `{ action: "extend", days }` (1–60, от более позднего из
 * «сейчас» и текущего срока), `{ action: "clear" }` (снять отметку) или
 * `{ action: "reset_grants" }` (обнулить счётчик выданных у аккаунта)
 * → `{ ok: true, before, after }` (`{ trialEndsAt, orgTrialsGranted }`).
 *
 * Раздел «Оплаты и тарифы» (`platform-access.ts`); без него — 404, как у
 * остальных маршрутов панели. Отказы `{ error, errorCode }`: 400 —
 * `ORG_TRIAL_INVALID`, 404 — `ORG_NOT_FOUND`, 409 — `ORG_NO_ACCOUNT`,
 * `ORG_TRIAL_NO_MARK`. Журнал действий — «было/стало».
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await context.params;

  const parsed = parseOrgTrialAdminAction(await request.json().catch(() => null));
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error, errorCode: "ORG_TRIAL_INVALID" }, { status: 400 });
  }

  try {
    const result = await applyOrgTrialAdminAction({
      organizationId: id,
      action: parsed.value,
      actor: { userId: session.user.id, userName: session.user.name ?? session.user.email ?? null },
      request,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof OrgTrialAdminError) {
      return NextResponse.json({ error: error.message, errorCode: error.code }, { status: error.status });
    }
    throw error;
  }
}
