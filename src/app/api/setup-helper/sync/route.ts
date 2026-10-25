import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
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
 * выбросить из очереди. Обработка идемпотентна (`planPrinterEvent`): если
 * ответ потерялся и телефон прислал пакет ещё раз, ничего не изменится.
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
