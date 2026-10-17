import { db } from "@/lib/db";
import { periodBounds } from "@/lib/inspector-qr";
import { countMedBooks, summarizeChecklistResult, type ChecklistResultSummary } from "@/lib/inspector-portal-extras";

export type InspectorChecklistRow = {
  id: string;
  title: string;
  completedAt: string;
  summary: ChecklistResultSummary | null;
};

/**
 * Завершённые проверки по чек-листам за период — новые сверху, до 30.
 * Выбираются только название, дата и итог: ни ответов, ни вложений, ни ФИО.
 */
export async function loadInspectorChecklistResults(
  organizationId: string,
  from: string,
  to: string
): Promise<{ rows: InspectorChecklistRow[]; total: number }> {
  const bounds = periodBounds(from, to);
  const where = { organizationId, status: "completed", completedAt: bounds };
  const [rows, total] = await Promise.all([
    db.checklistInspection.findMany({
      where,
      orderBy: [{ completedAt: "desc" }, { id: "desc" }],
      take: 30,
      select: { id: true, title: true, completedAt: true, result: true },
    }),
    db.checklistInspection.count({ where }),
  ]);
  return {
    total,
    rows: rows.map((row) => ({
      id: row.id,
      title: row.title,
      completedAt: (row.completedAt ?? new Date(0)).toISOString(),
      summary: summarizeChecklistResult(row.result),
    })),
  };
}

/** Медкнижки активных сотрудников: только два числа. */
export async function loadInspectorMedBookCounts(organizationId: string, now = new Date()) {
  const [users, certs] = await Promise.all([
    db.user.findMany({
      where: { organizationId, isActive: true, archivedAt: null },
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
