import { NextResponse } from "next/server";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { getUserPermissions } from "@/lib/permissions-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAuth();
  const perms = await getUserPermissions(session.user.id);
  if (!perms.has("equipment.view") && !session.user.isRoot) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }

  const orgId = getActiveOrgId(session);
  const equipment = await db.equipment.findMany({
    where: { area: { organizationId: orgId } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      type: true,
      areaId: true,
      // Норма температуры — то, ради чего в журнал и смотрят: без неё
      // человек не знает, нормальные ли показания он записывает.
      tempMin: true,
      tempMax: true,
      area: { select: { name: true } },
    },
  });

  return NextResponse.json({
    equipment: equipment.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type,
      tempMin: e.tempMin,
      tempMax: e.tempMax,
      areaName: e.area?.name ?? "—",
    })),
  });
}
