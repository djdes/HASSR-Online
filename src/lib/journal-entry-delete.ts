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

/**
 * `{ ids }` — ровно эти строки; `{ employeeId, date }` — строка сотрудника за
 * этот день (полночь UTC, как при записи); `{ employeeId }` — вся его строка.
 */
export function entryDeleteTarget(documentId: string, body: EntryDeleteBody): EntryDeleteTarget {
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  if (ids.length > 0) return { ok: true, where: { documentId, id: { in: ids } } };

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
