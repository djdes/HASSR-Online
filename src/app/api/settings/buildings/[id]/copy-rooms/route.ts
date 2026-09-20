import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  fromBuildingId: z.string().min(1),
});

/**
 * POST /api/settings/buildings/[id]/copy-rooms { fromBuildingId }
 *
 * Точки (2026-09-05): новая точка рождается без помещений, а журналы
 * уборки и климата строятся по ним. Копируем справочник помещений из
 * соседней точки целиком: состав уборки, средства, расписание, нормы
 * климата и назначенных людей (сотрудники общие на организацию).
 * Помещения с совпадающим названием не дублируем.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const orgId = getActiveOrgId(auth.session);
  const { id: targetId } = await ctx.params;

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? "Bad input" }, { status: 400 });
    }
    throw err;
  }
  if (body.fromBuildingId === targetId) {
    return NextResponse.json({ error: "Выберите другую точку" }, { status: 400 });
  }

  const [target, source] = await Promise.all([
    db.building.findFirst({
      where: { id: targetId, organizationId: orgId },
      select: { id: true, rooms: { select: { name: true } } },
    }),
    db.building.findFirst({
      where: { id: body.fromBuildingId, organizationId: orgId },
      select: {
        id: true,
        rooms: {
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          select: {
            name: true,
            kind: true,
            sortOrder: true,
            detergent: true,
            currentScope: true,
            generalScope: true,
            currentDays: true,
            generalDays: true,
            currentScheduleType: true,
            generalScheduleType: true,
            currentMonthDays: true,
            generalMonthDays: true,
            requirePhoto: true,
            cleanerUserIds: true,
            verifierUserIds: true,
            climateNorms: true,
          },
        },
      },
    }),
  ]);
  if (!target || !source) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 404 });
  }

  const taken = new Set(target.rooms.map((room) => room.name.trim().toLowerCase()));
  let copied = 0;
  let skipped = 0;
  for (const room of source.rooms) {
    if (taken.has(room.name.trim().toLowerCase())) {
      skipped += 1;
      continue;
    }
    await db.room.create({
      data: {
        buildingId: target.id,
        name: room.name,
        kind: room.kind,
        sortOrder: room.sortOrder,
        detergent: room.detergent,
        currentScope: room.currentScope as Prisma.InputJsonValue,
        generalScope: room.generalScope as Prisma.InputJsonValue,
        currentDays: room.currentDays,
        generalDays: room.generalDays,
        currentScheduleType: room.currentScheduleType,
        generalScheduleType: room.generalScheduleType,
        currentMonthDays: room.currentMonthDays as Prisma.InputJsonValue,
        generalMonthDays: room.generalMonthDays as Prisma.InputJsonValue,
        requirePhoto: room.requirePhoto,
        cleanerUserIds: room.cleanerUserIds,
        verifierUserIds: room.verifierUserIds,
        ...(room.climateNorms !== null
          ? { climateNorms: room.climateNorms as Prisma.InputJsonValue }
          : {}),
      },
    });
    taken.add(room.name.trim().toLowerCase());
    copied += 1;
  }

  return NextResponse.json({ ok: true, copied, skipped });
}
