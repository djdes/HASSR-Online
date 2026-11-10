import assert from "node:assert/strict";
import test from "node:test";

import { hrefAfterPointSwitch, isCompanyWidePath, pointPageId, pointSyncAction, type PointSyncState } from "@/lib/point-section-sync";

const base: PointSyncState = {
  pathname: "/dashboard",
  viewedPointId: "p1",
  canViewOrganization: true,
  organizationTargetId: "office",
  pointIds: ["p1", "p2"],
};

test("разделы всей компании: реквизиты, офис, подписки, оформление, список точек, «Все журналы»", () => {
  for (const path of [
    "/settings/organization",
    "/settings/organization/office",
    "/settings/master-cabinet",
    "/settings/subscription",
    "/settings/appearance",
    "/settings/buildings",
    "/settings/buildings/",
    "/journals",
    "/journals/points",
  ]) {
    assert.ok(isCompanyWidePath(path), path);
  }
  for (const path of ["/home", "/dashboard", "/journals/hygiene", "/settings/buildings/p1", "/settings/qr-posters", "/monitoring", "/verifications"]) {
    assert.ok(!isCompanyWidePath(path), path);
  }
});

test("страница точки: id из адреса, мастер новой точки — не точка", () => {
  assert.equal(pointPageId("/settings/buildings/p1"), "p1");
  assert.equal(pointPageId("/settings/buildings/p1/?tab=x"), "p1");
  assert.equal(pointPageId("/settings/buildings/new"), null);
  assert.equal(pointPageId("/settings/buildings"), null);
  assert.equal(pointPageId("/settings/buildings/p1/rooms"), null);
});

test("раздел всей компании при выбранной точке — переключить на офис", () => {
  assert.deepEqual(pointSyncAction({ ...base, pathname: "/settings/subscription" }), { kind: "organization", targetId: "office" });
  assert.deepEqual(pointSyncAction({ ...base, pathname: "/journals" }), { kind: "organization", targetId: "office" });
  // Уже офис, главная или страница точки — ничего.
  assert.equal(pointSyncAction({ ...base, pathname: "/settings/subscription", viewedPointId: null }), null);
  assert.equal(pointSyncAction({ ...base, pathname: "/home" }), null);
  assert.equal(pointSyncAction({ ...base, pathname: "/dashboard" }), null);
});

test("руководителю точки и сотрудникам ничего само не переключается на офис", () => {
  assert.equal(pointSyncAction({ ...base, pathname: "/settings/buildings", canViewOrganization: false }), null);
  assert.equal(pointSyncAction({ ...base, pathname: "/settings/buildings", organizationTargetId: null }), null);
});

test("страница точки — в шапке эта точка; чужая или недоступная — без смены", () => {
  assert.deepEqual(pointSyncAction({ ...base, pathname: "/settings/buildings/p2" }), { kind: "point", targetId: "p2" });
  assert.deepEqual(pointSyncAction({ ...base, pathname: "/settings/buildings/p2", viewedPointId: null }), { kind: "point", targetId: "p2" });
  assert.deepEqual(
    pointSyncAction({ ...base, pathname: "/settings/buildings/p2", canViewOrganization: false }),
    { kind: "point", targetId: "p2" },
  );
  assert.equal(pointSyncAction({ ...base, pathname: "/settings/buildings/p1" }), null);
  assert.equal(pointSyncAction({ ...base, pathname: "/settings/buildings/other" }), null);
});

test("выбор точки ведёт в её раздел; офис на странице точки — в список точек", () => {
  const point = { id: "p2", office: false };
  const office = { id: "office", office: true };
  for (const pathname of ["/home", "/settings/organization", "/settings/subscription", "/settings/buildings", "/journals", "/settings/buildings/p1"]) {
    assert.equal(hrefAfterPointSwitch({ pathname, target: point, canManagePoints: true }), "/settings/buildings/p2", pathname);
    assert.equal(hrefAfterPointSwitch({ pathname, target: point, canManagePoints: false }), "/dashboard", pathname);
  }
  // Страница работает для любой точки — остаёмся на ней.
  for (const pathname of ["/dashboard", "/journals/hygiene", "/settings/qr-posters", "/settings/buildings/p2"]) {
    assert.equal(hrefAfterPointSwitch({ pathname, target: point, canManagePoints: true }), null, pathname);
  }
  assert.equal(hrefAfterPointSwitch({ pathname: "/settings/buildings/p1", target: office, canManagePoints: true }), "/settings/buildings");
  assert.equal(hrefAfterPointSwitch({ pathname: "/settings/buildings/p1", target: office, canManagePoints: false }), "/dashboard");
  for (const pathname of ["/home", "/dashboard", "/settings/subscription"]) {
    assert.equal(hrefAfterPointSwitch({ pathname, target: office, canManagePoints: true }), null, pathname);
  }
});

test("после автосмены правило успокаивается: петли нет", () => {
  // Раздел компании → офис выбран → больше ничего.
  const afterOrg = { ...base, pathname: "/settings/buildings", viewedPointId: null };
  assert.equal(pointSyncAction(afterOrg), null);
  // Страница точки → точка выбрана → больше ничего.
  assert.equal(pointSyncAction({ ...base, pathname: "/settings/buildings/p2", viewedPointId: "p2" }), null);
});
