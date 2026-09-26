import { NextResponse } from "next/server";
import { OBJECT_FILLER_DENIED, canFillObject } from "@/lib/object-fillers";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  processTemperatureReading,
  subjectKeyForEquipment,
} from "@/lib/temperature-deviations";
import { verifyEquipmentQrToken } from "@/lib/equipment-qr-token";
import {
  normalizeColdEquipmentEntryData,
  COLD_EQUIPMENT_STATUS_SHORT,
  pickColdReadingSlotForWrite,
  setColdEquipmentCorrection,
  setColdEquipmentSlotPhoto,
  setColdEquipmentSlotStatus,
  type ColdEquipmentEntryData,
  type ColdEquipmentStatus,
} from "@/lib/cold-equipment-document";
import { readingPhotoExists } from "@/lib/reading-photo-store";
import { isReadingPhotoUrl } from "@/lib/reading-photos";
import {
  climateCorrectionKey,
  isClimateValueOutOfRange,
} from "@/lib/climate-document";
import {
  mergeClimateCorrections,
  mergeClimateMeasurement,
  pickNearestControlTime,
} from "@/lib/climate-fill";
import {
  EQUIPMENT_FILL_NO_DOCUMENT_ERROR,
  resolveEquipmentFillTargets,
} from "@/lib/equipment-fill-targets";
import { clientIp } from "@/lib/client-ip";
import { ORG_ROSTER_WHERE } from "@/lib/journal-roster";
import { normalizeQrFillMode } from "@/lib/qr-fill-actor";
import { readObjectPassCookie, resolveObjectActor } from "@/lib/qr-object-pass";
import {
  QR_FILL_RATE_LIMIT_ERROR,
  qrFillRateKey,
  recordQrFillAudit,
} from "@/lib/qr-fill-audit";
import { qrFillRateLimiter } from "@/lib/rate-limit";
import { orgTodayKey } from "@/lib/timezone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Submit handler for the public `/equipment-fill/[equipmentId]` page.
 * Worker scanned the QR sticker, picked their name, entered a
 * temperature.
 *
 * Flow:
 *   1. Verify HMAC QR token → equipment is reachable.
 *   2. Load equipment + its organization + active cold_equipment_control
 *      documents covering today that reference this equipment via
 *      `sourceEquipmentId`.
 *   3. For each matching doc, upsert today's JournalDocumentEntry for
 *      the picked employee, merging in `temperatures[configItemId]`.
 *   4. Fire a Telegram alert if the reading is out-of-range.
 */
const bodySchema = z.object({
  token: z.string().min(10),
  employeeId: z.string().min(1),
  /** PIN сотрудника — в режиме `qrFillMode = "pin"`. */
  pin: z.string().max(12).optional(),
  /** Пропуск визита после шага PIN (`/api/qr-fill/pass`). */
  pass: z.string().max(300).optional(),
  /** Температура; не нужна, если вместо неё отметка `status`. */
  temperature: z.number().optional(),
  /**
   * «Обслуживание» / «Ремонт» вместо температуры (2026-09-25): в ячейке
   * журнала — «обсл»/«рем», норма не проверяется, комментарий не нужен.
   */
  status: z.enum(["service", "repair"]).optional(),
  /** Опциональная влажность для оборудования с climate-mapping. */
  humidity: z.number().min(0).max(100).optional(),
  /**
   * «Что сделали» при выходе за норму. Для проверки СанПиН голого числа
   * мало: в журнале должно быть видно и причину, и действие.
   */
  correction: z.string().trim().max(300).optional(),
  /**
   * Фото к замеру (кнопка «Фото» у температуры, 2026-09-26): ссылка из
   * `/api/qr-fill/reading-photo`. Ложится в `readingPhotos` записанного
   * замера и видна в документе журнала рядом со значением.
   */
  photo: z.string().max(200).optional(),
});

function toPrismaJsonValue(
  value: unknown
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ equipmentId: string }> }
) {
  const { equipmentId } = await params;

  if (!qrFillRateLimiter.consume(qrFillRateKey(clientIp(request), "equipment", equipmentId))) {
    return NextResponse.json({ error: QR_FILL_RATE_LIMIT_ERROR }, { status: 429 });
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Некорректные данные" },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  }

  const status: ColdEquipmentStatus | null = parsed.status ?? null;
  const temperature = status ? null : parsed.temperature ?? null;
  if (!status && temperature === null) {
    return NextResponse.json({ error: "Введите температуру" }, { status: 400 });
  }

  const verify = verifyEquipmentQrToken(parsed.token);
  if (!verify.ok || verify.equipmentId !== equipmentId) {
    return NextResponse.json(
      { error: "Неверная QR-наклейка" },
      { status: 401 }
    );
  }

  // Фото — только к числу (у «обсл»/«рем» поля температуры нет) и только
  // наша ссылка на снимок, который действительно лежит в каталоге.
  const photo = temperature !== null && parsed.photo ? parsed.photo : null;
  if (photo && !(isReadingPhotoUrl(photo) && (await readingPhotoExists(photo)))) {
    return NextResponse.json(
      { error: "Фото не найдено — снимите ещё раз или сохраните замер без фото" },
      { status: 400 }
    );
  }

  const equipment = await db.equipment.findUnique({
    where: { id: equipmentId },
    include: {
      area: {
        select: {
          id: true,
          organizationId: true,
          name: true,
          organization: { select: { timezone: true, qrFillMode: true } },
        },
      },
    },
  });
  if (!equipment) {
    return NextResponse.json({ error: "Оборудование не найдено" }, { status: 404 });
  }
  const organizationId = equipment.area.organizationId;

  // Режим QR-форм организации: список / PIN / только после входа.
  const actor = await resolveObjectActor({
    mode: normalizeQrFillMode(equipment.area.organization.qrFillMode),
    organizationId,
    employeeId: parsed.employeeId,
    pin: parsed.pin,
    pass: parsed.pass,
    cookiePass: await readObjectPassCookie(organizationId),
  });
  if (!actor.ok) {
    return NextResponse.json({ error: actor.error }, { status: actor.status });
  }

  // Employee must belong to the same organization — protects against a
  // leaked token being paired with a cross-tenant user id.
  const employee = await db.user.findFirst({
    where: {
      id: parsed.employeeId,
      organizationId,
      ...ORG_ROSTER_WHERE,
    },
    select: { id: true, name: true, role: true, canManageSettings: true },
  });
  // «Кто заполняет»: закреплённое оборудование — только своим (и руководству).
  if (employee && !canFillObject(equipment.fillerUserIds, employee)) {
    return NextResponse.json({ error: OBJECT_FILLER_DENIED }, { status: 403 });
  }
  if (!employee) {
    return NextResponse.json(
      { error: "Сотрудник не найден" },
      { status: 404 }
    );
  }

  const now = new Date();
  // «Сегодня» — в зоне организации: на проде процесс живёт в UTC, и ночной
  // замер до 03:00 МСК уходил во вчерашнюю строку.
  const timezone = equipment.area.organization.timezone || "Europe/Moscow";
  const dateKey = orgTodayKey(timezone, now);
  const todayStart = new Date(`${dateKey}T00:00:00.000Z`);

  // Та же функция, что решает на странице: человек видит «журнала нет»
  // до ввода, а не после «Сохранить».
  const targets = await resolveEquipmentFillTargets({
    equipment: {
      id: equipment.id,
      areaId: equipment.area.id,
      areaName: equipment.area.name,
    },
    organizationId,
    day: todayStart,
  });
  if (!targets.hasActiveDocument) {
    return NextResponse.json(
      { code: "no-active-document", error: EQUIPMENT_FILL_NO_DOCUMENT_ERROR },
      { status: 409 }
    );
  }

  // Отклонение → комментарий обязателен: иначе в журнале остаётся голое
  // число, и проверяющий не видит ни причины, ни действия.
  // «обсл»/«рем» — замера нет: норма не проверяется, влажность не пишется.
  const humidity = status ? undefined : parsed.humidity;
  const isOutOfRange =
    temperature !== null &&
    ((equipment.tempMin != null && temperature < equipment.tempMin) ||
      (equipment.tempMax != null && temperature > equipment.tempMax));
  const humidityOutOfRange = targets.climate
    ? isClimateValueOutOfRange(humidity, targets.climate.row.humidity)
    : false;
  // Комментарий пишем только к отклонению: в норме поле на форме скрыто.
  const correction = isOutOfRange || humidityOutOfRange ? parsed.correction?.trim() ?? "" : "";
  if ((isOutOfRange || humidityOutOfRange) && !correction) {
    return NextResponse.json(
      {
        code: "correction-required",
        error:
          "Замер вне нормы. Напишите, что вы сделали — без этого запись в журнал не принимается.",
      },
      { status: 400 }
    );
  }

  let touched = 0;
  const touchedDocumentIds: string[] = [];
  for (const doc of targets.coldDocuments) {
    const matching = doc.items;

    const existing = await db.journalDocumentEntry.findUnique({
      where: {
        documentId_employeeId_date: {
          documentId: doc.id,
          employeeId: employee.id,
          date: todayStart,
        },
      },
      select: { data: true },
    });
    const current: ColdEquipmentEntryData = normalizeColdEquipmentEntryData(
      existing?.data ?? null
    );
    const temperatures = { ...current.temperatures };
    // Замеры дня по всем сотрудникам: второй скан за день ложится во второй
    // замер (режим «2 раза в день»), а не затирает утренний.
    const dayEntries = await db.journalDocumentEntry.findMany({
      where: { documentId: doc.id, date: todayStart },
      select: { data: true },
    });
    const dayTemperatures: Record<string, number | null> = {};
    const dayStatuses: Record<string, ColdEquipmentStatus> = {};
    for (const dayEntry of dayEntries) {
      const dayData = normalizeColdEquipmentEntryData(dayEntry.data ?? null);
      for (const [key, value] of Object.entries(dayData.temperatures)) {
        if (value != null) dayTemperatures[key] = value;
      }
      Object.assign(dayStatuses, dayData.statuses ?? {});
    }
    const writtenSlotKeys: string[] = [];
    let nextData: ColdEquipmentEntryData = {
      responsibleTitle: current.responsibleTitle,
      temperatures,
      ...(current.corrections ? { corrections: current.corrections } : {}),
      ...(current.statuses ? { statuses: current.statuses } : {}),
      ...(current.readingPhotos ? { readingPhotos: current.readingPhotos } : {}),
    };
    for (const item of matching) {
      const slotKey = pickColdReadingSlotForWrite(item, dayTemperatures, dayStatuses);
      // Число снимает прежнюю отметку замера, отметка очищает число.
      nextData = setColdEquipmentSlotStatus(nextData, slotKey, status);
      nextData.temperatures[slotKey] = temperature;
      // Снимок дисплея — к этому же замеру; без нового фото прежнее остаётся.
      nextData = setColdEquipmentSlotPhoto(nextData, slotKey, photo);
      dayTemperatures[slotKey] = temperature;
      if (status) dayStatuses[slotKey] = status;
      writtenSlotKeys.push(slotKey);
    }
    // Комментарий ложится к тому замеру, который только что записали —
    // журнал и печать читают его из `corrections` сами.
    for (const slotKey of writtenSlotKeys) {
      nextData = setColdEquipmentCorrection(nextData, slotKey, correction);
    }

    await db.journalDocumentEntry.upsert({
      where: {
        documentId_employeeId_date: {
          documentId: doc.id,
          employeeId: employee.id,
          date: todayStart,
        },
      },
      create: {
        documentId: doc.id,
        employeeId: employee.id,
        date: todayStart,
        data: toPrismaJsonValue(nextData),
      },
      update: { data: toPrismaJsonValue(nextData) },
    });
    touched += 1;
    touchedDocumentIds.push(doc.id);
  }

  // Если юзер ввёл humidity И у equipment есть climate-mapping — пишем
  // в active climate_control document. Используется в кондитерках,
  // где один датчик отвечает за temperature + humidity комнаты.
  let humidityTouched = 0;
  if (typeof humidity === "number" && targets.climate) {
    // Строка климата — цех оборудования (`room-area-<areaId>` или
    // совпадение названия): у самого оборудования строки в бланке нет.
    const { documentId: climateDocId, config: climateConfig, row: climateRow } =
      targets.climate;
    const slot = pickNearestControlTime(climateConfig.controlTimes, now, timezone);
    const existing = await db.journalDocumentEntry.findUnique({
      where: {
        documentId_employeeId_date: {
          documentId: climateDocId,
          employeeId: employee.id,
          date: todayStart,
        },
      },
      select: { data: true },
    });
    let nextData = mergeClimateMeasurement(existing?.data ?? null, climateRow.id, slot, {
      temperature: temperature ?? undefined,
      humidity,
    });
    // Влажность вне нормы цеха — тот же комментарий, ключ замера climate.
    if (
      correction &&
      isClimateValueOutOfRange(humidity, climateRow.humidity)
    ) {
      nextData = mergeClimateCorrections(nextData, {
        [climateCorrectionKey(climateRow.id, slot, "humidity")]: correction,
      });
    }

    await db.journalDocumentEntry.upsert({
      where: {
        documentId_employeeId_date: {
          documentId: climateDocId,
          employeeId: employee.id,
          date: todayStart,
        },
      },
      create: {
        documentId: climateDocId,
        employeeId: employee.id,
        date: todayStart,
        data: toPrismaJsonValue(nextData),
      },
      update: { data: toPrismaJsonValue(nextData) },
    });
    humidityTouched = 1;
    touchedDocumentIds.push(climateDocId);
  }

  // Страховка: цель была, но записать не удалось (например, влажность не
  // прислали, а холодильных документов нет). Молчаливое «ok» с touched: 0
  // заставляло сотрудника думать, что замер записан.
  if (touched === 0 && humidityTouched === 0) {
    return NextResponse.json(
      { code: "no-active-document", error: EQUIPMENT_FILL_NO_DOCUMENT_ERROR },
      { status: 409 }
    );
  }

  // Отклонение → тот же обработчик, что у датчиков: ответственному за
  // журнал сразу, руководству — если не исправит (temperature-deviations).
  if (temperature !== null) {
    await processTemperatureReading({
      organizationId,
      subjectKey: subjectKeyForEquipment(equipment.id),
      subjectName: equipment.name,
      value: temperature,
      tempMin: equipment.tempMin,
      tempMax: equipment.tempMax,
      equipmentId: equipment.id,
      source: `${employee.name} (QR)`,
    });
  }

  const auditValues: Record<string, unknown> = {
    ...(status ? { status: COLD_EQUIPMENT_STATUS_SHORT[status] } : {}),
    ...(photo && touched > 0 ? { photo } : {}),
  };
  await recordQrFillAudit({
    request,
    organizationId,
    kind: "equipment",
    objectId: equipment.id,
    objectName: equipment.name,
    employee,
    documentIds: touchedDocumentIds,
    dateKey,
    temperature,
    humidity,
    outOfRange: isOutOfRange || humidityOutOfRange,
    ...(Object.keys(auditValues).length > 0 ? { values: auditValues } : {}),
  });
  if (photo && touched > 0) {
    console.info(`[reading-photo] attached equipment=${equipment.id} docs=${touched} org=${organizationId} user=${employee.id}`);
  }

  return NextResponse.json({
    ok: true,
    touched,
    humidityTouched,
    outOfRange: isOutOfRange || humidityOutOfRange,
    ...(status ? { status } : {}),
    ...(photo && touched > 0 ? { photoAttached: true } : {}),
  });
}
