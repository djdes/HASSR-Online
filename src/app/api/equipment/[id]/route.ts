import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    if (
      !hasFullWorkspaceAccess({
        role: session.user.role,
        isRoot: session.user.isRoot === true,
      })
    ) {
      return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    }

    const equipment = await db.equipment.findUnique({
      where: { id },
      include: { area: { select: { organizationId: true } } },
    });

    if (!equipment || equipment.area.organizationId !== getActiveOrgId(session)) {
      return NextResponse.json({ error: "Оборудование не найдено" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const { name, type, areaId, serialNumber, tempMin, tempMax, tuyaDeviceId } = body;

    // Раньше: name.trim() крашил 500'кой если name был числом/null/object.
    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Название обязательно" }, { status: 400 });
    }

    if (areaId) {
      const area = await db.area.findFirst({
        where: { id: areaId, organizationId: getActiveOrgId(session) },
      });
      if (!area) {
        return NextResponse.json({ error: "Цех не найден" }, { status: 400 });
      }
    }

    // tempMin/tempMax — finite numbers либо null. Раньше Number("abc")
    // = NaN записывалось в БД, потом ломались температурные графики.
    function parseTemp(value: unknown): number | null | "invalid" {
      if (value === undefined || value === null || value === "") return null;
      const n = Number(value);
      if (!Number.isFinite(n)) return "invalid";
      return n;
    }
    const parsedTempMin = parseTemp(tempMin);
    const parsedTempMax = parseTemp(tempMax);
    if (parsedTempMin === "invalid" || parsedTempMax === "invalid") {
      return NextResponse.json(
        { error: "Температура должна быть числом" },
        { status: 400 }
      );
    }
    // Норму «от 6 до 2» сохранить было можно, и тогда журнал помечал
    // отклонением ЛЮБОЙ замер — журнал выглядел сломанным.
    if (
      parsedTempMin !== null &&
      parsedTempMax !== null &&
      parsedTempMin > parsedTempMax
    ) {
      return NextResponse.json(
        { error: "Минимальная температура не может быть больше максимальной" },
        { status: 400 }
      );
    }

    const nextTuyaDeviceId =
      typeof tuyaDeviceId === "string" && tuyaDeviceId.trim()
        ? tuyaDeviceId.trim().slice(0, 100)
        : null;
    const updated = await db.equipment.update({
      where: { id },
      data: {
        name: name.trim().slice(0, 200),
        type: typeof type === "string" && type.trim() ? type.trim().slice(0, 50) : equipment.type,
        areaId: typeof areaId === "string" && areaId ? areaId : equipment.areaId,
        serialNumber:
          typeof serialNumber === "string" && serialNumber.trim()
            ? serialNumber.trim().slice(0, 100)
            : null,
        tempMin: parsedTempMin,
        tempMax: parsedTempMax,
        tuyaDeviceId: nextTuyaDeviceId,
      },
    });

    return NextResponse.json({ equipment: updated });
  } catch (error) {
    console.error("Equipment update error:", error);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    if (
      !hasFullWorkspaceAccess({
        role: session.user.role,
        isRoot: session.user.isRoot === true,
      })
    ) {
      return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    }

    const equipment = await db.equipment.findUnique({
      where: { id },
      include: { area: { select: { organizationId: true } } },
    });

    if (!equipment || equipment.area.organizationId !== getActiveOrgId(session)) {
      return NextResponse.json({ error: "Оборудование не найдено" }, { status: 404 });
    }

    await db.equipment.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Equipment deletion error:", error);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
