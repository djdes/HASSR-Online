/**
 * «Мониторинг» (эскиз 2026-10-28, лист 5): три показателя в процентах —
 * журналы за сегодня, чек-листы текущего периода и готовность ППК. Чистые
 * функции подсчёта; данные собирает `monitoring.server.ts`.
 */

/** «Сделано N из M»; `total = 0` — считать нечего. */
export type MonitoringMetric = { done: number; total: number };

/** Процент 0–100 (целый); нечего считать — null. */
export function metricPercent(metric: MonitoringMetric): number | null {
  if (metric.total <= 0) return null;
  return Math.round((Math.min(metric.done, metric.total) / metric.total) * 100);
}

/** Сумма показателей по точкам («Все точки»). */
export function sumMetrics(metrics: readonly MonitoringMetric[]): MonitoringMetric {
  return metrics.reduce((sum, metric) => ({ done: sum.done + metric.done, total: sum.total + metric.total }), {
    done: 0,
    total: 0,
  });
}

/** Назначение чек-листа в форме, нужной подсчёту. */
export type ChecklistAssignmentState = {
  active: boolean;
  templateArchived: boolean;
  targetKind: string;
  targetId: string;
  status: "off" | "pending" | "overdue" | "done";
};

/**
 * Чек-листы: выполненные назначения из тех, у кого сейчас идёт период
 * (выключенные, архивные и «не в этот день» не считаются). С точкой —
 * только назначения на эту точку.
 */
export function checklistMetric(
  assignments: readonly ChecklistAssignmentState[],
  pointId: string | null,
): MonitoringMetric {
  const current = assignments.filter(
    (assignment) =>
      assignment.active &&
      !assignment.templateArchived &&
      assignment.status !== "off" &&
      (!pointId || (assignment.targetKind === "building" && assignment.targetId === pointId)),
  );
  return { done: current.filter((assignment) => assignment.status === "done").length, total: current.length };
}

/** Журналы точки: заполненные сегодня из включённых в её набор. */
export function journalMetric(
  templates: readonly { id: string; code: string }[],
  disabledCodes: ReadonlySet<string>,
  filledTemplateIds: ReadonlySet<string>,
): MonitoringMetric {
  const enabled = templates.filter((template) => !disabledCodes.has(template.code));
  return { done: enabled.filter((template) => filledTemplateIds.has(template.id)).length, total: enabled.length };
}
