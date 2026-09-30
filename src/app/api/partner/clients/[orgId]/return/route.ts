import { NextResponse } from "next/server";

import { actorName, requirePartnerApi } from "@/lib/partners/api";
import { partnerErrorResponse } from "@/lib/partners/errors";
import { returnClientToOwnAccount } from "@/lib/partners/org-conversion";
import { createRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = createRateLimiter({ tokensPerInterval: 5, intervalMs: 60_000 });

/**
 * POST — «Сделать моей организацией»: клиент, которого человек сам
 * перевёл из своего аккаунта, возвращается в его личный аккаунт, а
 * сопровождение завершается. Только из партнёрского кабинета; кто и
 * когда может — решает `planReturn` (lib/partners/org-conversion-core.ts).
 */
export async function POST(_request: Request, ctx: { params: Promise<{ orgId: string }> }) {
  const auth = await requirePartnerApi();
  if (!auth.ok) return auth.response;
  const { session, membership } = auth.ctx;
  const { orgId } = await ctx.params;

  if (!limiter.consume(session.user.id)) {
    return NextResponse.json({ error: "Слишком часто. Подождите минуту." }, { status: 429 });
  }

  try {
    const result = await returnClientToOwnAccount({
      partnerId: membership.partnerId,
      brandName: membership.partner.brandName,
      userId: session.user.id,
      actorName: actorName(session),
      organizationId: orgId,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error, blockers: result.blockers }, { status: result.status });
    }
    return NextResponse.json({
      ok: true,
      organizationId: result.organizationId,
      organizationName: result.organizationName,
      inviteRevoked: result.inviteRevoked,
    });
  } catch (error) {
    return partnerErrorResponse(error);
  }
}
