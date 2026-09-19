import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";

/**
 * Что держит цех. Диалог удаления обязан назвать число, а не спрашивать
 * «точно?» вслепую: записи журналов вообще запрещают удаление (Restrict),
 * оборудование удаляется каскадом вместе с цехом.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const area = await db.area.findFirst({
      where: { id, organizationId: getActiveOrgId(session) },
      select: { _count: { select: { equipment: true, journalEntries: true } } },
    });
    if (!area) {
      return NextResponse.json({ error: "Цех не найден" }, { status: 404 });
    }

    const equipmentCount = area._count.equipment;
    const entryCount = area._count.journalEntries;
    const bullets: string[] = [];
    if (entryCount > 0) {
      bullets.push(
        `Записей журналов в этом цехе: ${entryCount}. Пока они есть, удалить цех нельзя`
      );
    }
    if (equipmentCount > 0) {
      bullets.push(
        `Единиц оборудования в цехе: ${equipmentCount}. Все они удалятся вместе с цехом`
      );
    }
    if (bullets.length === 0) {
      bullets.push("Цех пустой — удаление ни на что не повлияет");
    }

    return NextResponse.json({ equipmentCount, entryCount, bullets });
  } catch (error) {
    console.error("Area usage error:", error);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
