/**
 * Человеческие тексты вместо кодов отказа от /api/journal-task-claims.
 *
 * API отвечает `{ ok: false, reason: "not_owner" }`, а экраны показывали
 * это значение как есть — повар видел на телефоне «not_owner» и не мог
 * понять ни что случилось, ни что делать дальше.
 */
import type { useTranslations } from "next-intl";

type ClaimText = ReturnType<typeof useTranslations<"miniUi">>;

/** @deprecated Russian-only legacy texts (kept for the existing unit test); screens use `claimReasonMessage`. */
const REASONS: Record<string, string> = {
  not_found: "Задача не найдена — возможно, её уже закрыли.",
  not_owner: "Эту задачу взял другой сотрудник — она больше не ваша.",
  not_active: "Задача уже закрыта — заново её завершать не нужно.",
  validation_failed: "Проверьте заполненные поля — что-то введено неверно.",
  internal_error: "Сервер не смог сохранить. Попробуйте ещё раз.",
  skip_not_allowed:
    "Для этого журнала пропуск не разрешён. Обратитесь к руководителю",
  skip_reason_required: "Напишите, почему сегодня заполнять не нужно",
  skip_reason_not_in_list: "Выберите причину из списка",
  manual_mode:
    "В вашей компании задачи назначает руководитель. Дождитесь назначения",
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

/** Localized message by failure reason and/or HTTP status. */
export function claimReasonMessage(
  t: ClaimText,
  reason: string | null | undefined,
  status?: number
): string {
  switch (reason) {
    case "not_found": return t("claimErrors.notFound");
    case "not_owner": return t("claimErrors.notOwner");
    case "not_active": return t("claimErrors.notActive");
    case "validation_failed": return t("claimErrors.validationFailed");
    case "internal_error": return t("claimErrors.internalError");
    case "skip_not_allowed": return t("claimErrors.skipNotAllowed");
    case "skip_reason_required": return t("claimErrors.skipReasonRequired");
    case "skip_reason_not_in_list": return t("claimErrors.skipReasonNotInList");
    case "manual_mode": return t("claimErrors.manualMode");
  }
  switch (status) {
    case 401: return t("claimErrors.status401");
    case 403: return t("claimErrors.status403");
    case 404: return t("claimErrors.notFound");
    case 409: return t("claimErrors.status409");
  }
  return t("claimErrors.generic");
}
