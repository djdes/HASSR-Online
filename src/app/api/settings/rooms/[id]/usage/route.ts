import { NextResponse } from "next/server";
import { requireApiAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";

/**
 * Сколько отметок держит помещение.
 *
 * ПОЧЕМУ: диалог удаления обещал только «записи потеряют ссылку на зону»,
 * но в журнале уборки строка удалённого помещения исчезает из сетки
 * целиком, а проставленные галочки остаются висеть в `config.matrix` и
 * больше нигде не видны. Человек должен увидеть число до удаления.
 */

/** Журналы, строки которых ссылаются на `Room.id`. */
const ROOM_TEMPLATE_CODES = ["cleaning", "climate_control", "general_cleaning"];

function countRoomMarks(config: unknown, roomId: string): number {
  if (!config || typeof config !== "object") return 0;
  const record = config as Record<string, unknown>;
  let marks = 0;

  // Уборка: config.matrix[roomId][dateKey].
  const matrix = record.matrix;
  if (matrix && typeof matrix === "object") {
    const row = (matrix as Record<string, unknown>)[roomId];
    if (row && typeof row === "object") {
      marks += Object.values(row as Record<string, unknown>).filter(
        (value) => value !== null && value !== undefined && value !== ""
      ).length;
    }
  }

  // Климат и санитарный день: строка с roomId в config.rooms / config.rows.
  const lists = [record.rooms, record.rows].filter(Array.isArray) as unknown[][];
  for (const list of lists) {
    for (const item of list) {
      if (
        item !== null &&
        typeof item === "object" &&
        (item as Record<string, unknown>).roomId === roomId
      ) {
        marks += 1;
      }
    }
  }
  return marks;
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth();
    if (!auth.ok) return auth.response;
    const orgId = getActiveOrgId(auth.session);
    const { id } = await ctx.params;

    const room = await db.room.findFirst({
      where: { id, building: { organizationId: orgId } },
      select: { id: true, name: true },
    });
    if (!room) {
      return NextResponse.json({ error: "Не найдено" }, { status: 404 });
    }

    const documents = await db.journalDocument.findMany({
      where: {
        organizationId: orgId,
        template: { code: { in: ROOM_TEMPLATE_CODES } },
      },
      select: { id: true, config: true },
    });

    let documentCount = 0;
    let markCount = 0;
    for (const doc of documents) {
      const marks = countRoomMarks(doc.config, id);
      if (marks > 0) {
        documentCount += 1;
        markCount += marks;
      }
    }

    const bullets: string[] = [];
    if (documentCount > 0) {
      bullets.push(`Журналов по этому помещению: ${documentCount}`);
      bullets.push(
        `Отметок за прошлые дни: ${markCount}. Строка помещения пропадёт из журнала уборки, а отметки останутся только в базе`
      );
    } else {
      bullets.push("Отметок по этому помещению в журналах нет");
    }
    bullets.push("Напечатанные QR-коды этого помещения перестанут работать");

    return NextResponse.json({ documentCount, markCount, bullets });
  } catch (error) {
    console.error("Room usage error:", error);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
