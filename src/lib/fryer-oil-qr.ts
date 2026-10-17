/**
 * Запись с QR-наклейки фритюрницы (2026-10-17, план 4.3) — БД.
 *
 * Одна строка журнала — один день работы фритюрницы. Первый скан за день —
 * начало жарки (жир, продукция, оценка в начале, время — сейчас), второй —
 * окончание (оценка в конце, остаток и утилизация, время — сейчас).
 * Строку выбирает `resolveFryerFillTarget` (equipment-fill-targets.ts).
 */
import { z } from "zod";
import { db } from "@/lib/db";
import { normalizeFryerOilEntryData } from "@/lib/fryer-oil-document";
import { buildFryerQrEntryData, nowInZone, type FryerQrInput } from "@/lib/fryer-oil-equipment-link";
import { isValidDate, reserveUniqueDates } from "@/lib/fryer-oil-entries";
import type { FryerFillTarget } from "@/lib/equipment-fill-targets";

const quality = z.number().int().min(1).max(5);
const kg = z.number().min(0).max(1000);

export const fryerQrInputSchema = z.discriminatedUnion("phase", [
  z.object({
    phase: z.literal("start"),
    fatType: z.string().trim().min(1, "Выберите жир").max(200),
    productType: z.string().trim().min(1, "Выберите продукцию").max(500),
    quality,
  }),
  z.object({
    phase: z.literal("end"),
    quality,
    carryoverKg: kg.default(0),
    disposedKg: kg.default(0),
  }),
]);

/** Тело наклейки → вход записи (тип совпадает с `FryerQrInput`, это проверяет tsc). */
export function parseFryerQrInput(
  raw: unknown,
): { ok: true; input: FryerQrInput } | { ok: false; error: string } {
  const parsed = fryerQrInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Некорректные данные" };
  const input: FryerQrInput = parsed.data;
  return { ok: true, input };
}

export async function saveFryerQrEntry(params: {
  target: FryerFillTarget;
  equipment: { id: string; name: string };
  employee: { id: string; name: string };
  input: FryerQrInput;
  dayKey: string;
  timezone: string;
}): Promise<
  | { ok: true; entryId: string; time: string }
  | { ok: false; status: number; error: string; errorCode: "needStart" | "rowChanged" | "saveError" }
> {
  const { target, equipment, employee, input, dayKey } = params;
  const time = nowInZone(params.timezone);
  const row = target.row;
  if (input.phase === "end" && row.kind !== "existing") {
    return { ok: false, status: 409, error: "Сначала отметьте начало жарки", errorCode: "needStart" };
  }
  const base = row.kind === "new" ? normalizeFryerOilEntryData({}) : row.entry.data;
  const data = buildFryerQrEntryData({ base, input, equipment, employeeName: employee.name, dayKey, time });

  if (row.kind === "new") {
    const [date] = await reserveUniqueDates(target.documentId, employee.id, [data]);
    if (!isValidDate(date)) return { ok: false, status: 400, error: "Некорректная дата записи", errorCode: "saveError" };
    const created = await db.journalDocumentEntry.create({
      data: { documentId: target.documentId, employeeId: employee.id, date, data },
      select: { id: true },
    });
    return { ok: true, entryId: created.id, time: time.label };
  }

  // Строка уже есть (или заготовка дня): автор строки не меняется —
  // иначе можно упереться в unique (документ, сотрудник, метка времени).
  const current = await db.journalDocumentEntry.findFirst({
    where: { id: row.entry.id, documentId: target.documentId },
    select: { id: true, employeeId: true },
  });
  if (!current) return { ok: false, status: 409, error: "Строка журнала изменилась — отсканируйте ещё раз", errorCode: "rowChanged" };
  if (input.phase === "end") {
    await db.journalDocumentEntry.update({ where: { id: current.id }, data: { data } });
    return { ok: true, entryId: current.id, time: time.label };
  }
  const [date] = await reserveUniqueDates(target.documentId, current.employeeId, [data], current.id);
  if (!isValidDate(date)) return { ok: false, status: 400, error: "Некорректная дата записи", errorCode: "saveError" };
  await db.journalDocumentEntry.update({ where: { id: current.id }, data: { date, data } });
  return { ok: true, entryId: current.id, time: time.label };
}
