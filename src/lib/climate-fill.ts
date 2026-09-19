/**
 * Запись показания климата «со стороны» — QR-плакат помещения, QR-наклейка
 * оборудования с датчиком влажности. Чистые функции: куда в документе
 * `climate_control` положить значение и как не затереть соседние замеры.
 */

import {
  climateRowIdForRoom,
  type ClimateDocumentConfig,
  type ClimateRoomConfig,
} from "@/lib/climate-document";

const TIME_RE = /^(\d{1,2}):(\d{2})$/;

/** Минуты с полуночи «сейчас» в часовом поясе организации. */
export function orgClockMinutes(now: Date, timeZone = "Europe/Moscow"): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
    const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
    return hour * 60 + minute;
  } catch {
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }
}

/**
 * Ближайший к «сейчас» срок контроля документа («10:00», «17:00»). Сроков
 * нет — текущий час («14:00»). Время считается в зоне организации: на
 * проде процесс живёт в UTC, и утренний замер иначе уходил в чужой слот.
 */
export function pickNearestControlTime(
  controlTimes: readonly string[],
  now: Date,
  timeZone?: string
): string {
  const nowMinutes = orgClockMinutes(now, timeZone);
  let best: string | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const time of controlTimes) {
    const match = TIME_RE.exec(time);
    if (!match) continue;
    const minutes = Number(match[1]) * 60 + Number(match[2]);
    const delta = Math.abs(minutes - nowMinutes);
    if (delta < bestDelta) {
      best = time;
      bestDelta = delta;
    }
  }
  if (best) return best;
  return `${String(Math.floor(nowMinutes / 60)).padStart(2, "0")}:00`;
}

/** Строка документа для помещения справочника (по связи или по стабильному id). */
export function findClimateRowForRoom(
  config: Pick<ClimateDocumentConfig, "rooms">,
  roomId: string
): ClimateRoomConfig | null {
  return (
    config.rooms.find((room) => room.roomId === roomId) ??
    config.rooms.find((room) => room.id === climateRowIdForRoom(roomId)) ??
    null
  );
}

/**
 * Строка документа для оборудования: помещение-цех старых документов
 * (`room-area-<areaId>`), затем совпадение названия цеха. Раньше влажность
 * с QR холодильника писалась под id самого оборудования — такой строки в
 * документе нет, и показание пропадало из бланка.
 */
export function findClimateRowForEquipment(
  config: Pick<ClimateDocumentConfig, "rooms">,
  equipment: { areaId?: string | null; areaName?: string | null }
): ClimateRoomConfig | null {
  if (equipment.areaId) {
    const byArea = config.rooms.find((room) => room.id === `room-area-${equipment.areaId}`);
    if (byArea) return byArea;
  }
  const name = equipment.areaName?.trim().toLowerCase();
  if (name) {
    const byName = config.rooms.find((room) => room.name.trim().toLowerCase() === name);
    if (byName) return byName;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Кладёт показание в `measurements[rowId][slot]`. Другие помещения и сроки,
 * `responsibleTitle` и комментарии к отклонениям остаются как были; метрика,
 * которую не прислали, не обнуляется.
 */
export function mergeClimateMeasurement(
  existingData: unknown,
  rowId: string,
  slot: string,
  values: { temperature?: number | null; humidity?: number | null }
): Record<string, unknown> {
  const base = asRecord(existingData);
  const measurements = asRecord(base.measurements);
  const row = asRecord(measurements[rowId]);
  const current = asRecord(row[slot]);
  const next: Record<string, unknown> = {
    temperature: current.temperature ?? null,
    humidity: current.humidity ?? null,
  };
  if (typeof values.temperature === "number") next.temperature = values.temperature;
  if (typeof values.humidity === "number") next.humidity = values.humidity;
  return {
    ...base,
    measurements: {
      ...measurements,
      [rowId]: { ...row, [slot]: next },
    },
  };
}

/**
 * Комментарий «что сделали» к замеру вне нормы. Кладётся в то же
 * `corrections[roomId:время:метрика]`, откуда его читает
 * `collectClimateDeviations` — значит, он виден в журнале и в печати
 * без правок клиента журнала.
 *
 * Пустой текст ничего не стирает, соседние комментарии не трогаем.
 */
export function mergeClimateCorrections(
  existingData: unknown,
  comments: Record<string, string>
): Record<string, unknown> {
  const base = asRecord(existingData);
  const corrections = { ...asRecord(base.corrections) };
  let changed = false;
  for (const [key, text] of Object.entries(comments)) {
    const trimmed = text.trim();
    if (!trimmed) continue;
    corrections[key] = trimmed;
    changed = true;
  }
  if (!changed) return base;
  return { ...base, corrections };
}
