/**
 * Точки сотрудников из 1С:ЗУП (2026-10-31): подразделение 1С → торговая
 * точка WeSetup. Раньше принятые из 1С получали «все точки» и были видны в
 * журналах, списках и QR каждой точки.
 *
 * Правила (чистые, без БД):
 *  - руководитель сопоставляет подразделение с точкой или «все точки»;
 *  - принятый из 1С получает точки по подразделению;
 *  - у связанного сотрудника точки меняем, только если их ставила 1С (они
 *    совпадают с последними, что поставила 1С) или они пустые и 1С их ещё
 *    не ставила; точки, заданные руководителем вручную, не трогаем;
 *  - подразделение без сопоставления — «проблема» с подсказкой, точки не
 *    трогаем; уволенные — без изменений.
 */
import { isDismissed, normalizeName, type HrEmployee } from "./plan";

/** «Все точки» в карте сопоставления. */
export const ALL_POINTS = "*";

export type HrDepartment = { key: string; name: string; count: number };
/** Подразделение → id точки или `ALL_POINTS`. */
export type DepartmentPointMap = Record<string, string>;

/** Ключ подразделения: id из 1С, иначе нормализованное название. */
export function departmentKey(employee: Pick<HrEmployee, "departmentId" | "departmentName">): string | null {
  const id = employee.departmentId?.trim();
  if (id && id !== "00000000-0000-0000-0000-000000000000") return id;
  const name = employee.departmentName?.trim();
  return name ? `name:${normalizeName(name)}` : null;
}

/** Подразделения работающих сотрудников — для экрана сопоставления. */
export function collectDepartments(employees: readonly HrEmployee[], today: string): HrDepartment[] {
  const byKey = new Map<string, HrDepartment>();
  for (const employee of employees) {
    if (isDismissed(employee, today)) continue;
    const key = departmentKey(employee);
    if (!key) continue;
    const current = byKey.get(key);
    const name = employee.departmentName?.trim() || current?.name || key;
    byKey.set(key, { key, name, count: (current?.count ?? 0) + 1 });
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

/** Подразделения из JSON подключения (`departmentsJson`). */
export function readDepartments(raw: unknown): HrDepartment[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (typeof record.key !== "string" || !record.key) return [];
    const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : record.key;
    const count = typeof record.count === "number" && Number.isFinite(record.count) ? record.count : 0;
    return [{ key: record.key, name, count }];
  });
}

/** Карта из JSON подключения: только строки, только живые точки или «все точки». */
export function readDepartmentPointMap(raw: unknown, livePointIds: ReadonlySet<string>): DepartmentPointMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: DepartmentPointMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string" && (value === ALL_POINTS || livePointIds.has(value))) out[key] = value;
  }
  return out;
}

/** Точки по подразделению; undefined — не сопоставлено (или нет подразделения). */
export function pointsForEmployee(employee: HrEmployee, map: DepartmentPointMap): string[] | undefined {
  const key = departmentKey(employee);
  const value = key ? map[key] : undefined;
  if (value === undefined) return undefined;
  return value === ALL_POINTS ? [] : [value];
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

export type HrPointUpdate = { externalId: string; userId: string; buildingIds: string[]; changed: boolean; fullName?: string };
export type HrPointProblem = { employee: HrEmployee; departmentName: string };

/**
 * Что сделать с точками связанных сотрудников (принятых — см. `pointsForEmployee`).
 * `changed: false` — точки уже верные, только запомнить, что их ставит 1С.
 */
export function planHrPoints(input: {
  employees: readonly HrEmployee[];
  /** Сотрудник 1С → сотрудник WeSetup (связи и связанные в этом прогоне). */
  userByExternal: ReadonlyMap<string, string>;
  users: ReadonlyMap<string, { buildingIds: readonly string[]; working: boolean }>;
  /** Что 1С поставила в прошлый раз; нет записи — 1С точки ещё не ставила. */
  setBy1c: ReadonlyMap<string, readonly string[]>;
  map: DepartmentPointMap;
  livePointIds: ReadonlySet<string>;
  today: string;
}): { updates: HrPointUpdate[]; problems: HrPointProblem[] } {
  const updates: HrPointUpdate[] = [];
  const problems: HrPointProblem[] = [];
  const seen = new Set<string>();
  for (const employee of input.employees) {
    if (seen.has(employee.externalId) || isDismissed(employee, input.today)) continue;
    seen.add(employee.externalId);
    const userId = input.userByExternal.get(employee.externalId);
    const user = userId ? input.users.get(userId) : undefined;
    if (!userId || !user || !user.working || !departmentKey(employee)) continue;
    const live = user.buildingIds.filter((id) => input.livePointIds.has(id));
    const previous = input.setBy1c.get(employee.externalId);
    const managedBy1c = previous ? sameSet(live, previous.filter((id) => input.livePointIds.has(id))) : live.length === 0;
    if (!managedBy1c) continue;
    const target = pointsForEmployee(employee, input.map);
    if (target === undefined) {
      problems.push({ employee, departmentName: employee.departmentName?.trim() || departmentKey(employee) || "" });
      continue;
    }
    const changed = !sameSet(live, target);
    if (changed || !previous) updates.push({ externalId: employee.externalId, userId, buildingIds: target, changed });
  }
  return { updates, problems };
}
