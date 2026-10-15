import { NextResponse } from "next/server";
import { rewriteSessionClaims } from "@/lib/session-token";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clientIp(request?: Request): string | null {
  if (!request) return null;
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = request.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return null;
}

/**
 * Перевыпускает session-cookie с новым `actingAsOrganizationId`.
 * Механика общая с переключением организаций — см. lib/session-token.ts.
 */
async function rewriteSessionToken(
  next: string | null,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return rewriteSessionClaims({ actingAsOrganizationId: next }, (token) =>
    token.isRoot === true ? null : "Только ROOT может impersonate",
  );
}

/**
 * POST /api/root/impersonate — validates the target org and writes an
 * AuditLog row. The client then calls `useSession().update()` to refresh
 * its JWT with the new `actingAsOrganizationId` claim. This endpoint does
 * not return a cookie — the browser keeps the same session, just with the
 * claim overwritten, so stopping impersonation is a clean mirror.
 *
 * DELETE — clears the claim (logs a matching stop entry).
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isRoot) {
    return NextResponse.json({ error: "Not found", errorCode: "ROOT_NOT_FOUND" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const organizationId =
    typeof body?.organizationId === "string" ? body.organizationId : null;
  if (!organizationId) {
    return NextResponse.json(
      { error: "organizationId обязателен", errorCode: "ORG_ID_REQUIRED" },
      { status: 400 }
    );
  }

  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true },
  });
  if (!org) {
    return NextResponse.json({ error: "Организация не найдена", errorCode: "ORG_NOT_FOUND" }, { status: 404 });
  }

  await db.auditLog.create({
    data: {
      organizationId: org.id,
      userId: session.user.id,
      userName: session.user.name ?? session.user.email ?? "root",
      action: "impersonate.start",
      entity: "Organization",
      entityId: org.id,
      details: { organizationName: org.name },
      ipAddress: clientIp(request),
    },
  });

  const rewrite = await rewriteSessionToken(org.id);
  if (!rewrite.ok) {
    return NextResponse.json(
      { error: `Не удалось обновить сессию: ${rewrite.reason}`, errorCode: "ROOT_IMPERSONATE_FAILED" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, organization: org });
}

export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isRoot) {
    return NextResponse.json({ error: "Not found", errorCode: "ROOT_NOT_FOUND" }, { status: 404 });
  }
  const target = session.user.actingAsOrganizationId;
  if (target) {
    await db.auditLog.create({
      data: {
        organizationId: target,
        userId: session.user.id,
        userName: session.user.name ?? session.user.email ?? "root",
        action: "impersonate.stop",
        entity: "Organization",
        entityId: target,
        ipAddress: clientIp(request),
      },
    });
  }
  // Чистим actingAsOrganizationId в JWT — даже если update() от клиента
  // не сработает, сервер уже выпустит cookie без impersonation.
  await rewriteSessionToken(null);
  return NextResponse.json({ ok: true });
}
