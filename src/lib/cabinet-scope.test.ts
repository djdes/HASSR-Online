import assert from "node:assert/strict";
import test from "node:test";
import { cabinetScopeKeys } from "./cabinet-scope";

const points = { enabled: true, activeBuildingId: "p1", organizationView: false };

test("another organization changes both keys", () => {
  const a = cabinetScopeKeys({ userId: "u1", organizationId: "org-a", points });
  const b = cabinetScopeKeys({ userId: "u1", organizationId: "org-b", points });
  assert.notEqual(a.organization, b.organization);
  assert.notEqual(a.data, b.data);
});

test("another person in the same organization changes both keys", () => {
  const a = cabinetScopeKeys({ userId: "u1", organizationId: "org-a", points });
  const b = cabinetScopeKeys({ userId: "u2", organizationId: "org-a", points });
  assert.notEqual(a.organization, b.organization);
  assert.notEqual(a.data, b.data);
});

test("another point keeps the shell and changes the page", () => {
  const p1 = cabinetScopeKeys({ userId: "u1", organizationId: "org-a", points });
  const p2 = cabinetScopeKeys({ userId: "u1", organizationId: "org-a", points: { ...points, activeBuildingId: "p2" } });
  assert.equal(p1.organization, p2.organization);
  assert.notEqual(p1.data, p2.data);
});

test("«Вся организация» on the same point is another page scope", () => {
  const point = cabinetScopeKeys({ userId: "u1", organizationId: "org-a", points });
  const whole = cabinetScopeKeys({ userId: "u1", organizationId: "org-a", points: { ...points, organizationView: true } });
  assert.equal(point.organization, whole.organization);
  assert.notEqual(point.data, whole.data);
});

test("without journals by point the page follows the organization only", () => {
  const off = { enabled: false, activeBuildingId: null, organizationView: true };
  const a = cabinetScopeKeys({ userId: "u1", organizationId: "org-a", points: off });
  assert.equal(a.data, a.organization);
  assert.deepEqual(cabinetScopeKeys({ userId: "u1", organizationId: "org-a", points: null }), a);
});

test("no session yet — a stable anonymous scope", () => {
  const anonymous = cabinetScopeKeys(null);
  assert.deepEqual(anonymous, cabinetScopeKeys(null));
  assert.notEqual(anonymous.organization, cabinetScopeKeys({ userId: "u1", organizationId: "org-a", points: null }).organization);
});
