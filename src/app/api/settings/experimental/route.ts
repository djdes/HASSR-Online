import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { recordAuditLog } from "@/lib/audit-log";

/**
 * PATCH /api/settings/experimental
 *
 * Body: { experimentalUiV2?: boolean }
 *
 * Management-only. Toggles experimental feature flags on the org.
 * Sister-endpoint to /api/settings/compliance — отдельно потому что
 * compliance — это «строгости журналов», а experimental — «бета-фичи».
 */
export async function PATCH(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const session = auth.session;
  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        experimentalUiV2?: unknown;
      }
    | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const data: { experimentalUiV2?: boolean } = {};
  if (typeof body.experimentalUiV2 === "boolean") {
    data.experimentalUiV2 = body.experimentalUiV2;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "Нет полей для обновления" },
      { status: 400 }
    );
  }

  const orgId = getActiveOrgId(session);
  const updated = await db.organization.update({
    where: { id: orgId },
    data,
    select: {
      experimentalUiV2: true,
    },
  });

  await recordAuditLog({
    request,
    session,
    organizationId: orgId,
    action:
      data.experimentalUiV2 === true
        ? "settings.experimental.v2.enable"
        : "settings.experimental.v2.disable",
    entity: "organization",
    entityId: orgId,
    details: data,
  });

  return NextResponse.json(updated);
}
