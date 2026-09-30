import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { assertOrgMembership } from "@/lib/organization-access";
import { createRateLimiter } from "@/lib/rate-limit";
import { rewriteSessionClaims } from "@/lib/session-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Каждое переключение перевыпускает cookie — это не то, что стоит
// разрешать в цикле.
const switchLimiter = createRateLimiter({
  tokensPerInterval: 10,
  intervalMs: 60_000,
});

/**
 * POST /api/me/active-organization — сменить организацию, в которой
 * человек работает.
 *
 * Единственный способ поменять `activeOrganizationId`: claim пишется на
 * сервере после проверки членства, клиент прислать его не может.
 */
export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  if (!switchLimiter.consume(session.user.id)) {
    return NextResponse.json(
      { error: "Слишком часто. Подождите немного." },
      { status: 429 },
    );
  }

  const body = await request.json().catch(() => null);
  const organizationId =
    typeof body?.organizationId === "string" ? body.organizationId : "";
  if (!organizationId) {
    return NextResponse.json({ error: "Не указана организация" }, { status: 400 });
  }

  const allowed = await assertOrgMembership(session.user.id, organizationId);
  if (!allowed) {
    return NextResponse.json({ error: "Нет доступа к организации" }, { status: 403 });
  }

  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true },
  });
  if (!organization) {
    return NextResponse.json({ error: "Организация не найдена" }, { status: 404 });
  }

  // Переход в свою организацию всегда закрывает кабинет клиента,
  // открытый как партнёр: claim не должен «переехать» в другой контекст.
  const rewrite = await rewriteSessionClaims({
    activeOrganizationId: organization.id,
    partnerAccess: null,
  });
  if (!rewrite.ok) {
    return NextResponse.json({ error: rewrite.reason }, { status: 500 });
  }

  await db.user.update({
    where: { id: session.user.id },
    data: { lastActiveOrganizationId: organization.id },
  });
  console.info(`[orgs] switched user=${session.user.id} to=${organization.id}`);

  await db.auditLog.create({
    data: {
      organizationId: organization.id,
      userId: session.user.id,
      userName: session.user.name ?? null,
      action: "org.switched",
      entity: "organization",
      entityId: organization.id,
      details: { name: organization.name },
    },
  });

  return NextResponse.json({ ok: true, organization });
}
