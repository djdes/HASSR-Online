"use client";

import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";

/**
 * id вошедшего человека, если он есть в ростере документа, иначе "".
 *
 * Нужен там, где строку журнала надо на кого-то записать, а ответственного
 * у документа нет. Раньше клиенты брали «первого сотрудника в списке» — и
 * запись уходила от случайного человека. Вошедший сам — честный вариант;
 * ROOT, партнёр и сотрудник другой организации в ростер не входят и
 * получают "" (тогда клиент просит назначить ответственного).
 */
export function useRosterViewerId(users: ReadonlyArray<{ id: string }>): string {
  const { data } = useSession();
  const id = data?.user?.id ?? "";
  return id && users.some((user) => user.id === id) ? id : "";
}

/**
 * Sentinel for "no one to record the row for". Callers compare
 * `error.message` against it, so it stays a stable identifier; show
 * the localized text from `useNoRowEmployeeMessage()` to the user.
 */
export const NO_ROW_EMPLOYEE_MESSAGE =
  "Назначьте ответственного в настройках журнала — строка записывается на него.";

/** Localized hint shown when a row cannot be recorded for anyone. */
export function useNoRowEmployeeMessage(): string {
  return useTranslations("journalUi.rosterViewer")("noRowEmployee");
}
