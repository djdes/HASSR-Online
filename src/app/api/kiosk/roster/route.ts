import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ORG_ROSTER_WHERE } from "@/lib/journal-roster";
import { resolveKioskContext } from "@/lib/kiosk-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/kiosk/roster — список сотрудников общего планшета.
 *
 * По device-cookie отдаём активных сотрудников организации (и точки, если
 * задана) с пометкой, задан ли у каждого ПИН. Без ПИН подписать нельзя —
 * такой сотрудник показывается неактивным с подсказкой обратиться к
 * руководителю.
 */
export async function GET() {
  const ctx = await resolveKioskContext();
  if (!ctx) {
    return NextResponse.json({ error: "Планшет не привязан" }, { status: 401 });
  }

  const buildingFilter = ctx.device.buildingId
    ? { OR: [{ buildingIds: { has: ctx.device.buildingId } }, { buildingIds: { isEmpty: true } }] }
    : {};

  const users = await db.user.findMany({
    where: { organizationId: ctx.device.organizationId, ...ORG_ROSTER_WHERE, ...buildingFilter },
    select: { id: true, name: true, positionTitle: true, role: true, qrPinHash: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({
    device: { id: ctx.device.id, label: ctx.device.label },
    organization: { name: ctx.organization.name },
    idleLockSeconds: ctx.organization.kioskIdleLockSeconds,
    employees: users.map((u) => ({
      id: u.id,
      name: u.name,
      positionTitle: u.positionTitle,
      hasPin: Boolean(u.qrPinHash),
    })),
  });
}
