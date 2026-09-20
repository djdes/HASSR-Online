import { NextResponse } from "next/server";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { loadGuideTree } from "@/lib/journal-guide-tree";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/settings/journal-guides/[code]
 * → возвращает `{ tree: GuideTree | null }`. null значит шаблон ещё
 * не заведён, UI должен предложить «Создать первый шаг».
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ code: string }> }
) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const { code } = await ctx.params;
  const organizationId = getActiveOrgId(auth.session);
  const tree = await loadGuideTree(organizationId, code);
  return NextResponse.json({ tree });
}
