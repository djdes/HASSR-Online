import type { Session } from "next-auth";
import { db } from "@/lib/db";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { listPersonBuildings, loadBuildingContext } from "@/lib/active-building";
import { getDisabledJournalCodes } from "@/lib/disabled-journals";
import { getTemplatesFilledToday } from "@/lib/today-compliance";
import { listAssignmentRows } from "@/lib/checklist-assignments.server";
import { loadPpkStatuses } from "@/lib/ppk/facts.server";
import { ppkProgress } from "@/lib/ppk/status";
import { buildingInScope, isPointScoped } from "@/lib/point-scope";
import {
  checklistMetric,
  journalMetric,
  sumMetrics,
  type MonitoringMetric,
} from "@/lib/monitoring";

export type MonitoringData = {
  points: { id: string; name: string }[];
  /** Выбранная точка; null — «Все точки». */
  pointId: string | null;
  /** Журналы ведутся по точкам (свой набор у каждой точки). */
  perPointJournals: boolean;
  journals: MonitoringMetric;
  checklists: MonitoringMetric;
  ppk: MonitoringMetric;
};

/**
 * Показатели «Мониторинга» для человека. Точки — те же, что у него в шапке
 * (`listPersonBuildings`, с учётом руководителя точки). «Все точки» — сумма
 * по его точкам. Журналы считаются как «N/M» на «Сегодня»: заполненные
 * сегодня из набора точки (без режима «журналы по точкам» набор один на всю
 * компанию). Чек-листы — назначения текущего периода. ППК ведётся на всю
 * компанию — от точки не зависит.
 */
export async function loadMonitoring(session: Session, requestedPointId: string | null): Promise<MonitoringData> {
  const organizationId = getActiveOrgId(session);
  const now = new Date();
  const [buildings, context, templates, assignments, ppkStatuses] = await Promise.all([
    listPersonBuildings(session),
    loadBuildingContext(session),
    db.journalTemplate.findMany({ where: { isActive: true }, select: { id: true, code: true } }),
    listAssignmentRows(organizationId, now).catch(() => []),
    loadPpkStatuses(organizationId).catch(() => null),
  ]);
  const points = buildings
    .filter((building) => buildingInScope(session.user, building.id))
    .map((building) => ({ id: building.id, name: building.name }));
  const pointId = requestedPointId && points.some((point) => point.id === requestedPointId) ? requestedPointId : null;
  const perPointJournals = context.enabled;

  const journalsAt = async (buildingId: string | null): Promise<MonitoringMetric> => {
    const disabled = await getDisabledJournalCodes(organizationId, buildingId);
    const filled = await getTemplatesFilledToday(organizationId, now, templates, disabled, {
      treatAperiodicAsFilled: false,
      buildingId,
    });
    return journalMetric(templates, disabled, filled);
  };
  let journals: MonitoringMetric;
  if (!perPointJournals) journals = await journalsAt(null);
  else if (pointId) journals = await journalsAt(pointId);
  else journals = sumMetrics(await Promise.all(points.map((point) => journalsAt(point.id))));

  const rows = assignments.map((row) => ({
    active: row.active,
    templateArchived: row.templateArchived,
    targetKind: row.targetKind,
    targetId: row.targetId,
    status: row.state.status,
  }));
  // Руководитель точки видит только назначения своих точек.
  const checklists = pointId
    ? checklistMetric(rows, pointId)
    : isPointScoped(session.user)
      ? sumMetrics(points.map((point) => checklistMetric(rows, point.id)))
      : checklistMetric(rows, null);

  const ppk = ppkStatuses ? ppkProgress(ppkStatuses) : { done: 0, total: 0 };
  return { points, pointId, perPointJournals, journals, checklists, ppk };
}
