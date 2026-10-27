/**
 * Временная работа на другой точке (2026-10-27): замена заболевшего,
 * помощь соседней точке. Чистые функции — без Prisma, гоняются в `node --test`.
 *
 * Пока назначение действует, временная точка лежит прямо в `User.buildingIds`:
 * списки «Кто вы?» на QR, журналы, обязательства, уведомления и права
 * руководителя точки работают без правок. Модель `UserPointAssignment`
 * хранит срок и то, что вернуть по окончании:
 *
 * - «transfer» («Перевести сюда») — на срок человек только на новой точке;
 *   его точки уходят в `removedBuildingIds` и по окончании возвращаются.
 * - «extra» («Добавить эту точку») — на срок и там, и там.
 * - `addedBuilding` — точку добавило само назначение; по окончании её
 *   убирают. Если человек уже работал там постоянно — она остаётся.
 *
 * Сотрудник «на всех точках» (пустой `buildingIds`) уже работает везде —
 * назначение не нужно; сотрудник офиса работает в офисе — для него
 * назначение недоступно. Одно действующее назначение на человека.
 * Серверная обвязка — `point-assignments.server.ts`.
 */

export const POINT_ASSIGNMENT_MODES = ["transfer", "extra"] as const;
export type PointAssignmentMode = (typeof POINT_ASSIGNMENT_MODES)[number];

export const ASSIGNMENT_MIN_DAYS = 1;
export const ASSIGNMENT_MAX_DAYS = 60;
/** Быстрые сроки в окне назначения. */
export const ASSIGNMENT_QUICK_DAYS = [1, 3, 7, 14] as const;

export function isPointAssignmentMode(value: unknown): value is PointAssignmentMode {
  return value === "transfer" || value === "extra";
}

export function isValidAssignmentDays(days: unknown): days is number {
  return (
    typeof days === "number" &&
    Number.isInteger(days) &&
    days >= ASSIGNMENT_MIN_DAYS &&
    days <= ASSIGNMENT_MAX_DAYS
  );
}

export type AssignmentBuilding = { id: string; kind?: string | null };

export type PlanAssignmentError =
  /** Срок вне 1–60 дней. */
  | "bad_days"
  /** Неизвестный режим. */
  | "bad_mode"
  /** Точки нет в организации. */
  | "unknown_building"
  /** Назначить в офис нельзя: офис — не торговая точка. */
  | "office_target"
  /** Сотрудник на всех точках — уже работает и здесь. */
  | "everywhere"
  /** Сотрудник офиса — работает в офисе, на точки не назначается. */
  | "office_user"
  /** Человек уже работает только на этой точке / уже есть эта точка. */
  | "already_there"
  /** Уже действует другое назначение — сначала завершить его. */
  | "overlap";

/** Тексты ошибок для API (интерфейс показывает свои, локализованные). */
export const PLAN_ASSIGNMENT_ERRORS: Record<PlanAssignmentError, string> = {
  bad_days: `Срок замены — от ${ASSIGNMENT_MIN_DAYS} до ${ASSIGNMENT_MAX_DAYS} дней`,
  bad_mode: "Выберите: перевести на точку или добавить точку",
  unknown_building: "Точка не найдена",
  office_target: "Офис — не торговая точка: на замену назначают на точку",
  everywhere:
    "Сотрудник работает на всех точках — он уже может работать и здесь, назначение не нужно",
  office_user:
    "Сотрудник работает в офисе — на замену на точку его не назначить. Отметьте ему точки в карточке сотрудника",
  already_there: "Сотрудник уже работает на этой точке",
  overlap:
    "У сотрудника уже есть временная точка — сначала завершите её в карточке сотрудника",
};

export type AssignmentPlan = {
  nextBuildingIds: string[];
  removedBuildingIds: string[];
  addedBuilding: boolean;
};

function knownIds(buildingIds: readonly string[], buildings: readonly AssignmentBuilding[]): string[] {
  const ids = new Set(buildings.map((building) => building.id));
  return buildingIds.filter((id) => ids.has(id));
}

/**
 * Можно ли назначить человека на точку и как — без срока (его проверяет
 * `planAssignment`). Висящие id удалённых точек не считаются: человек,
 * у которого остались только они, работает везде (`worksAtBuilding`).
 */
export function assignmentBlocker(args: {
  userBuildingIds: readonly string[];
  buildings: readonly AssignmentBuilding[];
  targetBuildingId: string;
  mode: PointAssignmentMode;
  hasActiveAssignment: boolean;
}): PlanAssignmentError | null {
  const target = args.buildings.find((building) => building.id === args.targetBuildingId);
  if (!target) return "unknown_building";
  if (target.kind === "office") return "office_target";
  const known = knownIds(args.userBuildingIds, args.buildings);
  if (known.length === 0) return "everywhere";
  const officeIds = new Set(args.buildings.filter((b) => b.kind === "office").map((b) => b.id));
  if (known.some((id) => officeIds.has(id))) return "office_user";
  if (args.hasActiveAssignment) return "overlap";
  if (args.mode === "extra" && known.includes(target.id)) return "already_there";
  if (args.mode === "transfer" && known.length === 1 && known[0] === target.id) return "already_there";
  return null;
}

export function planAssignment(args: {
  userBuildingIds: readonly string[];
  buildings: readonly AssignmentBuilding[];
  targetBuildingId: string;
  mode: unknown;
  days: unknown;
  hasActiveAssignment: boolean;
}): { ok: true; plan: AssignmentPlan } | { ok: false; error: PlanAssignmentError } {
  if (!isPointAssignmentMode(args.mode)) return { ok: false, error: "bad_mode" };
  if (!isValidAssignmentDays(args.days)) return { ok: false, error: "bad_days" };
  const mode = args.mode;
  const blocker = assignmentBlocker({ ...args, mode });
  if (blocker) return { ok: false, error: blocker };
  const target = args.targetBuildingId;
  const current = dedupe(args.userBuildingIds);
  const had = current.includes(target);
  if (mode === "extra") {
    return {
      ok: true,
      plan: { nextBuildingIds: [...current, target], removedBuildingIds: [], addedBuilding: true },
    };
  }
  return {
    ok: true,
    plan: {
      nextBuildingIds: [target],
      removedBuildingIds: current.filter((id) => id !== target),
      addedBuilding: !had,
    },
  };
}

export type AssignmentRestoreRef = {
  buildingId: string;
  removedBuildingIds: readonly string[];
  addedBuilding: boolean;
};

/**
 * Точки после окончания назначения: добавленная назначением точка
 * убирается, снятые возвращаются. Правки за время замены (новая постоянная
 * точка) сохраняются. Повторный вызов на результате ничего не меняет.
 */
export function restoreBuildingIds(current: readonly string[], assignment: AssignmentRestoreRef): string[] {
  const kept = assignment.addedBuilding ? current.filter((id) => id !== assignment.buildingId) : [...current];
  return dedupe([...assignment.removedBuildingIds, ...kept]);
}

/**
 * Правка точек целиком (карточка сотрудника, «Кто работает на точке»):
 * назначение живёт, пока его точка осталась у человека. Сняли временную
 * точку или сделали человека «на всех точках» — назначение завершается без
 * возврата: новая правка и есть то, как должно быть.
 */
export function assignmentSurvivesEdit(nextBuildingIds: readonly string[], assignment: { buildingId: string }): boolean {
  return nextBuildingIds.includes(assignment.buildingId);
}

/**
 * Основная точка после правки: остаётся, если она среди точек человека или
 * среди снятых действующим переводом (вернутся по окончании); иначе null.
 */
export function keepPrimaryBuilding(
  primaryBuildingId: string | null | undefined,
  nextBuildingIds: readonly string[],
  activeRemovedBuildingIds: readonly string[] = [],
): string | null {
  if (!primaryBuildingId) return null;
  return nextBuildingIds.includes(primaryBuildingId) || activeRemovedBuildingIds.includes(primaryBuildingId)
    ? primaryBuildingId
    : null;
}

/**
 * Точка человека «по месту» (уведомления): одна точка — она; несколько —
 * основная, если она среди них; иначе null (общее событие).
 */
export function placeBuildingOfUser(user: { buildingIds: readonly string[]; primaryBuildingId?: string | null }): string | null {
  if (user.buildingIds.length === 1) return user.buildingIds[0];
  if (user.primaryBuildingId && user.buildingIds.includes(user.primaryBuildingId)) return user.primaryBuildingId;
  return null;
}

/**
 * Должность в «Кто вы?» на QR точки с пометкой «Замена» у временного
 * сотрудника (`substituteUserIds` — из `loadQrPointScope`).
 */
export function qrRosterPosition(
  substituteUserIds: readonly string[] | null | undefined,
  userId: string,
  position: string | null | undefined,
  substituteLabel: string,
): string {
  const base = position?.trim() ?? "";
  if (!substituteUserIds?.includes(userId)) return base;
  return base ? `${base} · ${substituteLabel}` : substituteLabel;
}

function dedupe(ids: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of ids) if (id && !out.includes(id)) out.push(id);
  return out;
}

// ---------------------------------------------------------------- даты

/** Календарный день `YYYY-MM-DD` момента в часовом поясе организации. */
export function dateKeyInTimeZone(at: Date, timeZone: string): string {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
        .formatToParts(at)
        .map((part) => [part.type, part.value]),
    ) as Record<string, string>;
    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch {
    return dateKeyInTimeZone(at, "Europe/Moscow");
  }
}

/** `YYYY-MM-DD` + N дней. */
export function addDaysToKey(dateKey: string, days: number): string {
  const base = Date.UTC(Number(dateKey.slice(0, 4)), Number(dateKey.slice(5, 7)) - 1, Number(dateKey.slice(8, 10)));
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

function offsetMinutes(timeZone: string, at: Date): number {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
        .formatToParts(at)
        .map((part) => [part.type, part.value]),
    ) as Record<string, string>;
    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    return Math.round((asUtc - at.getTime()) / 60_000);
  } catch {
    return 180;
  }
}

/** Полночь (начало дня) `dateKey` в часовом поясе как момент UTC. */
export function startOfDayInTimeZone(dateKey: string, timeZone: string): Date {
  const naive = Date.parse(`${dateKey}T00:00:00Z`);
  let offset = offsetMinutes(timeZone, new Date(naive));
  offset = offsetMinutes(timeZone, new Date(naive - offset * 60_000));
  return new Date(naive - offset * 60_000);
}

/**
 * Окончание замены на N дней: полночь дня «сегодня + N» по часам
 * организации. «1 день» — сегодня, утром завтра человек снова на своей
 * точке. Возвращает момент и день возврата (`returnKey`) для подписи.
 */
export function assignmentEndsAt(now: Date, days: number, timeZone: string): { endsAt: Date; returnKey: string } {
  const returnKey = addDaysToKey(dateKeyInTimeZone(now, timeZone), days);
  return { endsAt: startOfDayInTimeZone(returnKey, timeZone), returnKey };
}

/** «05.11» из `YYYY-MM-DD`. */
export function shortDateLabel(dateKey: string): string {
  return `${dateKey.slice(8, 10)}.${dateKey.slice(5, 7)}`;
}
