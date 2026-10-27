import { db } from "@/lib/db";
import { notifyOrganization, escapeTelegramHtml as esc } from "@/lib/telegram";
import { placeOfEvent } from "@/lib/place-recipients";

/**
 * Real-time IoT-trigger → CAPA (Feature 3.6.3):
 *   Если датчик выдал 2 подряд out-of-range замера, разделённых ≤90
 *   минут — это «отклонение от нормы 30+ минут подряд» (cron бьёт
 *   ежечасно, поэтому 2 чтения = ~60 мин violation). Создаём CAPA
 *   и пингуем management.
 *
 * Не путать с `detectTemperatureCapas` (capa-auto-detect.ts) — тот
 * срабатывает на 3 дня подряд out-of-range (медленный pattern). Этот —
 * на быстрые острые эпизоды.
 *
 * Идемпотентно: перед созданием тикета ищем уже открытый с
 * `sourceType="iot_realtime"`, `sourceEntryId=equipmentId` за
 * последние 6 часов. Если есть — skip (один эпизод = один тикет).
 */

const SOURCE_TYPE = "iot_realtime";
const RECENT_TICKET_WINDOW_HOURS = 6;
const MAX_GAP_MIN = 90; // считаем «подряд» если предыдущий замер не старше 90 мин

export async function maybeCreateRealtimeCapa(args: {
  organizationId: string;
  equipmentId: string;
  equipmentName: string;
  currentValue: number;
  previousValue: number | null;
  previousAt: Date | null;
  tempMin: number | null;
  tempMax: number | null;
  now?: Date;
}): Promise<{ created: boolean; ticketId?: string; reason?: string }> {
  const now = args.now ?? new Date();

  if (args.tempMin === null || args.tempMax === null) {
    return { created: false, reason: "no-thresholds" };
  }
  const inViolation =
    args.currentValue < args.tempMin || args.currentValue > args.tempMax;
  if (!inViolation) {
    return { created: false, reason: "in-range" };
  }
  if (args.previousValue === null || args.previousAt === null) {
    return { created: false, reason: "no-previous" };
  }
  const prevInViolation =
    args.previousValue < args.tempMin || args.previousValue > args.tempMax;
  if (!prevInViolation) {
    return { created: false, reason: "previous-in-range" };
  }
  const gapMin =
    (now.getTime() - args.previousAt.getTime()) / (60 * 1000);
  if (gapMin > MAX_GAP_MIN) {
    return { created: false, reason: "previous-too-old" };
  }

  // Дедупликация: нет ли уже открытого тикета по этому equipment.
  const recentCutoff = new Date(
    now.getTime() - RECENT_TICKET_WINDOW_HOURS * 60 * 60 * 1000
  );
  const existing = await db.capaTicket.findFirst({
    where: {
      organizationId: args.organizationId,
      sourceType: SOURCE_TYPE,
      sourceEntryId: args.equipmentId,
      createdAt: { gte: recentCutoff },
      status: { not: "closed" },
    },
    select: { id: true },
  });
  if (existing) {
    return { created: false, reason: "already-open", ticketId: existing.id };
  }

  const direction =
    args.currentValue > args.tempMax ? "выше нормы" : "ниже нормы";
  const ticket = await db.capaTicket.create({
    data: {
      organizationId: args.organizationId,
      title: `Превышение t° ${args.equipmentName} (${args.currentValue.toFixed(
        1
      )}°C)`,
      description:
        `Датчик ${args.equipmentName} показал ${args.currentValue.toFixed(
          1
        )}°C — ${direction} (${args.tempMin}…${args.tempMax}°C). ` +
        `Предыдущий замер ${args.previousValue.toFixed(1)}°C тоже был вне нормы. ` +
        `Длительность нарушения ≥ ${Math.round(gapMin)} мин.\n\n` +
        `Это автоматически созданный CAPA из IoT-триггера.`,
      priority: "high",
      category: "temperature",
      sourceType: SOURCE_TYPE,
      sourceEntryId: args.equipmentId,
      slaHours: 4,
    },
    select: { id: true },
  });

  // Пинг management.
  const message =
    `🔴 <b>Превышение температуры — открыт CAPA</b>\n\n` +
    `${esc(args.equipmentName)}: ${args.currentValue.toFixed(1)}°C ` +
    `(${args.tempMin}…${args.tempMax}°C, ${direction})\n` +
    `Длительность ${Math.round(gapMin)} мин.\n` +
    `Тикет: /capa/${ticket.id}`;
  // Тревога точки оборудования — её руководителям и офису (фаза 3 «Офис и точки»).
  await notifyOrganization(args.organizationId, message, ["owner"], undefined, undefined, {
    buildingId: await placeOfEvent(args.organizationId, { equipmentId: args.equipmentId }),
  });

  return { created: true, ticketId: ticket.id };
}
