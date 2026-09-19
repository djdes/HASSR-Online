import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";

/**
 * Что потеряется, если удалить единицу оборудования.
 *
 * ПОЧЕМУ отдельный запрос: диалог удаления обязан показать число того,
 * что пропадёт (правило проекта), а считать это на каждый рендер списка
 * оборудования — лишние запросы в БД на страницу, где обычно ничего не
 * удаляют. Считаем только когда человек нажал «Удалить».
 */

/** Журналы, строки которых связаны с единицей через `sourceEquipmentId`. */
const LINKED_TEMPLATE_CODES = [
  "cold_equipment_control",
  "equipment_maintenance",
  "equipment_calibration",
  "breakdown_history",
];

function configReferencesEquipment(config: unknown, equipmentId: string): boolean {
  if (!config || typeof config !== "object") return false;
  const record = config as Record<string, unknown>;
  // Холодильный журнал держит строки в `equipment`, остальные — в `rows`.
  const lists = [record.equipment, record.rows].filter(Array.isArray) as unknown[][];
  return lists.some((list) =>
    list.some(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        (item as Record<string, unknown>).sourceEquipmentId === equipmentId
    )
  );
}

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
    const orgId = getActiveOrgId(session);

    const equipment = await db.equipment.findFirst({
      where: { id, area: { organizationId: orgId } },
      select: { id: true },
    });
    if (!equipment) {
      return NextResponse.json({ error: "Оборудование не найдено" }, { status: 404 });
    }

    const [entryCount, documents, sensorCount] = await Promise.all([
      db.journalEntry.count({ where: { equipmentId: id, organizationId: orgId } }),
      db.journalDocument.findMany({
        where: {
          organizationId: orgId,
          template: { code: { in: LINKED_TEMPLATE_CODES } },
        },
        select: { id: true, title: true, config: true },
      }),
      db.equipmentSensorMapping.count({ where: { equipmentId: id } }),
    ]);

    const linkedDocuments = documents.filter((doc) =>
      configReferencesEquipment(doc.config, id)
    );

    // Текст строим на сервере: клиентской кнопке удаления нельзя передать
    // функцию-форматтер из server component'а.
    const bullets: string[] = [];
    if (linkedDocuments.length > 0) {
      bullets.push(
        `Журналов со строкой этой единицы: ${linkedDocuments.length}. Строки и заполненные замеры останутся, название в них сохранится прежним`
      );
    }
    if (entryCount > 0) {
      bullets.push(
        `Записей в журналах: ${entryCount}. Они останутся, но потеряют привязку к оборудованию`
      );
    }
    if (sensorCount > 0) {
      bullets.push(
        `Настроек IoT-датчика: ${sensorCount}. Они удалятся — автозаполнение температуры прекратится`
      );
    }
    if (bullets.length === 0) {
      bullets.push("Эта единица нигде не используется — удаление ни на что не повлияет");
    }

    return NextResponse.json({
      entryCount,
      documentCount: linkedDocuments.length,
      documentTitles: linkedDocuments.slice(0, 3).map((doc) => doc.title),
      sensorCount,
      bullets,
    });
  } catch (error) {
    console.error("Equipment usage error:", error);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
