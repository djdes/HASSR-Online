import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { detectTemperatureCapas } from "@/lib/capa-auto-detect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * On-demand trigger for the 3-day temperature CAPA detector. Managers
 * can tap this from the CAPA page to scan for new tickets without
 * waiting for the next Tuya cron pass.
 *
 *   POST /api/capa/auto-detect
 *   Auth: management session
 *
 * Returns: { created, skippedExisting, candidates, details[] }
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  if (
    !hasFullWorkspaceAccess({
      role: session.user.role,
      isRoot: session.user.isRoot,
    })
  ) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const organizationId = getActiveOrgId(session);
  const summary = await detectTemperatureCapas({ organizationId });
  return NextResponse.json(summary);
}
