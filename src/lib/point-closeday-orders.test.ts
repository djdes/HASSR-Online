import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CLOSE_DAY_POINT_REQUIRED, closeDayNeedsPoint } from "@/lib/close-day-point";
import { evaluatePointScopeRequest } from "@/lib/point-scope";

/**
 * Решения владельца 2026-11-01: «Закрыть день» на уровне организации просит
 * выбрать точку; приказы и закрывающие документы (УПД) — только руководству
 * компании.
 */
const read = (path: string) => readFileSync(path, "utf8");

test("«Закрыть день»: в режиме точек на уровне организации нужна точка", () => {
  assert.equal(closeDayNeedsPoint({ enabled: true, organizationView: true }), true);
  assert.equal(closeDayNeedsPoint({ enabled: true, organizationView: false }), false);
  // Точки выключены — день закрывается организации, как раньше.
  assert.equal(closeDayNeedsPoint({ enabled: false, organizationView: true }), false);
  assert.match(CLOSE_DAY_POINT_REQUIRED, /Выберите точку в шапке/);
});

test("«Закрыть день»: сервер отказывает до заполнения, главная показывает подсказку", () => {
  const route = read("src/app/api/dashboard/close-day/route.ts");
  const guard = route.indexOf("closeDayNeedsPoint(buildingContext)");
  assert.ok(guard > 0, "нет проверки точки");
  assert.ok(guard < route.indexOf("db.journalTemplate.findMany"), "проверка точки должна стоять до работы с журналами");
  assert.match(route, /CLOSE_DAY_POINT_REQUIRED \}, \{ status: 400 \}/);
  assert.doesNotMatch(route, /getActiveBuildingId/);
  assert.match(read("src/app/(dashboard)/dashboard/page.tsx"), /closeDayNeedsPoint\(await loadBuildingContext\(session\)\)/);
  assert.match(read("src/components/dashboard/close-day-card.tsx"), /pointRequired \? toast\.info\(t\("pointRequired"\)\) : setConfirming\(true\)/);
});

test("приказы и УПД: страница и изменения закрыты руководителю точки в proxy", () => {
  const scope = ["point-a"];
  assert.deepEqual(evaluatePointScopeRequest({ method: "GET", pathname: "/orders", pointScope: scope }), { action: "redirect", location: "/dashboard" });
  assert.deepEqual(evaluatePointScopeRequest({ method: "GET", pathname: "/orders/haccp-responsible", pointScope: scope }), { action: "redirect", location: "/dashboard" });
  for (const pathname of ["/api/orders", "/api/closing-documents/12/refresh-buyer"]) {
    assert.equal(evaluatePointScopeRequest({ method: "POST", pathname, pointScope: scope }).action, "deny", pathname);
    assert.equal(evaluatePointScopeRequest({ method: "POST", pathname, pointScope: null }).action, "allow", pathname);
  }
  assert.equal(evaluatePointScopeRequest({ method: "GET", pathname: "/orders", pointScope: null }).action, "allow");
});

test("приказы и УПД: чтение закрыто в самих маршрутах", () => {
  assert.match(read("src/app/api/orders/route.ts"), /if \(isPointScoped\(auth\.session\.user\)\)/);
  assert.match(read("src/app/api/orders/[code]/pdf/route.ts"), /if \(session && isPointScoped\(session\.user\)\)/);
  for (const path of ["src/app/api/closing-documents/[orderId]/pdf/route.ts", "src/app/api/closing-documents/[orderId]/refresh-buyer/route.ts"]) {
    assert.match(read(path), /hasFullWorkspaceAccess\(session\.user\) &&[\s\S]{0,120}!isPointScoped\(session\.user\)/, path);
  }
  assert.match(read("src/app/(dashboard)/orders/[code]/page.tsx"), /if \(isPointScoped\(session\.user\)\) redirect\("\/dashboard"\)/);
});
