import { NextResponse } from "next/server";
import { OBJECT_FILLER_DENIED, canFillObject } from "@/lib/object-fillers";
import { z } from "zod";
import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { clientIp } from "@/lib/client-ip";
import { buildingWhere } from "@/lib/building-scope";
import {
  CLIMATE_DOCUMENT_TEMPLATE_CODE,
  climateCorrectionKey,
  climateRoomFromDirectory,
  isClimateValueOutOfRange,
  normalizeClimateDocumentConfig,
} from "@/lib/climate-document";
import {
  findClimateRowForRoom,
  mergeClimateCorrections,
  mergeClimateMeasurement,
  pickNearestControlTime,
} from "@/lib/climate-fill";
import { ORG_ROSTER_WHERE } from "@/lib/journal-roster";
import { normalizeQrFillMode, resolveQrFillActor } from "@/lib/qr-fill-actor";
import { verifyQrFillTokenFor } from "@/lib/qr-fill-token";
import {
  QR_FILL_RATE_LIMIT_ERROR,
  qrFillRateKey,
  recordQrFillAudit,
} from "@/lib/qr-fill-audit";
import { qrFillRateLimiter } from "@/lib/rate-limit";
import {
  processTemperatureReading,
  subjectKeyForDocumentItem,
} from "@/lib/temperature-deviations";
import { orgTodayKey } from "@/lib/timezone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/room-fill/[roomId] — показание климата с QR-плаката склада.
 *
 * Сессии нет: доступ даёт подписанный токен плаката. Путь записи:
 *   токен → помещение → организация → активный на сегодня документ
 *   `climate_control` точки помещения → строка помещения (нет — добавим из
 *   справочника) → ближайший срок контроля → `measurements[строка][срок]`
 *   в записи сотрудника за сегодня. Соседние помещения и сроки не трогаем.
 */
const bodySchema = z
  .object({
    token: z.string().min(10),
    employeeId: z.string().min(1),
    /** PIN сотрудника — в режиме `qrFillMode = "pin"`. */
    pin: z.string().max(12).optional(),
    temperature: z.number().min(-60).max(80).optional(),
    humidity: z.number().min(0).max(100).optional(),
    /**
     * «Что сделали» при выходе за норму. Для проверки СанПиН голого числа
     * мало: в журнале должно быть видно и причину, и действие.
     */
    correction: z.string().trim().max(300).optional(),
  })
  .refine((body) => typeof body.temperature === "number" || typeof body.humidity === "number", {
    message: "Введите температуру или влажность",
  });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;

  if (!qrFillRateLimiter.consume(qrFillRateKey(clientIp(request), "room", roomId))) {
    return NextResponse.json({ error: QR_FILL_RATE_LIMIT_ERROR }, { status: 429 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (error) {
    const message =
      error instanceof z.ZodError ? error.issues[0]?.message ?? "Некорректные данные" : "Некорректные данные";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const verify = verifyQrFillTokenFor(body.token, "room", roomId);
  if (!verify.ok) {
    return NextResponse.json(
      {
        error: "QR-код недействителен для этого помещения.",
        code: verify.reason,
      },
      { status: 401 }
    );
  }

  const room = await db.room.findUnique({
    where: { id: roomId },
    select: {
      id: true,
      name: true,
      climateNorms: true,
      buildingId: true,
      fillerUserIds: true,
      building: {
        select: {
          organizationId: true,
          organization: { select: { timezone: true, qrFillMode: true } },
        },
      },
    },
  });
  if (!room) {
    return NextResponse.json({ error: "Помещение не найдено" }, { status: 404 });
  }
  const organizationId = room.building.organizationId;
  const timezone = room.building.organization.timezone || "Europe/Moscow";

  const actor = await resolveQrFillActor({
    mode: normalizeQrFillMode(room.building.organization.qrFillMode),
    organizationId,
    employeeId: body.employeeId,
    pin: body.pin,
  });
  if (!actor.ok) {
    return NextResponse.json({ error: actor.error }, { status: actor.status });
  }

  const employee = await db.user.findFirst({
    where: { id: body.employeeId, organizationId, ...ORG_ROSTER_WHERE },
    select: { id: true, name: true, role: true, canManageSettings: true },
  });
  // «Кто заполняет»: закреплённое помещение — только своим (и руководству).
  if (employee && !canFillObject(room.fillerUserIds, employee)) {
    return NextResponse.json({ error: OBJECT_FILLER_DENIED }, { status: 403 });
  }
  if (!employee) {
    return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 });
  }

  const now = new Date();
  const dateKey = orgTodayKey(timezone, now);
  const day = new Date(`${dateKey}T00:00:00.000Z`);

  const documents = await db.journalDocument.findMany({
    where: {
      organizationId,
      status: "active",
      template: { code: CLIMATE_DOCUMENT_TEMPLATE_CODE },
      dateFrom: { lte: day },
      dateTo: { gte: day },
      ...buildingWhere(room.buildingId),
    },
    select: { id: true, config: true, buildingId: true },
    orderBy: [{ dateFrom: "desc" }, { createdAt: "desc" }],
  });
  // Сначала документ, где помещение уже есть; затем документ своей точки.
  const document =
    documents.find((doc) => findClimateRowForRoom(normalizeClimateDocumentConfig(doc.config), roomId)) ??
    documents.find((doc) => doc.buildingId === room.buildingId) ??
    documents[0];
  if (!document) {
    return NextResponse.json(
      {
        code: "no-active-document",
        error: "На сегодня нет активного журнала температуры. Попросите управляющего создать документ.",
      },
      { status: 409 }
    );
  }

  const rawConfig =
    document.config && typeof document.config === "object" && !Array.isArray(document.config)
      ? (document.config as Record<string, unknown>)
      : {};
  const config = normalizeClimateDocumentConfig(document.config);
  let row = findClimateRowForRoom(config, roomId);
  if (!row) {
    // Помещения нет в документе — добавляем строку из справочника, иначе
    // замер лёг бы в данные, но в бланке его бы не было видно.
    row = climateRoomFromDirectory(room);
    await db.journalDocument.update({
      where: { id: document.id },
      data: { config: { ...rawConfig, rooms: [...config.rooms, row] } as Prisma.InputJsonValue },
    });
  }

  const slot = pickNearestControlTime(config.controlTimes, now, timezone);

  const temperatureOutOfRange = isClimateValueOutOfRange(body.temperature, row.temperature);
  const humidityOutOfRange = isClimateValueOutOfRange(body.humidity, row.humidity);
  // Отклонение → комментарий обязателен: иначе в журнале остаётся голое
  // число, и проверяющий не видит ни причины, ни действия.
  const correction = body.correction?.trim() ?? "";
  if ((temperatureOutOfRange || humidityOutOfRange) && !correction) {
    return NextResponse.json(
      {
        code: "correction-required",
        error:
          "Замер вне нормы. Напишите, что вы сделали — без этого запись в журнал не принимается.",
      },
      { status: 400 }
    );
  }

  const existing = await db.journalDocumentEntry.findUnique({
    where: { documentId_employeeId_date: { documentId: document.id, employeeId: employee.id, date: day } },
    select: { data: true },
  });
  let data = mergeClimateMeasurement(existing?.data ?? null, row.id, slot, {
    temperature: body.temperature,
    humidity: body.humidity,
  });
  if (correction) {
    // Комментарий держится за свой замер: ключ `помещение:срок:метрика` —
    // тот же, из которого его читают бланк и печать.
    data = mergeClimateCorrections(data, {
      ...(temperatureOutOfRange
        ? { [climateCorrectionKey(row.id, slot, "temperature")]: correction }
        : {}),
      ...(humidityOutOfRange
        ? { [climateCorrectionKey(row.id, slot, "humidity")]: correction }
        : {}),
    });
  }
  await db.journalDocumentEntry.upsert({
    where: { documentId_employeeId_date: { documentId: document.id, employeeId: employee.id, date: day } },
    create: { documentId: document.id, employeeId: employee.id, date: day, data: data as Prisma.InputJsonValue },
    update: { data: data as Prisma.InputJsonValue },
  });

  if (typeof body.temperature === "number" && row.temperature.enabled) {
    await processTemperatureReading({
      organizationId,
      subjectKey: subjectKeyForDocumentItem(document.id, row.id),
      subjectName: row.name,
      value: body.temperature,
      tempMin: row.temperature.min,
      tempMax: row.temperature.max,
      documentId: document.id,
      source: `${employee.name} (QR)`,
      areaName: room.name,
      now,
    });
  }

  await recordQrFillAudit({
    request,
    organizationId,
    kind: "room",
    objectId: room.id,
    objectName: room.name,
    employee,
    documentIds: [document.id],
    dateKey,
    slot,
    temperature: body.temperature,
    humidity: body.humidity,
    outOfRange: temperatureOutOfRange || humidityOutOfRange,
  });

  return NextResponse.json({
    ok: true,
    documentId: document.id,
    dateKey,
    slot,
    temperatureOutOfRange,
    humidityOutOfRange,
  });
}
