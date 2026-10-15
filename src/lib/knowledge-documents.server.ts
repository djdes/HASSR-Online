import { NextResponse } from "next/server";
import { requireApiAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";

export async function requireKnowledgeAccess(manage = false) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth;
  if (!hasCapability(auth.session.user, manage ? "admin.full" : "journals.view")) {
    return { ok: false as const, response: NextResponse.json({ error: "Нет доступа к документации" }, { status: 403 }) };
  }
  return { ...auth, organizationId: getActiveOrgId(auth.session) };
}
