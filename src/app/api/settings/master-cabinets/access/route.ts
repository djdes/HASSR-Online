import { NextResponse } from "next/server";

import { requireApiAuth } from "@/lib/auth-helpers";
import { handleAccessDelete, handleAccessGet, handleAccessPost } from "@/lib/master-cabinet-access-http";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * «Настройки → Права доступа → Мастер-кабинеты» (только владелец аккаунта).
 *   GET                                                             — кабинеты, люди, кого добавить, организации;
 *   POST { action: "grant", cabinetId, userId }                      — дать доступ сотруднику объекта;
 *   POST { action: "invite", cabinetId, organizationId, name, email } — пригласить по почте сотрудником организации;
 *   DELETE { cabinetId, userId }                                      — убрать доступ.
 */
async function guard() {
  const auth = await requireApiAuth();
  if (!auth.ok) return { error: auth.response } as const;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return { error: NextResponse.json({ error: "Это настройка руководителя" }, { status: 403 }) } as const;
  }
  return { session: auth.session } as const;
}

export async function GET() {
  const auth = await guard();
  if ("error" in auth) return auth.error;
  return handleAccessGet(auth.session);
}

export async function POST(request: Request) {
  const auth = await guard();
  if ("error" in auth) return auth.error;
  return handleAccessPost(request, auth.session);
}

export async function DELETE(request: Request) {
  const auth = await guard();
  if ("error" in auth) return auth.error;
  return handleAccessDelete(request, auth.session);
}
