import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  processTemperatureReading,
  subjectKeyForEquipment,
} from "@/lib/temperature-deviations";
import { authenticateExternalRequest } from "@/lib/external/auth";
import { maybeCreateRealtimeCapa } from "@/lib/iot-violation-capa";
import { buildingWhere } from "@/lib/building-scope";
import { pickPointSigner, pickSensorDocuments, sensorRowKeys } from "@/lib/sensor-point";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/external/sensors
 *
 * Минимальный endpoint для DIY-датчиков (ESP32/Arduino/Raspberry).
 * Один POST = один замер. Никакого journalCode/document — мы
 * автоматически находим активный `cold_equipment_control` документ
 * точки оборудования (где оно есть в строках; документ чужой точки —
 * никогда, src/lib/sensor-point.ts) и обновляем нужный slot. Влажность
 * в журнал холодильников не пишется.
 *
 * Headers:
 *   Authorization: Bearer <Organization.externalApiToken>
 *
 * Body (JSON):
 *   {
 *     "equipmentId": "cuid_abc...",   // обязательно, найдём по id
 *     "type": "temperature" | "humidity",
 *     "value": 4.2,                    // float, °C или %
 *     "timestamp": "2026-04-27T12:34:56Z" // optional, default now
 *   }
 *
 * Response:
 *   200 { ok: true, capaCreated: boolean, ticketId?: string }
 *   401 / 404 / 422 при ошибках.
 *
 * Примеры прошивок — см. `docs/esp32-sensor-example.md`.
 */

const BodySchema = z.object({
  equipmentId: z.string().min(1),
  type: z.enum(["temperature", "humidity"]),
  value: z.number().finite(),
  timestamp: z.string().datetime().optional(),
});

const COLD_EQUIPMENT_CODE = "cold_equipment_control";

export async function POST(request: Request) {
  const auth = await authenticateExternalRequest(request);
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { ok: false, error: err.issues[0]?.message ?? "Invalid body" },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  // Найти equipment + проверить что он принадлежит org из токена.
  const equipment = await db.equipment.findUnique({
    where: { id: body.equipmentId },
    select: {
      id: true,
      name: true,
      tempMin: true,
      tempMax: true,
      area: { select: { organizationId: true, buildingId: true } },
      sensorMappings: {
        select: {
          id: true,
          templateId: true,
          readingType: true,
          lastReadingAt: true,
          lastValue: true,
          template: { select: { code: true } },
        },
      },
    },
  });
  if (!equipment) {
    return NextResponse.json(
      { ok: false, error: "Equipment not found" },
      { status: 404 }
    );
  }
  const orgId = equipment.area.organizationId;
  if (auth.source === "organization" && auth.organizationId !== orgId) {
    return NextResponse.json(
      { ok: false, error: "Equipment belongs to a different organization" },
      { status: 403 }
    );
  }

  const now = body.timestamp ? new Date(body.timestamp) : new Date();
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);

  // Берём mapping подходящего readingType. Если несколько — первый
  // (один датчик обычно заполняет одну колонку).
  const matchingMappings = equipment.sensorMappings.filter(
    (m) => m.readingType === body.type
  );

  // Активный cold_equipment_control документ точки оборудования (или
  // общий); документ чужой точки не подходит. Влажность — не температура
  // холодильника: её в этот журнал не пишем.
  const pointId = equipment.area.buildingId ?? null;
  const candidates =
    body.type === "temperature"
      ? await db.journalDocument.findMany({
          where: {
            organizationId: orgId,
            template: { code: COLD_EQUIPMENT_CODE },
            status: "active",
            dateFrom: { lte: todayStart },
            dateTo: { gte: todayStart },
            ...buildingWhere(pointId),
          },
          orderBy: { dateFrom: "desc" },
          select: { id: true, buildingId: true, config: true },
        })
      : [];
  const targets = pickSensorDocuments(candidates, {
    pointId,
    rowKeys: (candidate) => sensorRowKeys(candidate.config, equipment.id, "equipment"),
  });

  let entriesWritten = 0;
  const documentIds: string[] = [];
  if (targets.length > 0) {
    // Подписант (employeeId записи, FK) — человек точки документа.
    const orgUsers = await db.user.findMany({
      where: { organizationId: orgId, isActive: true },
      select: { id: true, role: true, name: true, email: true, buildingIds: true },
    });
    for (const { doc, keys } of targets) {
      const manager = pickPointSigner(orgUsers, doc.buildingId);
      if (!manager) continue;
      const existing = await db.journalDocumentEntry.findUnique({
        where: {
          documentId_employeeId_date: {
            documentId: doc.id,
            employeeId: manager.id,
            date: todayStart,
          },
        },
        select: { data: true },
      });
      // Снимаем _autoSeeded — при записи реальных sensor-данных
      // строка перестаёт быть placeholder'ом. Согласовано с
      // tuya-pull (ed88aa2a).
      const baseDataRaw = (existing?.data as Record<string, unknown>) ?? {};
      const { _autoSeeded: _seeded, ...baseData } = baseDataRaw;
      void _seeded;
      const prevTemps =
        (baseData.temperatures as Record<string, unknown> | undefined) ?? {};
      const statuses =
        (baseData.statuses as Record<string, unknown> | undefined) ?? {};
      const temperatures: Record<string, unknown> = { ...prevTemps };
      // Строки этого холодильника в документе; без строки — по id, как раньше.
      // «обсл»/«рем» за день — датчик не пишет поверх отметки.
      for (const key of keys.length > 0 ? keys : [equipment.id]) {
        if (!statuses[key]) temperatures[key] = body.value;
      }
      const nextData = { ...baseData, temperatures } as Prisma.InputJsonValue;
      await db.journalDocumentEntry.upsert({
        where: {
          documentId_employeeId_date: {
            documentId: doc.id,
            employeeId: manager.id,
            date: todayStart,
          },
        },
        create: {
          documentId: doc.id,
          employeeId: manager.id,
          date: todayStart,
          data: nextData,
        },
        update: { data: nextData },
      });
      entriesWritten += 1;
      documentIds.push(doc.id);
    }
  }

  // Update mapping snapshots (lastReading...). Делаем для всех
  // подходящих маппингов (обычно 1).
  let capaResult: Awaited<ReturnType<typeof maybeCreateRealtimeCapa>> | null =
    null;
  if (body.type === "temperature") {
    // Отклонение → инцидент: ответственному за журнал, затем (если не
    // исправит) руководству. Общий путь со всеми остальными входами.
    await processTemperatureReading({
      organizationId: orgId,
      subjectKey: subjectKeyForEquipment(equipment.id),
      subjectName: equipment.name,
      value: body.value,
      tempMin: equipment.tempMin,
      tempMax: equipment.tempMax,
      equipmentId: equipment.id,
      source: "Датчик (внешний API)",
      now,
    });
  }

  for (const m of matchingMappings) {
    if (body.type === "temperature") {
      const prevValue =
        m.lastValue !== null && m.lastValue !== undefined
          ? Number(m.lastValue)
          : null;
      capaResult = await maybeCreateRealtimeCapa({
        organizationId: orgId,
        equipmentId: equipment.id,
        equipmentName: equipment.name,
        currentValue: body.value,
        previousValue: Number.isFinite(prevValue) ? prevValue : null,
        previousAt: m.lastReadingAt,
        tempMin: equipment.tempMin,
        tempMax: equipment.tempMax,
        now,
      });
    }
    await db.equipmentSensorMapping.update({
      where: { id: m.id },
      data: { lastReadingAt: now, lastValue: String(body.value) },
    });
  }

  return NextResponse.json({
    ok: true,
    equipmentId: equipment.id,
    entriesWritten,
    documentId: documentIds[0] ?? null,
    documentIds,
    capaCreated: capaResult?.created === true,
    capaTicketId: capaResult?.ticketId ?? null,
  });
}
