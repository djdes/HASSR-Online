import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helpers";
import { inviteColleague, inviteColleagueDeps } from "@/lib/balance/invite-colleague";
import { db } from "@/lib/db";
import { runNpsRecommendation } from "@/lib/nps-recommend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { responseId, email, message } — письмо коллеге после оценки 4–5
 * в опросе «Посоветуете WeSetup коллегам?». Это то же приглашение, что в
 * «Баланс и бонусы» (`inviteColleague`, source = "nps"): реферальная
 * ссылка, запись ReferralInvite, общие лимиты организации — плюс добавки
 * опроса и AuditLog `nps.recommend`.
 */
export async function POST(request: Request) {
  const session = await requireAuth();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const deps = inviteColleagueDeps({ request, session });
  const result = await runNpsRecommendation(
    { actor: { id: session.user.id, name: session.user.name, email: session.user.email }, body },
    {
      findResponse: (id) =>
        db.npsResponse.findUnique({
          where: { id },
          select: { id: true, userId: true, organizationId: true, score: true, scale: true },
        }),
      inviteColleague: (input) => inviteColleague(input, deps),
    },
  );
  if (result.status === 200) {
    console.info(`[nps] рекомендация коллеге: user=${session.user.id} delivery=${result.body.delivery}`);
  } else if (result.status === 502) {
    console.error(`[nps] рекомендация коллеге не ушла: user=${session.user.id}`);
  }
  return NextResponse.json(result.body, { status: result.status });
}
