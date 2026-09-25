import { NextResponse } from "next/server";

import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { inviteColleague, inviteColleagueDeps } from "@/lib/balance/invite-colleague";
import { listReferralInvites } from "@/lib/balance/referral";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/balance/referrals — пригласить друга письмом.
 *
 * Письмо уходит от WeSetup, но с именем рекомендателя в теле. Проверки,
 * лимиты (без них эндпоинт — открытый релей), письмо и запись приглашения
 * — в `inviteColleague` (src/lib/balance/invite-colleague.ts): той же
 * функцией пользуется опрос «Посоветуете WeSetup коллегам?».
 */
export async function POST(request: Request) {
  const session = await requireAuth();
  const organizationId = getActiveOrgId(session);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }
  const body = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};

  const result = await inviteColleague(
    {
      source: "balance",
      organizationId,
      actor: { id: session.user.id, name: session.user.name, email: session.user.email },
      email: body.email,
      message: body.message,
    },
    inviteColleagueDeps({ request, session }),
  );
  if (!result.ok) {
    return NextResponse.json(result.body, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    invites: await listReferralInvites(organizationId),
  });
}
