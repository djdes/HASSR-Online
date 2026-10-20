/**
 * «Чек-листы → Результаты» (2026-10-19): короткая сводка завершённой проверки
 * для списка и фильтры истории. Чистые функции — их проверяет
 * `checklist-results.test.ts`, читают страница результатов и уведомление
 * проверяющему.
 */

export type ChecklistResultSummary = {
  earned: number;
  possible: number;
  /** Процент баллов; `null`, если баллов нет (только текст/фото) или результат обнулён. */
  percent: number | null;
  violations: number;
  critical: number;
  /** Критическая остановка: проверку завершили досрочно. */
  stopped: boolean;
};

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Сводка из сохранённого `ChecklistInspection.result` (JSON); не тот формат — `null`. */
export function summarizeChecklistResult(result: unknown): ChecklistResultSummary | null {
  if (!result || typeof result !== "object") return null;
  const value = result as { score?: { earned?: unknown; possible?: unknown }; violations?: unknown; critical?: unknown; stopped?: unknown };
  if (!value.score || typeof value.score !== "object") return null;
  const earned = finite(value.score.earned);
  const possible = finite(value.score.possible);
  return {
    earned,
    possible,
    percent: possible > 0 ? Math.round((earned / possible) * 100) : null,
    violations: Array.isArray(value.violations) ? value.violations.length : 0,
    critical: Array.isArray(value.critical) ? value.critical.length : 0,
    stopped: value.stopped === true,
  };
}

export const CHECKLIST_RESULT_PERIODS = ["7", "30", "90", "all"] as const;
export type ChecklistResultPeriod = (typeof CHECKLIST_RESULT_PERIODS)[number];

export type ChecklistResultFilters = {
  templateId: string | null;
  period: ChecklistResultPeriod;
  violationsOnly: boolean;
};

/** Фильтры из адреса страницы (`?template=…&period=30&violations=1`); мусор — по умолчанию. */
export function parseChecklistResultFilters(params: Record<string, string | string[] | undefined>): ChecklistResultFilters {
  const one = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const template = one("template")?.trim();
  const period = one("period");
  return {
    templateId: template && template.length <= 100 ? template : null,
    period: (CHECKLIST_RESULT_PERIODS as readonly string[]).includes(period ?? "") ? (period as ChecklistResultPeriod) : "30",
    violationsOnly: one("violations") === "1",
  };
}

/** С какого момента показывать историю; `null` — за всё время. */
export function resultPeriodStart(period: ChecklistResultPeriod, now: Date): Date | null {
  if (period === "all") return null;
  return new Date(now.getTime() - Number(period) * 24 * 60 * 60 * 1000);
}

/** «Только с нарушениями»: нарушения или критическая остановка. */
export function hasViolations(summary: ChecklistResultSummary | null): boolean {
  return !!summary && (summary.violations > 0 || summary.critical > 0 || summary.stopped);
}

/**
 * Кто может «Принять результат»: проверка завершена и ещё не принята, а
 * человек — проверяющий по назначению или руководитель (`admin.full`).
 */
export function canReviewInspection(input: {
  status: string;
  reviewedAt: Date | string | null;
  verifierUserId: string | null;
  userId: string;
  isAdmin: boolean;
}): boolean {
  if (input.status !== "completed" || input.reviewedAt) return false;
  return input.isAdmin || (!!input.verifierUserId && input.verifierUserId === input.userId);
}
