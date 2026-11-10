/**
 * Итоги задачи CRM (2026-11-10): чем закончился звонок. Итог двигает сделку
 * воронки (`stageForOutcome`), «перезвонить» требует дату следующего шага.
 * Чистый модуль — его берут и сервер, и форма закрытия задачи.
 */

export const TASK_OUTCOMES = {
  reached: "Дозвонился",
  no_answer: "Не дозвонился",
  callback: "Просили перезвонить",
  promised: "Обещали оплатить",
  declined: "Отказ",
} as const;

export type TaskOutcome = keyof typeof TASK_OUTCOMES;

export const TASK_OUTCOME_KEYS = Object.keys(TASK_OUTCOMES) as [TaskOutcome, ...TaskOutcome[]];

export function isTaskOutcome(value: unknown): value is TaskOutcome {
  return typeof value === "string" && value in TASK_OUTCOMES;
}

/** Без даты следующего шага такой итог не закрыть. */
export function outcomeNeedsFollowUp(outcome: TaskOutcome): boolean {
  return outcome === "callback";
}

/** Следующий шаг предлагаем сами (форма подставит завтра). */
export function outcomeSuggestsFollowUp(outcome: TaskOutcome): boolean {
  return outcome === "callback" || outcome === "no_answer" || outcome === "promised";
}
