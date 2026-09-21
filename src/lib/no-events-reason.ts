/**
 * «Сегодня не требуется»: какие причины принимать.
 *
 * Настройки журнала (`/settings/journals/<code>/scope`): список причин
 * `noEventsReasons` и разрешение своего текста `allowFreeTextReason`.
 * Раньше экран задачи показывал голое поле, а сервер проверял только
 * длину — список и запрет своего текста ничего не значили.
 *
 * Чистые функции: их зовут и API, и экран задачи в приложении.
 */

export type SkipReasonPolicy = {
  /** Готовые причины на выбор (кнопки). Пустой — только свой текст. */
  reasons: string[];
  /** Можно ли написать свою причину. */
  allowFreeText: boolean;
};

export const SKIP_REASON_MIN_LENGTH = 3;

export function parseSkipReasonPolicy(template: {
  noEventsReasons?: unknown;
  allowFreeTextReason?: boolean | null;
} | null | undefined): SkipReasonPolicy {
  const reasons = Array.isArray(template?.noEventsReasons)
    ? (template.noEventsReasons as unknown[])
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    : [];
  return {
    reasons,
    // Без готовых причин запрет своего текста сделал бы пропуск
    // невозможным — в этом случае свой текст разрешён всегда.
    allowFreeText: reasons.length === 0 || template?.allowFreeTextReason !== false,
  };
}

export type SkipReasonCheck =
  | { ok: true; reason: string }
  | {
      ok: false;
      code: "skip_reason_required" | "skip_reason_not_in_list";
      message: string;
    };

export function checkSkipReason(
  raw: string | null | undefined,
  policy: SkipReasonPolicy
): SkipReasonCheck {
  const reason = (raw ?? "").trim();
  if (policy.reasons.includes(reason)) return { ok: true, reason };
  if (!policy.allowFreeText) {
    return {
      ok: false,
      code: "skip_reason_not_in_list",
      message: "Выберите причину из списка",
    };
  }
  if (reason.length < SKIP_REASON_MIN_LENGTH) {
    return {
      ok: false,
      code: "skip_reason_required",
      message:
        policy.reasons.length > 0
          ? "Выберите причину из списка или напишите свою"
          : "Напишите, почему сегодня заполнять не нужно",
    };
  }
  return { ok: true, reason };
}
