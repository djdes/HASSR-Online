import { NextResponse } from "next/server";

import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { LEGAL_VERSION, recordLegalConsent } from "@/lib/legal-consent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/legal/accept — руководитель принял новую редакцию документов
 * в окне «Мы обновили условия». Тело: { consent: true }.
 */
export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as { consent?: unknown } | null;
  if (body?.consent !== true) {
    return NextResponse.json({ error: "Отметьте согласие с документами" }, { status: 400 });
  }
  const user = await db.user.findUnique({ where: { id: auth.session.user.id }, select: { email: true, legalVersion: true } });
  if (!user) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
  if (user.legalVersion !== LEGAL_VERSION) {
    await recordLegalConsent({
      request,
      userId: auth.session.user.id,
      email: user.email,
      organizationId: getActiveOrgId(auth.session),
      source: "update-modal",
    });
  }
  return NextResponse.json({ ok: true, version: LEGAL_VERSION });
}
