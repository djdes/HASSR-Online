/**
 * 1С:ЗУП → сотрудники WeSetup: что принять, кого уволить, что поправить.
 *
 * Чистая функция — одна на оба пути данных (OData и обработка 1С через
 * API) и на «Проверить» / «Применить». Правила:
 *  - сотрудник 1С связан с сотрудником WeSetup по id из 1С (`HrEmployeeLink`);
 *    при первой встрече — по ФИО, только если такой работающий человек в
 *    WeSetup ровно один (тёзки — в «проблемы», не угадываем);
 *  - работает в 1С и нет в WeSetup → принять (должность по названию, иначе
 *    должность по умолчанию; нет ни той, ни другой — проблема);
 *  - изменились ФИО или должность → обновить;
 *  - уволен в 1С (дата увольнения наступила или в архиве) → уволить в
 *    WeSetup; уволенного в WeSetup обратно не принимаем — только сообщаем.
 * Никого не удаляем; повторный прогон на тех же данных ничего не меняет.
 */

export type HrEmployee = {
  /** id сотрудника в 1С (Ref_Key) или из обработки 1С. */
  externalId: string;
  fullName: string;
  position: string | null;
  /** YYYY-MM-DD */
  hiredAt: string | null;
  /** YYYY-MM-DD; null — работает. */
  dismissedAt: string | null;
  /** Сотрудник в архиве 1С — уволен давно, даты может не быть. */
  archived: boolean;
  phone: string | null;
  /** Текущее подразделение в 1С (id и/или название) — для точки сотрудника. */
  departmentId?: string | null;
  departmentName?: string | null;
};

export type WsUser = { id: string; name: string; isActive: boolean; archived: boolean; jobPositionId: string | null };
export type WsPosition = { id: string; name: string };
export type HrLinkRef = { externalId: string; userId: string };

export type HrAction =
  | { kind: "hire"; employee: HrEmployee; positionId: string; positionName: string }
  | { kind: "link"; employee: HrEmployee; userId: string }
  | { kind: "update"; employee: HrEmployee; userId: string; name: string | null; positionId: string | null; positionName: string | null }
  | { kind: "dismiss"; employee: HrEmployee; userId: string; userName: string };

export type HrProblem = {
  employee: HrEmployee;
  reason: "no_position" | "dismissed_in_wesetup" | "ambiguous_name";
};

export type HrPlan = { actions: HrAction[]; problems: HrProblem[]; unchanged: number };

/** «Иванова  Мария Ёлкина» → «иванова мария елкина». */
export function normalizeName(value: string): string {
  return value.toLocaleLowerCase("ru").replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

export function isDismissed(employee: HrEmployee, today: string): boolean {
  return employee.archived || (employee.dismissedAt !== null && employee.dismissedAt <= today);
}

export function planHrSync(input: {
  employees: HrEmployee[];
  links: HrLinkRef[];
  users: WsUser[];
  positions: WsPosition[];
  defaultPositionId: string | null;
  /** YYYY-MM-DD в часовом поясе организации. */
  today: string;
}): HrPlan {
  const plan: HrPlan = { actions: [], problems: [], unchanged: 0 };
  const users = new Map(input.users.map((user) => [user.id, user]));
  const linkByExternal = new Map(input.links.map((link) => [link.externalId, link.userId]));
  const linkedUsers = new Set(input.links.map((link) => link.userId));
  const positionByName = new Map(input.positions.map((position) => [normalizeName(position.name), position]));
  const defaultPosition = input.positions.find((position) => position.id === input.defaultPositionId) ?? null;
  const seen = new Set<string>();

  for (const employee of input.employees) {
    if (seen.has(employee.externalId)) continue;
    seen.add(employee.externalId);
    const dismissed = isDismissed(employee, input.today);
    const target = employee.position ? positionByName.get(normalizeName(employee.position)) ?? null : null;

    const linkedId = linkByExternal.get(employee.externalId);
    const linked = linkedId ? users.get(linkedId) : undefined;
    if (linkedId && !linked) {
      // Сотрудника удалили в WeSetup — связь осталась, делать нечего.
      plan.unchanged += 1;
      continue;
    }

    let user = linked;
    if (!user) {
      const candidates = input.users.filter(
        (candidate) =>
          candidate.isActive &&
          !candidate.archived &&
          !linkedUsers.has(candidate.id) &&
          normalizeName(candidate.name) === normalizeName(employee.fullName),
      );
      if (candidates.length > 1) {
        plan.problems.push({ employee, reason: "ambiguous_name" });
        continue;
      }
      if (candidates.length === 1) {
        user = candidates[0];
        linkedUsers.add(user.id);
        plan.actions.push({ kind: "link", employee, userId: user.id });
      }
    }

    if (!user) {
      if (dismissed) {
        // Уволен в 1С и у нас его не было — ничего не делаем.
        plan.unchanged += 1;
        continue;
      }
      const position = target ?? defaultPosition;
      if (!position) {
        plan.problems.push({ employee, reason: "no_position" });
        continue;
      }
      plan.actions.push({ kind: "hire", employee, positionId: position.id, positionName: position.name });
      continue;
    }

    const working = user.isActive && !user.archived;
    if (dismissed) {
      if (working) plan.actions.push({ kind: "dismiss", employee, userId: user.id, userName: user.name });
      else if (!plan.actions.some((action) => action.kind === "link" && action.userId === user.id)) plan.unchanged += 1;
      continue;
    }
    if (!working) {
      plan.problems.push({ employee, reason: "dismissed_in_wesetup" });
      continue;
    }
    const name = normalizeName(user.name) !== normalizeName(employee.fullName) ? employee.fullName.replace(/\s+/g, " ").trim() : null;
    const position = target && target.id !== user.jobPositionId ? target : null;
    if (name || position) {
      plan.actions.push({
        kind: "update",
        employee,
        userId: user.id,
        name,
        positionId: position?.id ?? null,
        positionName: position?.name ?? null,
      });
    } else if (!plan.actions.some((action) => action.kind === "link" && action.userId === user.id)) {
      plan.unchanged += 1;
    }
  }
  return plan;
}

export type HrPlanSummary = { hire: number; link: number; update: number; dismiss: number; problems: number; unchanged: number };

export function summarizePlan(plan: HrPlan): HrPlanSummary {
  const count = (kind: HrAction["kind"]) => plan.actions.filter((action) => action.kind === kind).length;
  return {
    hire: count("hire"),
    link: count("link"),
    update: count("update"),
    dismiss: count("dismiss"),
    problems: plan.problems.length,
    unchanged: plan.unchanged,
  };
}
