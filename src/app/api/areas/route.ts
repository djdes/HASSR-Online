import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { areaSchema } from "@/lib/validators";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { guessRoomKind } from "@/lib/orphan-areas";

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

    const area = await db.area.create({
      data: {
        name: validatedData.name,
        description: validatedData.description || null,
        organizationId: getActiveOrgId(session),
      },
    });

    // Обратное зеркало Area → Room (к зеркалу Room → Area в
    // api/settings/rooms/route.ts): новый цех сразу появляется и как
    // помещение для уборки/климата. Только когда здание одно — иначе
    // не угадать, куда класть; и только если помещения с таким названием
    // (без учёта регистра) в организации ещё нет. Best-effort: цех уже
    // создан, сбой здесь не должен ронять ответ.
    try {
      const orgId = getActiveOrgId(session);
      const buildings = await db.building.findMany({
        where: { organizationId: orgId },
        select: { id: true },
        take: 2,
      });
      if (buildings.length === 1) {
        const sameRoom = await db.room.findFirst({
          where: {
            building: { organizationId: orgId },
            name: { equals: area.name, mode: "insensitive" },
          },
          select: { id: true },
        });
        if (!sameRoom) {
          await db.room.create({
            data: {
              buildingId: buildings[0].id,
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
