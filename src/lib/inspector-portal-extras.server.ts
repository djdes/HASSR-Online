import { db } from "@/lib/db";
import { staffAtBuildingWhere } from "@/lib/building-settings";
import { periodBounds } from "@/lib/inspector-qr";
import { countMedBooks, summarizeChecklistResult, type ChecklistResultSummary } from "@/lib/inspector-portal-extras";
import { checklistAssignmentAtPoint } from "@/lib/point-filters";

export type InspectorChecklistRow = {
  id: string;
  title: string;
  completedAt: string;
  summary: ChecklistResultSummary | null;
};

/** У ссылки на точку больше проверок не перебираем: на странице — 30 последних. */
const POINT_CHECKLIST_SCAN = 500;

function toChecklistRow(row: { id: string; title: string; completedAt: Date | null; result: unknown }): InspectorChecklistRow {
  return {
    id: row.id,
    title: row.title,
    completedAt: (row.completedAt ?? new Date(0)).toISOString(),
    summary: summarizeChecklistResult(row.result),
  };
}

/**
 * Завершённые проверки по чек-листам за период — новые сверху, до 30.
 * Выбираются только название, дата и итог: ни ответов, ни вложений, ни ФИО.
 * У ссылки на точку (`pointId`, 2026-11-01) — только проверки, назначенные
 * на эту точку (её людей, должность, её сотрудника) и без назначения.
 */
export async function loadInspectorChecklistResults(
  organizationId: string,
  from: string,
  to: string,
  pointId: string | null = null
): Promise<{ rows: InspectorChecklistRow[]; total: number }> {
  const bounds = periodBounds(from, to);
  const where = { organizationId, status: "completed", completedAt: bounds };

  if (pointId) {
    const [candidates, buildings] = await Promise.all([
      db.checklistInspection.findMany({
        where,
        orderBy: [{ completedAt: "desc" }, { id: "desc" }],
        take: POINT_CHECKLIST_SCAN,
        select: {
          id: true,
          title: true,
          completedAt: true,
          result: true,
          assignment: { select: { targetKind: true, targetId: true } },
        },
      }),
      db.building.findMany({ where: { organizationId }, select: { id: true } }),
    ]);
    const personIds = [
      ...new Set(
        candidates.flatMap((row) => (row.assignment?.targetKind === "user" ? [row.assignment.targetId] : []))
      ),
    ];
    const people = personIds.length
      ? await db.user.findMany({ where: { id: { in: personIds }, organizationId }, select: { id: true, buildingIds: true } })
      : [];
    const personPoints = new Map(people.map((person) => [person.id, person.buildingIds]));
    const livePointIds = new Set(buildings.map((building) => building.id));
    const visible = candidates.filter((row) =>
      checklistAssignmentAtPoint(row.assignment, pointId, personPoints, livePointIds)
    );
    return { total: visible.length, rows: visible.slice(0, 30).map(toChecklistRow) };
  }

  const [rows, total] = await Promise.all([
    db.checklistInspection.findMany({
      where,
      orderBy: [{ completedAt: "desc" }, { id: "desc" }],
      take: 30,
      select: { id: true, title: true, completedAt: true, result: true },
    }),
    db.checklistInspection.count({ where }),
  ]);
  return { total, rows: rows.map(toChecklistRow) };
}

/**
 * Медкнижки активных сотрудников: только два числа. У ссылки на точку —
 * сотрудники этой точки (и работающие на всех точках).
 */
export async function loadInspectorMedBookCounts(organizationId: string, now = new Date(), pointId: string | null = null) {
  const [users, certs] = await Promise.all([
    db.user.findMany({
      where: { organizationId, isActive: true, archivedAt: null, ...staffAtBuildingWhere(pointId) },
      select: { id: true },
    }),
    db.staffCompetency.findMany({
      where: {
        organizationId,
        OR: [{ skill: "med_book" }, { skill: { contains: "медкнижка", mode: "insensitive" } }],
      },
      select: { userId: true, expiresAt: true },
    }),
  ]);
  return countMedBooks(
    users.map((user) => user.id),
    certs,
    now
  );
}
