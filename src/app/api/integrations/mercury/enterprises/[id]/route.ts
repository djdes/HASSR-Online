import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { autoEnableOnMapping, repointEnterpriseDocuments } from "@/lib/mercury/enterprise-mapping";
import { mercurySettingsGuard } from "@/lib/mercury/settings-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH — точка площадки, «опрашивать», название и адрес. Смена точки
 * переносит туда же ещё не погашенные ВСД площадки (погашенные остаются
 * в журнале своей точки). DELETE — убрать площадку: опрос прекращается,
 * полученные ВСД и история гашения остаются.
 */
const patchSchema = z.object({
  buildingId: z.string().trim().min(1).nullable().optional(),
  enabled: z.boolean().optional(),
  name: z.string().trim().min(1).max(200).optional(),
  address: z.string().trim().max(400).nullable().optional(),
});

async function loadOwn(organizationId: string, id: string) {
  return db.mercuryEnterprise.findFirst({
    where: { id, organizationId },
    select: { id: true, buildingId: true, enabled: true },
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await mercurySettingsGuard();
  if (g.error) return g.error;
  const { id } = await params;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Неверные данные площадки" }, { status: 400 });
  const input = parsed.data;

  const enterprise = await loadOwn(g.organizationId, id);
  if (!enterprise) return NextResponse.json({ error: "Площадка не найдена" }, { status: 404 });

  if (input.buildingId) {
    const building = await db.building.findFirst({
      where: { id: input.buildingId, organizationId: g.organizationId },
      select: { id: true },
    });
    if (!building) return NextResponse.json({ error: "Точка не найдена" }, { status: 400 });
  }

  const enabled = autoEnableOnMapping({
    currentBuildingId: enterprise.buildingId,
    currentEnabled: enterprise.enabled,
    nextBuildingId: input.buildingId,
    requestedEnabled: input.enabled,
  });
  const pointChanged = input.buildingId !== undefined && input.buildingId !== enterprise.buildingId;

  const updated = await db.mercuryEnterprise.update({
    where: { id: enterprise.id },
    data: {
      ...(input.buildingId !== undefined ? { buildingId: input.buildingId } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
      ...(input.name ? { name: input.name } : {}),
      ...(input.address !== undefined ? { address: input.address?.trim() || null } : {}),
    },
    select: { id: true, buildingId: true, enabled: true },
  });
  const repointed = pointChanged ? await repointEnterpriseDocuments(enterprise.id, updated.buildingId) : 0;
  return NextResponse.json({ ok: true, enterprise: updated, repointed });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await mercurySettingsGuard();
  if (g.error) return g.error;
  const { id } = await params;

  const enterprise = await loadOwn(g.organizationId, id);
  if (!enterprise) return NextResponse.json({ error: "Площадка не найдена" }, { status: 404 });
  // ВСД площадки остаются (связь обнуляется — `onDelete: SetNull`).
  await db.mercuryEnterprise.delete({ where: { id: enterprise.id } });
  return NextResponse.json({ ok: true });
}
