import { NextResponse } from "next/server";

import { getActiveOrgId, isImpersonating, requireApiAuth } from "@/lib/auth-helpers";
import { clientIp } from "@/lib/client-ip";
import { convertOrganizationToPartnerClient } from "@/lib/partners/org-conversion";
import { createRateLimiter } from "@/lib/rate-limit";
import { rewriteSessionClaims } from "@/lib/session-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Перевод — редкое действие: хватит на повтор после ошибки, но не на цикл.
const limiter = createRateLimiter({ tokensPerInterval: 5, intervalMs: 60_000 });

/**
 * POST /api/settings/organization/partner-client — владелец переводит
 * активную организацию в клиенты своего партнёрского кабинета.
 *
 * Тело: `{ organizationId }` — организация, которую человек видел на
 * странице. Если в другой вкладке он уже переключился на другую,
 * переводить «активную» было бы сюрпризом — отказываем.
 *
 * Все проверки и последствия — в `lib/partners/org-conversion*.ts`; здесь
 * только сессия: организация уходит из списка человека, поэтому активной
 * становится его домашняя (при переезде профиля — новая домашняя, с новой
 * версией сессий, чтобы старые токены не пускали в переведённую).
 */
export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  if (!limiter.consume(session.user.id)) {
    return NextResponse.json({ error: "Слишком часто. Подождите минуту." }, { status: 429 });
  }

  const organizationId = getActiveOrgId(session);
  const body = (await request.json().catch(() => null)) as { organizationId?: unknown } | null;
  if (body?.organizationId !== organizationId) {
    return NextResponse.json(
      { error: "Активная организация сменилась в другой вкладке — обновите страницу." },
      { status: 409 },
    );
  }

  const actorName = session.user.name?.trim() || session.user.email || "Владелец";
  const result = await convertOrganizationToPartnerClient({
    userId: session.user.id,
    userEmail: session.user.email ?? "",
    actorName,
    organizationId,
    inForeignMode: Boolean(session.user.partnerAccess) || isImpersonating(session),
    ipAddress: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error, blockers: result.blockers }, { status: result.status });
  }

  const rewrite = await rewriteSessionClaims({
    activeOrganizationId: result.activeOrganizationId,
    partnerAccess: null,
    ...(result.homeMove
      ? {
          organizationId: result.homeMove.toOrganizationId,
          organizationName: result.homeMove.toOrganizationName,
          sv: result.sessionVersion,
        }
      : {}),
  });
  if (!rewrite.ok) {
    // Перевод уже случился. Сессия перепроверяет членство на каждом
    // запросе и сама вернёт человека в домашнюю организацию; при переезде
    // профиля — попросит войти заново.
    console.error(`[partners] org converted, session rewrite failed org=${organizationId}: ${rewrite.reason}`);
  }

  return NextResponse.json({
    ok: true,
    organizationId: result.organizationId,
    homeMoved: Boolean(result.homeMove),
    redirect: `/partner/clients/${result.organizationId}`,
  });
}
