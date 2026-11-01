import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { findDuplicateEnterprise } from "@/lib/mercury/enterprise-mapping";
import { mercurySettingsGuard } from "@/lib/mercury/settings-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/integrations/mercury/enterprises — добавить площадку вручную
 * (GUID из реестра «Цербер» в кабинете Меркурия). Выбрана точка — площадка
 * сразу опрашивается, её ВСД ложатся в журнал приёмки этой точки.
 */
const createSchema = z.object({
  enterpriseGuid: z.string().trim().min(8).max(64),
  activityLocationGuid: z.string().trim().max(64).optional().nullable(),
  name: z.string().trim().min(1).max(200),
  address: z.string().trim().max(400).optional().nullable(),
  buildingId: z.string().trim().min(1).optional().nullable(),
});

export async function POST(request: Request) {
  const g = await mercurySettingsGuard();
  if (g.error) return g.error;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Проверьте GUID и название площадки" }, { status: 400 });
  }
  const input = parsed.data;

  const integration = await db.mercuryIntegration.findUnique({
    where: { organizationId: g.organizationId },
    select: { id: true },
  });
  if (!integration) {
    return NextResponse.json({ error: "Сначала сохраните реквизиты подключения к Меркурию" }, { status: 409 });
  }

  const buildingId = input.buildingId ?? null;
  if (buildingId) {
    const building = await db.building.findFirst({
      where: { id: buildingId, organizationId: g.organizationId },
      select: { id: true },
    });
    if (!building) return NextResponse.json({ error: "Точка не найдена" }, { status: 400 });
  }

  const activityLocationGuid = input.activityLocationGuid?.trim() || null;
  if (
    await findDuplicateEnterprise({
      integrationId: integration.id,
      enterpriseGuid: input.enterpriseGuid,
      activityLocationGuid,
    })
  ) {
    return NextResponse.json({ error: "Такая площадка уже добавлена" }, { status: 409 });
  }

  const enterprise = await db.mercuryEnterprise.create({
    data: {
      integrationId: integration.id,
      organizationId: g.organizationId,
      enterpriseGuid: input.enterpriseGuid,
      activityLocationGuid,
      name: input.name,
      address: input.address?.trim() || null,
      buildingId,
      // Точку выбрали — значит, ВСД площадки нужны.
      enabled: Boolean(buildingId),
    },
    select: { id: true, enterpriseGuid: true, activityLocationGuid: true, name: true, address: true, enabled: true, buildingId: true },
  });
  return NextResponse.json({ ok: true, enterprise });
}
