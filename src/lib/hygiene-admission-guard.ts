import type { PrismaClient } from "@prisma/client";

import { hygieneAdmissionWriteError } from "@/lib/hygiene-admission";
import { readHygieneFormVersion } from "@/lib/hygiene-v2";

/**
 * Серверная проверка «Допущен только после ответа о здоровье» для общих
 * путей записи в гигиенический журнал (ячейка, пакет, внешний API).
 * Ответ сотрудника берётся из записей В БАЗЕ, а не из присланных данных.
 */

type EntryReader = {
  journalDocumentEntry: Pick<PrismaClient["journalDocumentEntry"], "findMany">;
};

export type HygieneWriteItem = { employeeId: string; date: Date; data: unknown };

function mightAdmit(data: unknown, formVersion: 1 | 2): boolean {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const record = data as Record<string, unknown>;
  const verification = record.verification as Record<string, unknown> | undefined;
  if (verification && typeof verification === "object" && verification.result === "admitted") return true;
  return formVersion === 2 && record.status === "healthy";
}

function slotKey(employeeId: string, date: Date): string {
  return `${employeeId}|${date.toISOString().slice(0, 10)}`;
}

/**
 * Текст отказа, если хоть одна запись ставит «Допущен» без ответа
 * сотрудника за этот день; иначе null. Не гигиена — всегда null.
 */
export async function findHygieneAdmissionViolation(
  client: EntryReader,
  params: {
    templateCode: string | null | undefined;
    documentId: string;
    config: unknown;
    items: ReadonlyArray<HygieneWriteItem>;
    /** Запись, которую правят по id (PUT с `entryId`), — её данные вместо слота. */
    previousOverride?: { data: unknown } | null;
  }
): Promise<string | null> {
  if (params.templateCode !== "hygiene") return null;
  const formVersion = readHygieneFormVersion(params.config);
  const candidates = params.items.filter((item) => mightAdmit(item.data, formVersion));
  if (candidates.length === 0) return null;

  const previous = new Map<string, unknown>();
  if (params.previousOverride === undefined || params.previousOverride === null) {
    const rows = await client.journalDocumentEntry.findMany({
      where: {
        documentId: params.documentId,
        employeeId: { in: [...new Set(candidates.map((item) => item.employeeId))] },
        date: { in: candidates.map((item) => item.date) },
      },
      select: { employeeId: true, date: true, data: true },
    });
    for (const row of rows) previous.set(slotKey(row.employeeId, row.date), row.data);
  }

  for (const item of candidates) {
    const before =
      params.previousOverride !== undefined && params.previousOverride !== null
        ? params.previousOverride.data
        : previous.get(slotKey(item.employeeId, item.date)) ?? null;
    const error = hygieneAdmissionWriteError({ formVersion, previous: before, next: item.data });
    if (error) return error;
  }
  return null;
}
