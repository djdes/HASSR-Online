/**
 * Человеческие тексты вместо кодов отказа от /api/journal-task-claims.
 *
 * API отвечает `{ ok: false, reason: "not_owner" }`, а экраны показывали
 * это значение как есть — повар видел на телефоне «not_owner» и не мог
 * понять ни что случилось, ни что делать дальше.
 */
const REASONS: Record<string, string> = {
  not_found: "Задача не найдена — возможно, её уже закрыли.",
  not_owner: "Эту задачу взял другой сотрудник — она больше не ваша.",
  not_active: "Задача уже закрыта — заново её завершать не нужно.",
  validation_failed: "Проверьте заполненные поля — что-то введено неверно.",
  internal_error: "Сервер не смог сохранить. Попробуйте ещё раз.",
  skip_not_allowed:
    "Для этого журнала пропуск не разрешён. Обратитесь к руководителю",
  skip_reason_required: "Напишите, почему сегодня заполнять не нужно",
};

const STATUSES: Record<number, string> = {
  401: "Вход закончился — войдите заново.",
  403: "Нет доступа к этой задаче.",
  404: "Задача не найдена — возможно, её уже закрыли.",
  409: "Задача уже закрыта или её взял другой сотрудник.",
};

/** Понятная строка по коду причины и/или HTTP-статусу ответа. */
export function claimReasonRu(
  reason: string | null | undefined,
  status?: number
): string {
  if (reason && REASONS[reason]) return REASONS[reason];
  if (status && STATUSES[status]) return STATUSES[status];
  return "Не получилось. Попробуйте ещё раз.";
}
