import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getServerSession } from "@/lib/server-session";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { getUserPermissions } from "@/lib/permissions-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  // Та же проверка, что у `/api/mini/equipment` и у вкладки в меню:
  // раньше список оборудования отдавался любому вошедшему.
  const perms = await getUserPermissions(session.user.id);
  if (!perms.has("equipment.view") && !session.user.isRoot) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }

  const orgId = getActiveOrgId(session);

  const equipment = await db.equipment.findMany({
    where: {
      area: { organizationId: orgId },
      tuyaDeviceId: { not: null },
    },
    select: {
      id: true,
      name: true,
      type: true,
      tempMin: true,
      tempMax: true,
      tuyaDeviceId: true,
      area: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ equipment });
}
