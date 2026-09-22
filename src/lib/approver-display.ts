import { positionMatchKey } from "@/lib/sphere-positions";
import { getRowEmployeeTitle, getUserDisplayTitle } from "@/lib/user-roles";

/**
 * Шапка «УТВЕРЖДАЮ» и строка «Ответственный»: должность и ФИО одного
 * человека.
 *
 * В конфиге документа лежат копии строк (`approveRole`, `approveEmployee`),
 * и раньше экран, карточка списка и PDF печатали их как есть. Когда
 * утверждающего меняла автоматика (слоты ответственных), ФИО менялось, а
 * должность — нет: «Заведующий производством» рядом с ФИО повара.
 *
 * Теперь человек по id — главный: должность и ФИО из его карточки.
 * Сохранённые строки — только если человека нет в списке (уволен, удалён).
 */

export type PersonDisplayUser = {
  id: string;
  name: string;
  role?: string | null;
  positionTitle?: string | null;
  jobPosition?: { name?: string | null } | null;
};

export type PersonDisplay = { title: string; name: string };

type ApproverConfigLike = {
  approveEmployeeId?: string | null;
  approveEmployee?: string | null;
  approveRole?: string | null;
};

type ResponsibleConfigLike = {
  responsibleEmployeeId?: string | null;
  responsibleEmployee?: string | null;
  responsibleRole?: string | null;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function resolvePerson(
  userId: unknown,
  storedName: unknown,
  storedTitle: unknown,
  users: readonly PersonDisplayUser[] | null | undefined
): PersonDisplay {
  const id = text(userId);
  const user = id ? users?.find((item) => item.id === id) : undefined;
  if (!user) return { title: text(storedTitle), name: text(storedName) };
  return {
    title: getRowEmployeeTitle(user, text(storedTitle)) || text(storedTitle),
    name: text(user.name) || text(storedName),
  };
}

/** Утверждающий шапки «УТВЕРЖДАЮ». */
export function resolveApprover(
  config: ApproverConfigLike | null | undefined,
  users: readonly PersonDisplayUser[] | null | undefined
): PersonDisplay {
  return resolvePerson(
    config?.approveEmployeeId,
    config?.approveEmployee,
    config?.approveRole,
    users
  );
}

/** Ответственный документа (строка «Ответственный: …»). */
export function resolveResponsible(
  config: ResponsibleConfigLike | null | undefined,
  users: readonly PersonDisplayUser[] | null | undefined
): PersonDisplay {
  return resolvePerson(
    config?.responsibleEmployeeId,
    config?.responsibleEmployee,
    config?.responsibleRole,
    users
  );
}

/**
 * Сравнение должностей: без регистра, ё = е, пробелы схлопнуты и без
 * учёта рода («Заведующая производством» = «Заведующий производством»).
 */
export function normalizeTitleKey(value: unknown): string {
  return positionMatchKey(text(value));
}

export type ApproverFixRule = "responsible" | "single-holder" | "keep-person";

export type ApproverFix = {
  rule: ApproverFixRule;
  approveEmployeeId: string;
  approveEmployee: string;
  approveRole: string;
};

/**
 * Починка шапки «УТВЕРЖДАЮ», где должность одного человека, а ФИО —
 * другого. `users` — живой ростер организации. Возвращает null, если
 * править нечего (должность совпадает или утверждающего нет в ростере).
 *
 *   1. Должность ответственного документа = `approveRole` → утверждающий
 *      становится ответственным (случай «заведующий выбран в диалоге, а
 *      слот подставил повара»).
 *   2. Иначе ровно один сотрудник организации с такой должностью → он.
 *   3. Иначе человек остаётся, `approveRole` = его настоящая должность.
 */
export function decideApproverFix(input: {
  config: ApproverConfigLike & { responsibleEmployeeId?: string | null };
  documentResponsibleUserId?: string | null;
  users: readonly PersonDisplayUser[];
}): ApproverFix | null {
  const { config, users } = input;
  const approverId = text(config.approveEmployeeId);
  if (!approverId) return null;
  const approver = users.find((user) => user.id === approverId);
  if (!approver) return null;

  const approveRoleKey = normalizeTitleKey(config.approveRole);
  const approverTitle = getUserDisplayTitle(approver);
  if (approveRoleKey && normalizeTitleKey(approverTitle) === approveRoleKey) return null;

  const toFix = (rule: ApproverFixRule, user: PersonDisplayUser): ApproverFix => ({
    rule,
    approveEmployeeId: user.id,
    approveEmployee: text(user.name),
    approveRole: getUserDisplayTitle(user),
  });

  if (approveRoleKey) {
    const responsibleIds = [
      text(config.responsibleEmployeeId),
      text(input.documentResponsibleUserId),
    ].filter(Boolean);
    for (const id of responsibleIds) {
      const responsible = users.find((user) => user.id === id);
      if (responsible && normalizeTitleKey(getUserDisplayTitle(responsible)) === approveRoleKey) {
        return toFix("responsible", responsible);
      }
    }

    const holders = users.filter(
      (user) => normalizeTitleKey(getUserDisplayTitle(user)) === approveRoleKey
    );
    if (holders.length === 1) return toFix("single-holder", holders[0]);
  }

  return toFix("keep-person", approver);
}
