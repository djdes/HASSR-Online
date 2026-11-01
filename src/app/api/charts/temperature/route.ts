import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { objectVisibleToSession } from "@/lib/point-objects.server";

interface TemperaturePoint {
  time: string;
  temperature: number;
  humidity: number | null;
}

interface TemperatureChartResponse {
  points: TemperaturePoint[];
  equipment: {
    name: string;
    tempMin: number | null;
    tempMax: number | null;
  };
}

const PERIOD_MAP: Record<string, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

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
    const period = searchParams.get("period") || "24h";

    if (!equipmentId) {
      return NextResponse.json(
        { error: "Параметр equipmentId обязателен" },
        { status: 400 }
      );
    }

    if (!PERIOD_MAP[period]) {
      return NextResponse.json(
        { error: "Недопустимый период. Допустимые значения: 24h, 7d, 30d" },
        { status: 400 }
      );
    }

    // Verify equipment belongs to the user's organization
    const equipment = await db.equipment.findUnique({
      where: { id: equipmentId },
      include: {
        area: { select: { organizationId: true, buildingId: true } },
      },
    });

    // Чужая точка — как чужая организация (аудит точек, 2026-11-01).
    if (
      !equipment ||
      equipment.area.organizationId !== getActiveOrgId(session) ||
      !(await objectVisibleToSession(session, equipment.area.buildingId))
    ) {
      return NextResponse.json(
        { error: "Оборудование не найдено" },
        { status: 404 }
      );
    }

    // Find the temp_control template
    const template = await db.journalTemplate.findUnique({
      where: { code: "temp_control" },
    });

    if (!template) {
      return NextResponse.json(
        { error: "Шаблон temp_control не найден" },
        { status: 500 }
      );
    }

    // Calculate the time boundary
    const since = new Date(Date.now() - PERIOD_MAP[period]);

    // Fetch journal entries for this equipment and template
    const entries = await db.journalEntry.findMany({
      where: {
        templateId: template.id,
        equipmentId: equipmentId,
        organizationId: getActiveOrgId(session),
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "asc" },
      select: {
        createdAt: true,
        data: true,
      },
    });

    // Transform entries into chart points
    const points: TemperaturePoint[] = entries.map((entry) => {
      const data = entry.data as Record<string, unknown>;
      return {
        time: entry.createdAt.toISOString(),
        temperature: Number(data.temperature) || 0,
        humidity: data.humidity != null ? Number(data.humidity) : null,
      };
    });

    const response: TemperatureChartResponse = {
      points,
      equipment: {
        name: equipment.name,
        tempMin: equipment.tempMin,
        tempMax: equipment.tempMax,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Temperature chart error:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
