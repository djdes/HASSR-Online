import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/settings/kiosk — настройки общего планшета.
 *   { idleLockSeconds?: number }   — через сколько бездействия перелок
 *   { revokeDeviceId?: string }    — отвязать планшет
 */
const Schema = z.object({
  idleLockSeconds: z.number().int().min(30).max(1800).optional(),
  revokeDeviceId: z.string().min(1).optional(),
});

export async function PATCH(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }
  const orgId = getActiveOrgId(auth.session);

  let body: z.infer<typeof Schema>;
  try {
    body = Schema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? "Bad input" }, { status: 400 });
    }
    throw err;
  }

  if (body.revokeDeviceId) {
    await db.kioskDevice.updateMany({
      where: { id: body.revokeDeviceId, organizationId: orgId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  if (typeof body.idleLockSeconds === "number") {
    await db.organization.update({
      where: { id: orgId },
      data: { kioskIdleLockSeconds: body.idleLockSeconds },
    });
  }

  return NextResponse.json({ ok: true });
}
