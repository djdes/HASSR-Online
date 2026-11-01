import { checklistAssignmentAtPoint } from "@/lib/point-filters";
import { BUILDING_OUT_OF_SCOPE_ERROR, COMPANY_ONLY_API_ERROR, STAFF_OUT_OF_SCOPE_ERROR } from "@/lib/point-scope";

/**
 * Чек-листы и посещения проверяющих по точкам (2026-11-01, «точка видит
 * только своё»). Область человека — точки, которые он сейчас ведёт: точка
 * из шапки, у руководителя точки — только его точки
 * (`visibleObjectBuildingIds`). `points = null` — вся организация
 * (руководство в «Вся организация», точки выключены): без фильтра.
 * Модуль без Prisma — его читают API, страницы и тесты.
 */

export const CHECKLIST_POSITION_TARGET_ERROR =
  "Назначение на должность действует во всей компании — выберите свою точку или сотрудника";
export const CHECKLIST_ASSIGNMENT_NOT_FOUND = "Назначение не найдено";

export type ChecklistPointArea = {
  /** Точки области; null — вся организация. */
  points: readonly string[] | null;
  /** Руководитель точки: назначение на должность (на всю компанию) — не его. */
  pointScoped: boolean;
  /** `User.buildingIds` людей организации. */
  personPoints: ReadonlyMap<string, readonly string[]>;
  /** Точки организации: id удалённых точек у людей не считаются. */
  livePointIds: ReadonlySet<string>;
};

export function checklistPointArea(input: {
  points: readonly string[] | null;
  pointScoped?: boolean;
  buildings: readonly { id: string }[];
  people: readonly { id: string; buildingIds: readonly string[] }[];
}): ChecklistPointArea {
  return {
    points: input.points,
    pointScoped: input.pointScoped === true,
    personPoints: new Map(input.people.map((person) => [person.id, person.buildingIds])),
    livePointIds: new Set(input.buildings.map((building) => building.id)),
  };
}

type AssignmentTarget = { targetKind: string; targetId: string };

/** Назначение на одной из точек области (`checklistAssignmentAtPoint`); вся организация — да. */
export function assignmentInArea(area: ChecklistPointArea, assignment: AssignmentTarget | null | undefined): boolean {
  const points = area.points;
  if (!points) return true;
  return points.some((pointId) => checklistAssignmentAtPoint(assignment, pointId, area.personPoints, area.livePointIds));
}

/** Человек работает на точке области (пустой `buildingIds` — на всех точках). */
export function personInArea(area: ChecklistPointArea, personId: string): boolean {
  return assignmentInArea(area, { targetKind: "user", targetId: personId });
}

export type ChecklistAreaRefusal = { status: 403 | 404; error: string };

/**
 * Новая цель и проверяющий назначения — в области человека. Должность
 * действует во всей компании — руководителю точки её не назначить.
 * `keepVerifierUserId` — прежний проверяющий при правке: его оставляют.
 */
export function assignmentTargetRefusal(
  area: ChecklistPointArea,
  input: AssignmentTarget & { verifierUserId?: string | null },
  keepVerifierUserId?: string | null,
): ChecklistAreaRefusal | null {
  if (input.targetKind === "position") {
    if (area.pointScoped) return { status: 403, error: CHECKLIST_POSITION_TARGET_ERROR };
  } else if (!assignmentInArea(area, input)) {
    return { status: 403, error: input.targetKind === "building" ? BUILDING_OUT_OF_SCOPE_ERROR : STAFF_OUT_OF_SCOPE_ERROR };
  }
  const verifier = input.verifierUserId;
  if (verifier && verifier !== keepVerifierUserId && !personInArea(area, verifier)) {
    return { status: 403, error: STAFF_OUT_OF_SCOPE_ERROR };
  }
  return null;
}

/**
 * Изменить или удалить назначение: вне области — «не найдено»; назначение
 * на должность (на всю компанию) руководитель точки не трогает.
 */
export function assignmentChangeRefusal(area: ChecklistPointArea, existing: AssignmentTarget): ChecklistAreaRefusal | null {
  if (!assignmentInArea(area, existing)) return { status: 404, error: CHECKLIST_ASSIGNMENT_NOT_FOUND };
  if (area.pointScoped && existing.targetKind === "position") return { status: 403, error: COMPANY_ONLY_API_ERROR };
  return null;
}

/**
 * Список назначений в области: только назначения её точек, а среди
 * получателей — только люди этих точек (у должности есть люди и других).
 */
export function assignmentRowsInArea<T extends AssignmentTarget & { recipients: readonly { id: string }[] }>(
  area: ChecklistPointArea,
  rows: readonly T[],
): T[] {
  if (!area.points) return [...rows];
  return rows
    .filter((row) => assignmentInArea(area, row))
    .map((row) => ({ ...row, recipients: row.recipients.filter((person) => personInArea(area, person.id)) }));
}

/** Кого предложить в форме: точки и люди области; должности — не руководителю точки. */
export function assignmentFormInArea<B extends { id: string }, J, P extends { id: string }>(
  area: ChecklistPointArea,
  form: { buildings: readonly B[]; positions: readonly J[]; people: readonly P[] },
): { buildings: B[]; positions: J[]; people: P[] } {
  const points = area.points;
  return {
    buildings: points ? form.buildings.filter((building) => points.includes(building.id)) : [...form.buildings],
    positions: area.pointScoped ? [] : [...form.positions],
    people: points ? form.people.filter((person) => personInArea(area, person.id)) : [...form.people],
  };
}

/**
 * Проверка по чек-листу в области: по точке её назначения; без назначения
 * и по должности — по точкам автора. Свои проверки и те, где человек
 * проверяющий, видны всегда (их открывают из «Назначено вам» и уведомления).
 */
export function inspectionInArea(
  area: ChecklistPointArea,
  inspection: {
    createdById: string;
    assignment: (AssignmentTarget & { verifierUserId?: string | null }) | null;
  },
  viewerId: string,
): boolean {
  if (!area.points) return true;
  const assignment = inspection.assignment;
  if (inspection.createdById === viewerId || (assignment?.verifierUserId ?? null) === viewerId) return true;
  if (assignment && assignment.targetKind !== "position") return assignmentInArea(area, assignment);
  return personInArea(area, inspection.createdById);
}

/**
 * Посещения проверяющих в области: внесённые в кабинете (без ссылки), по
 * ссылке на всю организацию и по ссылке на точку области. Для `where`
 * `db.inspectionVisit` (занимает верхний `OR`).
 */
export function inspectionVisitAreaWhere(points: readonly string[] | null | undefined) {
  if (!points) return {};
  return {
    OR: [{ tokenId: null }, { token: { buildingId: null } }, { token: { buildingId: { in: [...points] } } }],
  };
}

/** То же для одной записи: точка ссылки, по которой её внесли (без ссылки — общая). */
export function inspectionVisitInArea(
  points: readonly string[] | null | undefined,
  tokenBuildingId: string | null | undefined,
): boolean {
  return !points || !tokenBuildingId || points.includes(tokenBuildingId);
}
