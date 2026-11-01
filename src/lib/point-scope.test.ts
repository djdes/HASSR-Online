import assert from "node:assert/strict";
import test from "node:test";
import { statSync } from "node:fs";
import { join } from "node:path";

import {
  COMPANY_ONLY_PAGE_PREFIXES,
  buildingInScope,
  evaluatePointScopeRequest,
  isCompanyOnlyPath,
  isPointScoped,
  mergeScopedBuildingIds,
  parsePointScope,
  staffInScope,
  staffScopeWhere,
} from "./point-scope";

const pointManager = { pointScope: ["p1", "p2"] };
const office = { pointScope: null };

test("руководитель точки — только с непустым списком точек", () => {
  assert.equal(isPointScoped(pointManager), true);
  assert.equal(isPointScoped(office), false);
  assert.equal(isPointScoped({ pointScope: [] }), false);
  assert.equal(isPointScoped(null), false);
  assert.deepEqual(parsePointScope(["p1", "", 3]), ["p1"]);
  assert.equal(parsePointScope("p1"), null);
  assert.equal(parsePointScope([]), null);
});

test("proxy: общие страницы → «Сегодня», изменения их API → 403", () => {
  const verdict = (method: string, pathname: string, pointScope: unknown = ["p1"]) =>
    evaluatePointScopeRequest({ method, pathname, pointScope }).action;
  assert.equal(verdict("GET", "/settings/organization"), "redirect");
  assert.equal(verdict("GET", "/settings/organization/office"), "redirect");
  assert.equal(verdict("GET", "/settings/subscription/"), "redirect");
  assert.equal(verdict("GET", "/settings/buildings/new"), "redirect");
  // Своя точка, журналы, набор журналов точки — открыты.
  assert.equal(verdict("GET", "/settings/buildings/p1"), "allow");
  assert.equal(verdict("GET", "/settings/buildings"), "allow");
  assert.equal(verdict("GET", "/settings/journals"), "allow");
  assert.equal(verdict("GET", "/settings/auto-journals"), "allow");
  assert.equal(verdict("GET", "/dashboard"), "allow");
  // «Названия» не путаем с похожими адресами.
  assert.equal(verdict("GET", "/settings/onboarding-template"), "redirect");
  assert.equal(verdict("GET", "/settings/organizations-x"), "allow");
  // API: читать можно, менять общее — нет.
  assert.equal(verdict("PATCH", "/api/settings/organization"), "deny");
  assert.equal(verdict("POST", "/api/settings/office"), "deny");
  assert.equal(verdict("GET", "/api/settings/organization"), "allow");
  assert.equal(verdict("POST", "/api/staff"), "allow");
  // Ответственные за журналы (2026-10-31): страница и сохранение журнала
  // открыты (маршрут сам пускает только к своей точке), общие действия — нет.
  assert.equal(verdict("GET", "/settings/journal-responsibles"), "allow");
  assert.equal(verdict("PUT", "/api/settings/journal-responsibles/hygiene"), "allow");
  assert.equal(verdict("DELETE", "/api/settings/journal-responsibles/hygiene"), "allow");
  assert.equal(verdict("POST", "/api/settings/journal-responsibles/resync-all"), "deny");
  assert.equal(verdict("POST", "/api/settings/journal-responsibles/apply-presets"), "deny");
  assert.equal(verdict("POST", "/api/settings/journal-responsibles/recreate-documents"), "deny");
  assert.equal(verdict("POST", "/api/settings/journal-responsibles/backfill-verifiers"), "deny");
  // Подключения, права, удаление всех документов — офису (2026-11-01).
  assert.equal(verdict("PUT", "/api/organizations/permissions"), "deny");
  assert.equal(verdict("POST", "/api/settings/journals/delete-all-documents"), "deny");
  assert.equal(verdict("PUT", "/api/settings/supply/iiko/stores"), "deny");
  assert.equal(verdict("PUT", "/api/settings/hr1c/departments"), "deny");
  // Ссылка проверяющего — на точку (2026-11-01): выпуск открыт, своя точка проверяется в маршруте.
  assert.equal(verdict("POST", "/api/settings/inspector-tokens"), "allow");
  assert.equal(verdict("DELETE", "/api/settings/inspector-tokens"), "allow");
  assert.equal(verdict("PATCH", "/api/integrations/mercury"), "deny");
  assert.equal(verdict("PATCH", "/api/max/organization"), "deny");
  assert.equal(verdict("POST", "/api/products/import"), "deny");
  assert.equal(verdict("POST", "/api/onboarding/apply"), "deny");
  // TasksFlow: подключение и общие чистки — офису, задачи точки — открыты.
  assert.equal(verdict("POST", "/api/integrations/tasksflow"), "deny");
  assert.equal(verdict("DELETE", "/api/integrations/tasksflow"), "deny");
  assert.equal(verdict("POST", "/api/integrations/tasksflow/cleanup-completed"), "deny");
  assert.equal(verdict("POST", "/api/integrations/tasksflow/sync-users"), "deny");
  assert.equal(verdict("POST", "/api/integrations/tasksflow/bulk-assign-today"), "allow");
  assert.equal(verdict("POST", "/api/integrations/tasksflow/sync-room-photo-policy"), "allow");
  assert.equal(verdict("GET", "/api/integrations/tasksflow"), "allow");
  // Должность заводят при добавлении сотрудника, правят и удаляют — офис.
  assert.equal(verdict("POST", "/api/positions"), "allow");
  assert.equal(verdict("PATCH", "/api/positions/pos1"), "deny");
  assert.equal(verdict("DELETE", "/api/positions/pos1"), "deny");
  assert.equal(verdict("PUT", "/api/positions/order"), "deny");
  assert.equal(verdict("GET", "/api/positions"), "allow");
  // Офис и организации без офиса — без ограничений.
  assert.equal(verdict("GET", "/settings/organization", null), "allow");
  assert.equal(verdict("DELETE", "/api/positions/pos1", null), "allow");
  assert.equal(verdict("PATCH", "/api/settings/organization", []), "allow");
});

test("каждый общий адрес — существующий раздел кабинета", () => {
  const dashboard = join(process.cwd(), "src", "app", "(dashboard)");
  for (const prefix of COMPANY_ONLY_PAGE_PREFIXES) {
    const dir = join(dashboard, ...prefix.split("/").filter(Boolean));
    assert.ok(statSync(dir, { throwIfNoEntry: false })?.isDirectory(), prefix);
    assert.equal(isCompanyOnlyPath(prefix), true, prefix);
  }
});

test("сотрудники и точки в пределах руководителя точки", () => {
  assert.equal(buildingInScope(pointManager, "p1"), true);
  assert.equal(buildingInScope(pointManager, "p3"), false);
  assert.equal(buildingInScope(pointManager, null), false);
  assert.equal(buildingInScope(office, "p3"), true);
  assert.equal(staffInScope(pointManager, ["p2", "p9"]), true);
  assert.equal(staffInScope(pointManager, ["p9"]), false);
  // Без места — дело офиса.
  assert.equal(staffInScope(pointManager, []), false);
  assert.equal(staffInScope(office, []), true);
  assert.deepEqual(staffScopeWhere(pointManager), { buildingIds: { hasSome: ["p1", "p2"] } });
  assert.deepEqual(staffScopeWhere(office), {});
});

test("места сотрудника: чужие точки не трогаем, пусто — точки руководителя", () => {
  // Новый сотрудник без выбора — на точки руководителя.
  assert.deepEqual(mergeScopedBuildingIds(pointManager, [], []), ["p1", "p2"]);
  // Чужую точку и офис руководитель точки не назначит.
  assert.deepEqual(mergeScopedBuildingIds(pointManager, [], ["p1", "office", "p9"]), ["p1"]);
  // Человек работает ещё на p9: правка своих точек её сохраняет.
  assert.deepEqual(mergeScopedBuildingIds(pointManager, ["p9", "p1"], ["p2"]), ["p9", "p2"]);
  assert.deepEqual(mergeScopedBuildingIds(pointManager, ["p9", "p1"], []), ["p9"]);
  // Офис — как прислали.
  assert.deepEqual(mergeScopedBuildingIds(office, ["p9"], ["office"]), ["office"]);
});
