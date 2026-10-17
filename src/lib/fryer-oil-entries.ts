/**
 * Строки журнала фритюра в БД: метки времени без коллизий. Общие для API
 * журнала (`api/journal-documents/[id]/fryer-oil`) и QR-наклейки
 * фритюрницы (`api/equipment-fill/[equipmentId]/fryer`).
 */
import { db } from "@/lib/db";
import type { normalizeFryerOilEntryData } from "@/lib/fryer-oil-document";

export function toTimestamp(data: {
  startDate: string;
  startHour: number | null;
  startMinute: number | null;
}) {
  // Время может быть не заполнено (строка-заготовка на день) — тогда
  // ключом даты служит полночь, а не «null:null».
  const hour = String(data.startHour ?? 0).padStart(2, "0");
  const minute = String(data.startMinute ?? 0).padStart(2, "0");
  return new Date(`${data.startDate}T${hour}:${minute}:00.000Z`);
}

/**
 * Сколько строк помещается в одну минуту журнала.
 *
 * В таблице стоит @@unique([documentId, employeeId, date]), а у всех
 * фритюрниц одного дня время начала совпадает — метки разводятся
 * сдвигом внутри минуты. Сдвиг был секундным и упирался в 60 строк на
 * день; в заведении может стоять и сотня фритюрниц, поэтому шаг —
 * миллисекунда.
 */
export const MAX_OFFSET_MS = 60_000;

/** Потолок на одну отправку: защита от случайной пачки в миллион строк. */
export const MAX_BATCH_ITEMS = 500;

export function isValidDate(value: Date) {
  return Number.isFinite(value.getTime());
}

/**
 * Свободные метки времени для строк одного дня.
 *
 * Занятые метки читаются одним запросом на минуту, а не по одной на
 * попытку: при сотне фритюрниц это была сотня round-trip'ов подряд.
 * Внутри пачки метки тоже резервируются — иначе две новые строки
 * получили бы одинаковую дату и упали на unique-констрейнте.
 */
export async function reserveUniqueDates(
  documentId: string,
  employeeId: string,
  items: ReturnType<typeof normalizeFryerOilEntryData>[],
  currentId?: string
): Promise<Date[]> {
  const takenByMinute = new Map<number, Set<number>>();
  const dates: Date[] = [];

  for (const data of items) {
    const base = toTimestamp(data);
    if (!isValidDate(base)) {
      // Невалидную дату отдаём как есть — вызывающий её проверит и
      // ответит 400 с понятной причиной.
      dates.push(base);
      continue;
    }

    const baseMs = base.getTime();
    let taken = takenByMinute.get(baseMs);
    if (!taken) {
      const rows = await db.journalDocumentEntry.findMany({
        where: {
          documentId,
          employeeId,
          date: { gte: base, lt: new Date(baseMs + MAX_OFFSET_MS) },
          ...(currentId ? { NOT: { id: currentId } } : {}),
        },
        select: { date: true },
      });
      taken = new Set(rows.map((row) => row.date.getTime() - baseMs));
      takenByMinute.set(baseMs, taken);
    }

    let offset = 0;
    while (offset < MAX_OFFSET_MS && taken.has(offset)) offset += 1;
    if (offset >= MAX_OFFSET_MS) {
      throw new Error("Слишком много записей на одно и то же время");
    }
    taken.add(offset);
    dates.push(new Date(baseMs + offset));
  }

  return dates;
}

