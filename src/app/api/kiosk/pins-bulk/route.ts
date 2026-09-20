import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { ORG_ROSTER_WHERE } from "@/lib/journal-roster";
import { generateEmployeeQrPin, setEmployeeQrPin } from "@/lib/qr-fill-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/kiosk/pins-bulk — выдать ПИН всем сотрудникам без кода.
 *
 * Чтобы на общем планшете сразу могли подписывать все, а руководителю
 * осталось раздать коды. Возвращает список {name, pin} один раз.
 */
export async function POST() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }
  const orgId = getActiveOrgId(auth.session);

  const users = await db.user.findMany({
    where: { organizationId: orgId, ...ORG_ROSTER_WHERE, qrPinHash: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const issued: Array<{ userId: string; name: string; pin: string }> = [];
  for (const user of users) {
    const pin = generateEmployeeQrPin();
    const error = await setEmployeeQrPin(user.id, pin);
    if (!error) issued.push({ userId: user.id, name: user.name, pin });
  }

  return NextResponse.json({ ok: true, issued });
}
