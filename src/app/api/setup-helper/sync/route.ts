import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { userBuildingTargets } from "@/lib/building-targets";
import { db } from "@/lib/db";
import { createRateLimiter } from "@/lib/rate-limit";
import { parseSyncRequest, planPrinterEvent, type HelperEvent } from "@/lib/setup-helper";
import { authenticateHelperDevice, type AuthedHelperDevice } from "@/lib/setup-helper-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Телефон шлёт очередь раз в несколько минут; чаще 30 раз в минуту — сбой
// или чужой скрипт с украденным ключом. События при отказе не теряются:
// приложение повторит позже.
const limiter = createRateLimiter({ tokensPerInterval: 30, intervalMs: 60 * 1000 });

/**
 * POST /api/setup-helper/sync — очередь событий приложения «Сетап помощник».
 *
 * Тело: `{ appVersion, events: [...] }` (Authorization: Bearer <ключ>).
 * Ответ: `{ accepted, rejected }` — id событий, которые телефон может
 * выбросить из очереди. Обработка идемпотентна (`planPrinterEvent`, этикетки
 * `label_printed` — по id события): если ответ потерялся и телефон прислал
 * пакет ещё раз, ничего не изменится.
 *
 * 401 с `code: "device_revoked"` — ключ отозван на сайте (или сотрудник
 * отключён): приложение выходит из аккаунта.
 */
export async function POST(request: Request) {
  const device = await authenticateHelperDevice(request);
  if (!device) {
    return NextResponse.json(
      { error: "Приложение отключено от аккаунта — войдите заново", code: "device_revoked" },
      { status: 401 },
    );
  }

  if (!limiter.consume(device.id)) {
    return NextResponse.json({ error: "Слишком частые запросы. Повторим позже." }, { status: 429 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }
  const parsed = parseSyncRequest(raw, new Date());
  if (!parsed) return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });

  const accepted: string[] = [];
  // По порядку: подключение принтера идёт в очереди раньше его печати.
  for (const event of parsed.events) {
    await applyEvent(device, event);
    if (event.type === "label_printed") await recordLabelPrint(device, event);
    accepted.push(event.id);
  }

  await db.setupHelperDevice.update({
    where: { id: device.id },
    data: { lastSeenAt: new Date(), ...(parsed.appVersion ? { appVersion: parsed.appVersion } : {}) },
  });

  return NextResponse.json({ accepted, rejected: parsed.rejected });
}

async function applyEvent(device: AuthedHelperDevice, event: HelperEvent, retried = false): Promise<void> {
  const where = { organizationId_address: { organizationId: device.organizationId, address: event.address } };
  const existing = await db.labelPrinter.findUnique({
    where,
    select: { id: true, connectedAt: true, lastPrintAt: true, removedAt: true },
  });
  const plan = planPrinterEvent(existing, event, { deviceId: device.id, userId: device.userId });

  if (plan.kind === "create") {
    try {
      await db.labelPrinter.create({ data: { organizationId: device.organizationId, ...plan.data } });
    } catch (error) {
      // Тот же принтер одновременно подключили с двух телефонов: строку
      // уже создал соседний запрос — пересчитываем план по ней.
      if (!retried && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return applyEvent(device, event, true);
      }
      throw error;
    }
  } else if (plan.kind === "update" && existing) {
    await db.labelPrinter.update({ where: { id: existing.id }, data: plan.data });
  }
}

/**
 * Этикетка — в журнал маркировки. Ключ — id события в организации: если
 * ответ потерялся и телефон прислал пакет ещё раз, вторая строка не
 * появится (P2002 — уже записана, телефону отвечаем «принято»).
 */
async function recordLabelPrint(
  device: AuthedHelperDevice,
  event: Extract<HelperEvent, { type: "label_printed" }>,
): Promise<void> {
  // Точка этикетки (2026-11-01): точка сотрудника телефона, если она одна —
  // журнал маркировки на точке показывает её этикетки.
  const points = (await userBuildingTargets(device.organizationId, device.userId)).filter((id): id is string => id !== null);
  try {
    await db.labelPrint.create({
      data: {
        organizationId: device.organizationId,
        buildingId: points.length === 1 ? points[0] : null,
        eventId: event.id,
        deviceId: device.id,
        userId: device.userId,
        printerAddress: event.address,
        template: event.template,
        templateTitle: event.title,
        copies: event.copies,
        item: event.label.item,
        startAt: event.label.startAt,
        startLabel: event.label.startLabel,
        until: event.label.until,
        untilLabel: event.label.untilLabel,
        dateOnly: event.label.dateOnly,
        employee: event.label.by,
        employeeLabel: event.label.byLabel,
        fields: event.label.fields.length > 0 ? event.label.fields : Prisma.DbNull,
        printedAt: event.at,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return;
    throw error;
  }
}
