import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import {
  ensureSharedDemoOrganization,
  joinSharedDemoOrganization,
  purgeLegacyDemoOrganizations,
} from "@/lib/demo-organization";
import { createRateLimiter } from "@/lib/rate-limit";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { rewriteSessionClaims } from "@/lib/session-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const openLimiter = createRateLimiter({
  tokensPerInterval: 10,
  intervalMs: 60_000,
});

/**
 * POST /api/organizations/demo — войти в общую демо-организацию.
 *
 * Демо одна на всю платформу и переустанавливается раз в сутки
 * (`lib/demo-organization.ts`). Здесь ничего не создаётся на человека:
 * гость получает членство в общей демо, и сессия переключается в неё.
 * Нет демо или вышел её срок — она ставится заново перед входом.
 *
 * Только владелец аккаунта, как и раньше: у него есть своя организация,
 * куда возвращаться.
 */
export async function POST() {
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
      { error: "Демо-организацию может открыть только владелец аккаунта" },
      { status: 403 },
    );
  }
  if (!openLimiter.consume(session.user.id)) {
    return NextResponse.json({ error: "Слишком часто. Подождите немного." }, { status: 429 });
  }

  const { organizationId, installed } = await ensureSharedDemoOrganization();
  await joinSharedDemoOrganization(session.user.id);

  // Своя демо аккаунта осталась от прежней схемы — общая её заменяет.
  await purgeLegacyDemoOrganizations({ take: 3, accountId: account.id }).catch((error) => {
    console.error("[demo] legacy purge on open failed", error);
  });

  const rewrite = await rewriteSessionClaims({
    activeOrganizationId: organizationId,
    partnerAccess: null,
  });
  if (!rewrite.ok) {
    return NextResponse.json({ error: rewrite.reason }, { status: 500 });
  }
  await db.user.update({
    where: { id: session.user.id },
    data: { lastActiveOrganizationId: organizationId },
  });

  if (installed) {
    await db.auditLog
      .create({
        data: {
          organizationId,
          action: "org.demo.reinstalled",
          entity: "organization",
          entityId: organizationId,
          details: { trigger: "open", ...installed.seed, durationMs: installed.durationMs },
        },
      })
      .catch(() => {});
  }

  return NextResponse.json({ ok: true, organizationId });
}
