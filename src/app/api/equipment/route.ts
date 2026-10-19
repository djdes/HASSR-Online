import { NextResponse } from "next/server";
import { parseEquipmentExtras } from "@/lib/equipment-extras";
import { ZodError } from "zod";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { equipmentSchema } from "@/lib/validators";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { resolveEquipmentArea } from "@/lib/area-building-sync";
import { isFryerEquipmentType } from "@/lib/fryer-oil-equipment-link";
import { syncFryerOilDocumentsSafe } from "@/lib/fryer-oil-equipment-sync";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json(
        { error: "Не авторизован" },
        { status: 401 }
      );
    }

    const equipment = await db.equipment.findMany({
      where: {
        area: { organizationId: getActiveOrgId(session) },
      },
      orderBy: { name: "asc" },
      include: {
        area: { select: { id: true, name: true, buildingId: true } },
      },
    });

    return NextResponse.json({ equipment });
  } catch (error) {
    console.error("Equipment list error:", error);
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
    const validatedData = equipmentSchema.parse(body);

    // Норму «от 6 до 2» сохранить было можно, и тогда журнал помечал
    // отклонением ЛЮБОЙ замер — журнал выглядел сломанным.
    if (
      validatedData.tempMin != null &&
      validatedData.tempMax != null &&
      validatedData.tempMin > validatedData.tempMax
    ) {
      return NextResponse.json(
        { error: "Минимальная температура не может быть больше максимальной" },
        { status: 400 }
      );
    }

    // Помещение — цех организации или помещение точки без цеха (тогда
    // цех создаётся с точкой помещения, 2026-10-17).
    const place = await resolveEquipmentArea(getActiveOrgId(session), {
      areaId: validatedData.areaId,
      roomId: validatedData.roomId,
    });
    if (!place.ok || !place.areaId) {
      return NextResponse.json(
        { error: place.ok ? "Выберите помещение" : place.error },
        { status: 404 }
      );
    }

    const extras = await parseEquipmentExtras(body as Record<string, unknown>, getActiveOrgId(session));
    if (!extras.ok) return NextResponse.json({ error: extras.error }, { status: 400 });

    const equipment = await db.equipment.create({
      data: {
        ...extras.patch,
        name: validatedData.name,
        type: validatedData.type,
        serialNumber: validatedData.serialNumber || null,
        tempMin: validatedData.tempMin ?? null,
        tempMax: validatedData.tempMax ?? null,
        tuyaDeviceId: validatedData.tuyaDeviceId || null,
        areaId: place.areaId,
      },
    });

    // Фритюрница сама появляется в журнале фритюра (2026-10-17).
    if (isFryerEquipmentType(equipment.type)) {
      await syncFryerOilDocumentsSafe(getActiveOrgId(session));
    }

    return NextResponse.json({ equipment }, { status: 201 });
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

    console.error("Equipment creation error:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
