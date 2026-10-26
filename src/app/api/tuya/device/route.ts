import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { getDeviceTemperature } from "@/lib/tuya";
import { checkPlanFeature, limitResponse } from "@/lib/billing.server";

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json(
        { error: "Не авторизован" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const equipmentId = searchParams.get("equipmentId");

    if (!equipmentId) {
      return NextResponse.json(
        { error: "equipmentId is required" },
        { status: 400 }
      );
    }

    // Verify equipment belongs to user's org
    const equipment = await db.equipment.findUnique({
      where: { id: equipmentId },
      include: { area: true },
    });

    if (
      !equipment ||
      equipment.area.organizationId !== getActiveOrgId(session)
    ) {
      return NextResponse.json(
        { error: "Оборудование не найдено" },
        { status: 404 }
      );
    }

    if (!equipment.tuyaDeviceId) {
      return NextResponse.json(
        { error: "К этому оборудованию не привязан IoT-датчик" },
        { status: 400 }
      );
    }

    // Опрос IoT-датчиков — возможность «Премиума» (и пробного периода).
    const feature = await checkPlanFeature(equipment.area.organizationId, "equipmentConnect", "tuya/device");
    if (!feature.ok) return limitResponse(feature);

    const { temperature, humidity } = await getDeviceTemperature(
      equipment.tuyaDeviceId
    );

    return NextResponse.json({
      temperature,
      humidity,
      equipmentName: equipment.name,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    // tuya-connector-nodejs error.message может содержать TUYA_ACCESS_ID
    // / sign в URL запроса при network failure'ах. Логируем server-side,
    // отдаём generic.
    console.error("Tuya device fetch error:", error);
    return NextResponse.json(
      { error: "Ошибка IoT-датчика. Подробности в логах сервера." },
      { status: 500 }
    );
  }
}
