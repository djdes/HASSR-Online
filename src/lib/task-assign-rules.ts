import {
  hasCapability,
  isControlGroupMember,
} from "@/lib/permission-presets";
import { canAssignJournal, filterSubordinates, type ManagerScope } from "@/lib/manager-scope";

/**
 * Кто кому может назначить задачу (`POST /api/journal-task-claims/assign`).
 *
 *   • `admin.full` — любому сотруднику организации, любой журнал;
 *   • `tasks.assign` без `admin.full` (контроль-группа) — только людям из
 *     своей «Иерархии» (`ManagerScope`: viewMode / должности / люди) и
 *     только журналы из `assignableJournalCodes` (пусто — все). Строки
 *     иерархии нет — видит всех, как и везде в кабинете (`filterSubordinates`);
 *   • участнику контроль-группы задачу не назначить — он не заполняет.
 *
 * Чистая функция: маршрут подставляет пользователя, цель и `ManagerScope`.
 */

export type AssignActor = {
  id: string;
  role?: string | null;
  isRoot?: boolean | null;
  permissionPreset?: string | null;
  orgPresetOverrides?: Record<string, string[]> | null;
};

export type AssignTarget = {
  id: string;
  jobPositionId: string | null;
  permissionPreset?: string | null;
  isRoot?: boolean | null;
};

export type AssignDecision =
  | { ok: true; unrestricted: boolean }
  | { ok: false; status: 403 | 409; code: AssignRefusal; error: string };

export type AssignRefusal =
  | "NO_CAPABILITY"
  | "TARGET_CONTROL_GROUP"
  | "TARGET_OUT_OF_SCOPE"
  | "JOURNAL_OUT_OF_SCOPE";

export function canAssignTasks(actor: AssignActor): boolean {
  return hasCapability(actor, "admin.full") || hasCapability(actor, "tasks.assign");
}

export function decideTaskAssignment(input: {
  actor: AssignActor;
  target: AssignTarget;
  journalCode: string;
  scope: ManagerScope | null;
}): AssignDecision {
  const { actor, target, journalCode, scope } = input;
  const unrestricted = hasCapability(actor, "admin.full");
  if (!unrestricted && !hasCapability(actor, "tasks.assign")) {
    return {
      ok: false,
      status: 403,
      code: "NO_CAPABILITY",
      error: "Назначать задачи может руководитель или контроль-группа",
    };
  }
  if (isControlGroupMember(target)) {
    return {
      ok: false,
      status: 409,
      code: "TARGET_CONTROL_GROUP",
      error: "Участник контроль-группы не заполняет журналы — назначьте задачу сотруднику, который их ведёт",
    };
  }
  if (unrestricted) return { ok: true, unrestricted: true };

  const visible = filterSubordinates([target], scope, actor.id);
  if (visible.length === 0) {
    return {
      ok: false,
      status: 403,
      code: "TARGET_OUT_OF_SCOPE",
      error: "Этот сотрудник вне вашей зоны. Кого вы видите, настраивает руководитель в «Иерархии»",
    };
  }
  if (!canAssignJournal(scope, journalCode)) {
    return {
      ok: false,
      status: 403,
      code: "JOURNAL_OUT_OF_SCOPE",
      error: "Задачи по этому журналу вам не назначены. Список журналов настраивает руководитель в «Иерархии»",
    };
  }
  return { ok: true, unrestricted: false };
}
