/**
 * «Контролировать климат в этом помещении» (владелец, 2026-11-23: «включили —
 * а помещение не контролируется»). Тумблер в окне помещения писал только
 * `Room.climateNorms`, а действующий документ журнала климата держит свой
 * список строк (`config.rooms`), засеянный при создании документа, — и
 * помещение в журнал не попадало.
 *
 * Здесь — чистое решение, что сделать со строками одного документа, когда
 * климат помещения включили или выключили. Запись в БД —
 * `climate-room-membership.server.ts`.
 *
 * Правила:
 *  - включили: строка помещения появляется (или обновляет название и нормы);
 *    старая строка без связи с тем же названием связывается с помещением, а
 *    не дублируется;
 *  - выключили: строка уходит, только если по ней нет ни одного замера —
 *    данные ХАССП не удаляем — и если она не последняя (у документа климата
 *    всегда есть хотя бы одна строка).
 */

import {
  climateRoomFromDirectory,
  climateRowIdForRoom,
  normalizeClimateRoomNorms,
  type ClimateDirectoryRoom,
  type ClimateRoomConfig,
} from "@/lib/climate-document";

export type ClimateMembershipPlan =
  | { action: "none" }
  | { action: "write"; rooms: ClimateRoomConfig[] };

/** Строка документа, принадлежащая помещению справочника. */
export function findClimateRowIndex(rooms: readonly ClimateRoomConfig[], roomId: string): number {
  const linked = rooms.findIndex((row) => row.roomId === roomId);
  if (linked >= 0) return linked;
  return rooms.findIndex((row) => row.id === climateRowIdForRoom(roomId));
}

/** Есть ли у строки хоть одно значение в записях документа. */
export function climateRowHasReadings(entries: ReadonlyArray<{ data: unknown }>, rowId: string): boolean {
  for (const entry of entries) {
    const data = entry.data && typeof entry.data === "object" ? (entry.data as Record<string, unknown>) : null;
    const measurements = data?.measurements;
    if (!measurements || typeof measurements !== "object") continue;
    const byTime = (measurements as Record<string, unknown>)[rowId];
    if (!byTime || typeof byTime !== "object") continue;
    for (const value of Object.values(byTime as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const reading = value as { temperature?: unknown; humidity?: unknown };
      if (typeof reading.temperature === "number" || typeof reading.humidity === "number") return true;
    }
  }
  return false;
}

function sameMetric(a: ClimateRoomConfig["temperature"], b: ClimateRoomConfig["temperature"]): boolean {
  return a.enabled === b.enabled && a.min === b.min && a.max === b.max;
}

function sameRow(a: ClimateRoomConfig, b: ClimateRoomConfig): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.roomId === b.roomId &&
    sameMetric(a.temperature, b.temperature) &&
    sameMetric(a.humidity, b.humidity)
  );
}

export function planClimateRoomMembership(args: {
  rooms: readonly ClimateRoomConfig[];
  room: ClimateDirectoryRoom;
  /** Климат помещения включён (нормы заданы). */
  controlled: boolean;
  /** Есть ли замеры у строки — спрашивается только при выключении. */
  hasReadings: (rowId: string) => boolean;
}): ClimateMembershipPlan {
  const { rooms, room } = args;
  const index = findClimateRowIndex(rooms, room.id);

  if (args.controlled) {
    const norms = normalizeClimateRoomNorms(room.climateNorms);
    const name = room.name.trim();
    if (index >= 0) {
      const row = rooms[index];
      const next: ClimateRoomConfig = {
        ...row,
        roomId: room.id,
        name: name || row.name,
        ...(norms ? { temperature: norms.temperature, humidity: norms.humidity } : {}),
      };
      if (sameRow(row, next)) return { action: "none" };
      return { action: "write", rooms: rooms.map((item, i) => (i === index ? next : item)) };
    }
    // Старая строка без связи с тем же названием — связываем, ключи замеров не трогаем.
    const needle = name.toLowerCase();
    const legacy = needle ? rooms.findIndex((row) => !row.roomId && row.name.trim().toLowerCase() === needle) : -1;
    if (legacy >= 0) {
      const row = rooms[legacy];
      const next: ClimateRoomConfig = {
        ...row,
        roomId: room.id,
        ...(norms ? { temperature: norms.temperature, humidity: norms.humidity } : {}),
      };
      return { action: "write", rooms: rooms.map((item, i) => (i === legacy ? next : item)) };
    }
    return { action: "write", rooms: [...rooms, climateRoomFromDirectory(room)] };
  }

  if (index < 0) return { action: "none" };
  if (rooms.length <= 1) return { action: "none" };
  if (args.hasReadings(rooms[index].id)) return { action: "none" };
  return { action: "write", rooms: rooms.filter((_, i) => i !== index) };
}

/**
 * Какие документы правим: свой документ объекта помещения; если у объекта
 * своего нет — общий документ организации (без объекта). Плюс документы, где
 * строка помещения уже есть (выключение должно убрать её и там).
 */
export function pickClimateDocumentsForRoom<T extends { buildingId: string | null; hasRoom: boolean }>(
  documents: readonly T[],
  buildingId: string,
): T[] {
  const own = documents.filter((doc) => doc.buildingId === buildingId);
  const base = own.length > 0 ? own : documents.filter((doc) => doc.buildingId === null);
  const picked = new Set<T>(base);
  for (const doc of documents) if (doc.hasRoom) picked.add(doc);
  return documents.filter((doc) => picked.has(doc));
}
