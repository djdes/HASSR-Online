/**
 * Какие строки сетки удаляет руководитель (DELETE /api/journal-documents/[id]/entries).
 *
 * Одно и то же множество строк и проверяется на закрытые дни, и удаляется.
 * Раньше при `{ employeeId, date }` проверка брала все строки сотрудника (дата
 * не входила в условие): одна старая закрытая строка в документе автоматики
 * запрещала удалить его строку за день в окне «Правки прошлых дней».
 */

export type EntryDeleteBody = { ids?: unknown; employeeId?: unknown; date?: unknown };

export type EntryDeleteWhere = {
  documentId: string;
  id?: { in: string[] };
  employeeId?: string;
  date?: Date;
};

export type EntryDeleteTarget =
  | { ok: true; where: EntryDeleteWhere }
  | { ok: false; status: 400; error: string };

const BAD_IDS: EntryDeleteTarget = { ok: false, status: 400, error: "Некорректный список строк" };

/**
 * `{ ids }` — ровно эти строки; `{ employeeId, date }` — строка сотрудника за
 * этот день (полночь UTC, как при записи); `{ employeeId }` — вся его строка.
 */
export function entryDeleteTarget(documentId: string, body: EntryDeleteBody): EntryDeleteTarget {
  // Испорченный список — отказ: отбросить мусор и удалить по employeeId
  // значило бы стереть всю строку сотрудника. Пустой список — как без него.
  if (body.ids !== undefined && body.ids !== null) {
    if (!Array.isArray(body.ids)) return BAD_IDS;
    if (body.ids.length > 0) {
      const ids = body.ids;
      if (!ids.every((id): id is string => typeof id === "string" && id.length > 0)) return BAD_IDS;
      return { ok: true, where: { documentId, id: { in: ids } } };
    }
  }

  const employeeId = typeof body.employeeId === "string" && body.employeeId ? body.employeeId : null;
  if (employeeId && body.date) {
    const date = new Date(String(body.date));
    if (!Number.isFinite(date.getTime())) return { ok: false, status: 400, error: "Некорректная дата" };
    date.setUTCHours(0, 0, 0, 0);
    return { ok: true, where: { documentId, employeeId, date } };
  }
  if (employeeId) return { ok: true, where: { documentId, employeeId } };
  return { ok: false, status: 400, error: "Нужно передать ids либо employeeId и date" };
}
