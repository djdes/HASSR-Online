import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { generateEmployeeQrPin, setEmployeeQrPin } from "@/lib/qr-fill-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/staff/[id]/qr-pin — выдать сотруднику новый 4-значный ПИН.
 *
 * Код генерирует система (руководитель не придумывает) и возвращает один
 * раз — показать сотруднику. ПИН — та же личная подпись, что и для QR.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }
  const orgId = getActiveOrgId(auth.session);
  const { id } = await params;

  const user = await db.user.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, name: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 });
  }

  const pin = generateEmployeeQrPin();
  const error = await setEmployeeQrPin(user.id, pin);
  if (error) return NextResponse.json({ error }, { status: 500 });

  return NextResponse.json({ ok: true, userId: user.id, name: user.name, pin });
}
