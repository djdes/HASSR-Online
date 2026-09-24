/**
 * «Допущен» только после ответа сотрудника о здоровье (2026-09-24,
 * пожелание РПН). Чистый модуль: без БД, для сервера, QR-страниц и тестов.
 *
 * Ответ сотрудника — его подписи на вопросы о здоровье за этот день
 * (`confirmations` в записи дня гигиенического журнала): отметка по QR
 * «Гигиена и здоровье» или в задаче TasksFlow. Заготовка строки
 * (`_autoSeeded`) и статус, поставленный за сотрудника руками или
 * автоматикой, ответом не считаются.
 *
 * Правило: поставить «Допущен» можно, только если за этот день есть ответ
 * хотя бы на один вопрос. «Отстранён», «Выходной», «Болен», «Отпуск» —
 * всегда.
 */

export const ADMISSION_NEEDS_HEALTH_ANSWER_MESSAGE = "Сотрудник ещё не ответил на вопросы о здоровье";

/** Ключи подписей: три графы Приложения №1 и пять пунктов прежней формы QR. */
const HEALTH_ANSWER_KEYS = [
  "temperature",
  "infection",
  "respiratorySkin",
  "intestinal",
  "family",
  "respiratory",
  "skin",
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** За этот день сотрудник сам ответил хотя бы на один вопрос о здоровье. */
export function hasHealthAnswer(entryData: unknown): boolean {
  const record = asRecord(entryData);
  if (!record || record._autoSeeded === true) return false;
  const confirmations = asRecord(record.confirmations);
  if (!confirmations) return false;
  return HEALTH_ANSWER_KEYS.some((key) => typeof confirmations[key] === "boolean");
}

export type AdmissionDecision = { ok: true } | { ok: false; error: string };

/**
 * Можно ли поставить решение ответственного по записи дня сотрудника.
 * `entry` — запись дня в базе (не то, что прислал клиент).
 */
export function canAdmitEmployee(input: { result: "admitted" | "suspended"; entry: unknown }): AdmissionDecision {
  if (input.result === "suspended") return { ok: true };
  return hasHealthAnswer(input.entry) ? { ok: true } : { ok: false, error: ADMISSION_NEEDS_HEALTH_ANSWER_MESSAGE };
}

function verificationResult(data: unknown): "admitted" | "suspended" | null {
  const verification = asRecord(asRecord(data)?.verification);
  const result = verification?.result;
  return result === "admitted" || result === "suspended" ? result : null;
}

/**
 * Запись в гигиенический журнал через общие API (ячейка, пакет, внешний
 * API): не выдаёт ли она «Допущен» без ответа сотрудника.
 *
 * Допуском считается новое `verification.result = "admitted"`, а в
 * документе новой формы (Приложение №1) — ещё и «Здоров» без допуска: там
 * «Здоров» появляется только из подписи сотрудника или допуска
 * ответственного. Ответ проверяется по записи В БАЗЕ (`previous`) —
 * подписи, присланные вместе с допуском, не в счёт: иначе их можно
 * подставить за сотрудника.
 *
 * Возвращает текст отказа или null.
 */
export function hygieneAdmissionWriteError(input: {
  formVersion: 1 | 2;
  previous: unknown;
  next: unknown;
}): string | null {
  const next = asRecord(input.next);
  if (!next) return null;
  const previous = asRecord(input.previous);
  const nextResult = verificationResult(next);
  const previousResult = verificationResult(previous);

  const admitsByVerification = nextResult === "admitted" && previousResult !== "admitted";
  const admitsByStatus =
    input.formVersion === 2 &&
    next.status === "healthy" &&
    nextResult === null &&
    !(previous?.status === "healthy" && previous?._autoSeeded !== true);

  if (!admitsByVerification && !admitsByStatus) return null;
  return hasHealthAnswer(previous) ? null : ADMISSION_NEEDS_HEALTH_ANSWER_MESSAGE;
}

/**
 * Можно ли перенести запись гигиены на другой день («Как вчера», «Догнать
 * пропуски»). Подпись сотрудника и допуск ответственного — отметка
 * конкретного дня: перенесённые, они дали бы «Допущен» без сегодняшнего
 * ответа. В новой форме переносятся только выходной / отпуск / больничный.
 */
export function isHygieneEntryCopyable(data: unknown, formVersion: 1 | 2): boolean {
  const record = asRecord(data);
  if (!record) return false;
  if ("confirmations" in record || "verification" in record) return false;
  if (formVersion === 2) {
    return record.status === "day_off" || record.status === "vacation" || record.status === "sick_leave";
  }
  return true;
}
