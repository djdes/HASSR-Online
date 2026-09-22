import { NextResponse } from "next/server";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { loadOrphanAreas } from "@/lib/room-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — цеха («Цеха и участки», Area), для которых ещё нет помещения
 * с тем же названием. Окно «Добавить помещение» предлагает создать из них
 * помещение одним нажатием.
 */
export async function GET() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const areas = await loadOrphanAreas(getActiveOrgId(auth.session));
  return NextResponse.json({ areas });
}
