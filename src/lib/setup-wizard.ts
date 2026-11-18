/**
 * Мастер первого входа (владелец, 2026-11-18): анкета, затем «Объекты»,
 * «Сотрудники», «Оборудование». Шаги после анкеты необязательны — у каждого
 * «Пропустить». Чистый модуль: порядок шагов для окна анкеты и тестов.
 */

export const SETUP_STEPS = ["profile", "points", "staff", "equipment"] as const;

export type SetupStep = (typeof SETUP_STEPS)[number];

export function setupStepIndex(step: SetupStep): number {
  return SETUP_STEPS.indexOf(step);
}

/** Следующий шаг; после последнего — null (мастер закрывается). */
export function nextSetupStep(step: SetupStep): SetupStep | null {
  return SETUP_STEPS[setupStepIndex(step) + 1] ?? null;
}
