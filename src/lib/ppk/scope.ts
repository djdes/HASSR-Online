/**
 * ППК на точку (владелец 2026-11-01: «ппк на точку»).
 *
 * У каждой торговой точки свой «Производственный контроль»: записи блоков
 * (группа ХАССП, продукты, опасности, ККТ, схемы, лаборатория, политика…),
 * загруженные «ППК» / «ХАССП-план» и файлы папок. Уровень организации
 * (офис, «Вся организация», организации без журналов по точкам) ведёт свой
 * ППК — как раньше, `buildingId = null`.
 *
 * Уникальные индексы БД прежние (выкладка — только добавление полей):
 * одиночный блок точки пишет в `singleton` значение `<block>@<buildingId>`,
 * загруженный документ точки — `kind = <kind>@<buildingId>`.
 *
 * Модуль без БД и Next — проверяют unit-тесты.
 */
import { isPointScoped, type PointScopeActor } from "@/lib/point-scope";

export type PpkScope = {
  organizationId: string;
  /** Торговая точка; null — уровень организации. */
  buildingId: string | null;
};

/** `where` записей и документов ППК этой области (точка или организация). */
export function ppkWhere(scope: PpkScope): { organizationId: string; buildingId: string | null } {
  return { organizationId: scope.organizationId, buildingId: scope.buildingId };
}

/** Значение `PpkRecord.singleton` одиночного блока области. */
export function ppkSingletonKey(block: string, buildingId: string | null): string {
  return buildingId ? `${block}@${buildingId}` : block;
}

export type PpkDocKind = "ppk" | "haccp_plan";

/** `KnowledgeDocument.kind` загруженного «ППК» / «ХАССП-плана» области. */
export function ppkDocKindKey(kind: PpkDocKind, buildingId: string | null): string {
  return buildingId ? `${kind}@${buildingId}` : kind;
}

/** Вид документа по ключу из БД: `ppk@<точка>` → `ppk`; не ППК — null. */
export function ppkDocKindOf(key: string | null | undefined): PpkDocKind | null {
  const kind = (key ?? "").split("@")[0];
  return kind === "ppk" || kind === "haccp_plan" ? kind : null;
}

/** Ключи обоих загруженных документов области — для `kind: { in: [...] }`. */
export function ppkDocKindKeys(buildingId: string | null): string[] {
  return [ppkDocKindKey("ppk", buildingId), ppkDocKindKey("haccp_plan", buildingId)];
}

/**
 * Копия данных записи для точки: строки, равные id скопированных записей
 * (ККТ → опасность и т.п.), заменяются id копий. Id записей — cuid, с
 * обычным текстом не совпадают.
 */
export function remapPpkIds<T>(value: T, ids: ReadonlyMap<string, string>): T {
  if (typeof value === "string") return (ids.get(value) ?? value) as T;
  if (Array.isArray(value)) return value.map((item) => remapPpkIds(item, ids)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, remapPpkIds(item, ids)]),
    ) as T;
  }
  return value;
}

/** Руководитель точки — только ППК своих точек; остальным — любая область. */
export function ppkScopeAllowed(session: { user: PointScopeActor }, scope: PpkScope): boolean {
  if (!isPointScoped(session.user)) return true;
  return Boolean(scope.buildingId) && (session.user.pointScope ?? []).includes(scope.buildingId!);
}
