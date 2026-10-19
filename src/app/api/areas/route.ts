import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { areaSchema } from "@/lib/validators";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { guessRoomKind } from "@/lib/orphan-areas";
import { resolveBuildingInput, soleBuildingId } from "@/lib/area-building-sync";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json(
        { error: "Не авторизован" },
        { status: 401 }
      );
    }

    const areas = await db.area.findMany({
      where: { organizationId: getActiveOrgId(session) },
      orderBy: { name: "asc" },
      include: {
        building: { select: { id: true, name: true } },
        _count: { select: { equipment: true } },
      },
    });

    return NextResponse.json({ areas });
  } catch (error) {
    console.error("Areas list error:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json(
        { error: "Не авторизован" },
        { status: 401 }
      );
    }

    if (
      !hasFullWorkspaceAccess({
        role: session.user.role,
        isRoot: session.user.isRoot === true,
      })
    ) {
      return NextResponse.json(
        { error: "Это действие доступно руководителю" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const validatedData = areaSchema.parse(body);
    const orgId = getActiveOrgId(session);

    // Точка цеха (2026-10-17): выбранная в окне; не выбрана — единственная
    // точка организации. Чужая точка — 400.
    const buildingInput = await resolveBuildingInput(orgId, validatedData.buildingId);
    if (!buildingInput.ok) {
      return NextResponse.json({ error: "Точка не найдена" }, { status: 400 });
    }
    const buildingId =
      buildingInput.buildingId === undefined ? await soleBuildingId(orgId) : buildingInput.buildingId;

    const area = await db.area.create({
      data: {
        name: validatedData.name,
        description: validatedData.description || null,
        organizationId: orgId,
        buildingId,
      },
    });

    // Обратное зеркало Area → Room (к зеркалу Room → Area в
    // api/settings/rooms/route.ts): новый цех сразу появляется и как
    // помещение для уборки/климата — в точке цеха. Точки нет — не угадать,
    // куда класть; и только если помещения с таким названием (без учёта
    // регистра) в этой точке ещё нет. Best-effort: цех уже создан, сбой
    // здесь не должен ронять ответ.
    try {
      if (buildingId) {
        const sameRoom = await db.room.findFirst({
          where: {
            buildingId,
            name: { equals: area.name, mode: "insensitive" },
          },
          select: { id: true },
        });
        if (!sameRoom) {
          await db.room.create({
            data: {
              buildingId,
              name: area.name,
              kind: guessRoomKind(area.name),
            },
          });
        }
      }
    } catch (mirrorError) {
      console.error("Area → Room mirror failed:", mirrorError);
    }

    return NextResponse.json({ area }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: error.issues[0]?.message ?? "Некорректные данные",
          details: error.issues,
        },
        { status: 400 }
      );
    }

    console.error("Area creation error:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
