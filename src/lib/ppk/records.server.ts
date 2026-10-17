import { db } from "@/lib/db";
import { checkTeamGroup, parsePpkRecords, type PpkRecordBlock, type TeamMember } from "./records";

/**
 * Проверка ссылок внутри данных записи: сотрудник, опасность и журнал должны
 * существовать и принадлежать этой организации. Возвращает текст ошибки для
 * ответа 400 или null, если ссылки в порядке.
 */
export async function checkPpkRefs(
  organizationId: string,
  block: PpkRecordBlock,
  data: Record<string, unknown>,
): Promise<string | null> {
  const userIds: string[] = [];
  if (block === "team" && typeof data.userId === "string") userIds.push(data.userId);
  if (block === "policy" && typeof data.approvedById === "string") userIds.push(data.approvedById);
  if (block === "control-points" && typeof data.responsibleId === "string") userIds.push(data.responsibleId);
  if (block === "doc-versions" && typeof data.approvedById === "string") userIds.push(data.approvedById);
  if (block === "team-meetings" && Array.isArray(data.attendeeIds)) {
    for (const attendee of data.attendeeIds) if (typeof attendee === "string") userIds.push(attendee);
  }

  if (userIds.length > 0) {
    const found = await db.user.count({ where: { id: { in: userIds }, organizationId } });
    if (found !== new Set(userIds).size) return "Сотрудник не найден";
  }

  if (block === "control-points" && typeof data.hazardId === "string") {
    const hazard = await db.ppkRecord.findFirst({
      where: { id: data.hazardId, organizationId, block: "hazards" },
      select: { id: true },
    });
    if (!hazard) return "Опасность не найдена";
  }

  if (block === "control-points" && typeof data.journalCode === "string") {
    const journal = await db.journalTemplate.findUnique({
      where: { code: data.journalCode },
      select: { id: true },
    });
    if (!journal) return "Журнал не найден";
  }

  return null;
}

/** Текст ошибки для ответа 400: первое нарушение схемы по-русски, с путём поля. */
export function ppkValidationError(error: { issues: { path: PropertyKey[] }[] }): string {
  const path = error.issues[0]?.path.map(String).join(".") ?? "";
  return `Проверьте поле ${path || "данные"}`;
}

/**
 * Группа ХАССП на сервере: один руководитель, сотрудник не повторяется.
 * При правке `excludeId` — сама запись, чтобы она не конфликтовала сама с собой.
 * Возвращает текст ошибки для ответа 409 или null.
 */
export async function checkPpkTeamGroup(
  organizationId: string,
  data: Record<string, unknown>,
  excludeId?: string,
): Promise<string | null> {
  const rows = await db.ppkRecord.findMany({
    where: { organizationId, block: "team", ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, data: true, sortOrder: true, updatedAt: true },
  });
  const others = parsePpkRecords("team", rows).map((row) => row.data);
  return checkTeamGroup(others, data as unknown as TeamMember);
}
