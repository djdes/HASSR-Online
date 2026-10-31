import { NextResponse } from "next/server";
import { z } from "zod";

import { buildingTargets } from "@/lib/building-targets";
import { db } from "@/lib/db";
import { ALL_POINTS, readDepartmentPointMap } from "@/lib/hr1c/points";
import { guardSupply } from "@/lib/supply/guard.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  /** Подразделение → id точки, "*" (все точки) или null (не сопоставлено). */
  map: z.record(z.string().trim().min(1).max(220), z.string().trim().max(60).nullable()),
});

/**
 * PUT /api/settings/hr1c/departments — сопоставить подразделения 1С с
 * точками (2026-10-31). Чужие и удалённые точки отбрасываются. Применяется
 * при следующем «Применить» / автопрогоне: принятым — точки подразделения,
 * у связанных — только точки, которые ставила 1С.
 */
export async function PUT(request: Request) {
  const { organizationId, denied } = await guardSupply();
  if (denied) return denied;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Некорректное сопоставление" }, { status: 400 });
  const connection = await db.hrConnection.findUnique({ where: { organizationId }, select: { id: true } });
  if (!connection) return NextResponse.json({ error: "Сначала подключите 1С" }, { status: 400 });
  const livePointIds = new Set((await buildingTargets(organizationId)).filter((id): id is string => id !== null));
  if (livePointIds.size === 0) return NextResponse.json({ error: "Точки выключены — сопоставлять не с чем" }, { status: 400 });
  const raw = Object.fromEntries(
    Object.entries(parsed.data.map).filter((entry): entry is [string, string] => entry[1] !== null && entry[1] !== ""),
  );
  const map = readDepartmentPointMap(raw, livePointIds);
  await db.hrConnection.update({ where: { organizationId }, data: { departmentPointsJson: map } });
  return NextResponse.json({ ok: true, map, allPoints: ALL_POINTS });
}
