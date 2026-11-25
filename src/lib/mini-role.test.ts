import assert from "node:assert/strict";
import test from "node:test";

import { resolveMiniRole } from "@/lib/mini-role";
import {
  DEFAULT_MANAGEMENT_PERMISSIONS,
  DEFAULT_STAFF_PERMISSIONS,
} from "@/lib/permissions";

test("resolveMiniRole returns readonly fallback for null actor", () => {
  const resolved = resolveMiniRole(null);
  assert.equal(resolved.kind, "readonly");
  assert.equal(resolved.group, "staff");
  assert.equal(resolved.homeHref, "/mini/today");
  assert.deepEqual(
    resolved.quickActions.map((a) => a.href),
    ["/mini/today", "/mini/me"]
  );
});

test("resolveMiniRole resolves manager and owner to manager dashboard with full quick actions", () => {
  for (const role of ["manager", "owner"] as const) {
    const resolved = resolveMiniRole({ role }, DEFAULT_MANAGEMENT_PERMISSIONS);
    assert.equal(resolved.kind, "manager");
    assert.equal(resolved.group, "manager");
    assert.equal(resolved.homeHref, "/dashboard");
    assert.deepEqual(
      resolved.quickActions.map((a) => a.href),
      ["/journals", "/verifications", "/settings/users", "/reports"]
    );
  }
});

test("resolveMiniRole filters manager quick actions by explicit permissions", () => {
  const resolved = resolveMiniRole(
    { role: "manager" },
    ["journals.view", "staff.view"]
  );
  assert.equal(resolved.kind, "manager");
  assert.deepEqual(
    resolved.quickActions.map((a) => a.href),
    ["/journals", "/verifications", "/settings/users"]
  );
});

test("resolveMiniRole resolves head_chef to supervisor on /control-board", () => {
  const withoutPerms = resolveMiniRole({ role: "head_chef" });
  assert.equal(withoutPerms.kind, "supervisor");
  assert.equal(withoutPerms.group, "manager");
  assert.equal(withoutPerms.homeHref, "/control-board");
  assert.deepEqual(
    withoutPerms.quickActions.map((a) => a.href),
    ["/control-board", "/verifications", "/team"]
  );

  // Even when server passes management permissions, head_chef preset hides /journals.
  const withMgmtPerms = resolveMiniRole(
    { role: "head_chef" },
    DEFAULT_MANAGEMENT_PERMISSIONS
  );
  assert.equal(withMgmtPerms.kind, "supervisor");
  assert.equal(withMgmtPerms.group, "manager");
  assert.equal(withMgmtPerms.homeHref, "/control-board");
});

test("resolveMiniRole resolves control_group to manager group without staff-only tasks", () => {
  const withStaffPerms = resolveMiniRole(
    { role: "cook", permissionPreset: "control_group" },
    DEFAULT_STAFF_PERMISSIONS
  );
  assert.equal(withStaffPerms.kind, "supervisor");
  assert.equal(withStaffPerms.group, "manager");
  assert.equal(withStaffPerms.homeHref, "/journals");
  assert.deepEqual(
    withStaffPerms.quickActions.map((a) => a.href),
    ["/control-board", "/verifications"]
  );

  const withoutPerms = resolveMiniRole({
    role: "cook",
    permissionPreset: "control_group",
  });
  assert.equal(withoutPerms.group, "manager");
  assert.equal(withoutPerms.homeHref, "/journals");
});

test("resolveMiniRole resolves cook and waiter to staff without manager routes", () => {
  const managerOnlyRoutes = new Set([
    "/verifications",
    "/settings/users",
    "/reports",
    "/control-board",
  ]);

  for (const role of ["cook", "waiter"] as const) {
    const resolved = resolveMiniRole({ role }, DEFAULT_STAFF_PERMISSIONS);
    assert.equal(resolved.kind, "staff");
    assert.equal(resolved.group, "staff");
    assert.equal(resolved.homeHref, "/mini/today");
    assert.deepEqual(
      resolved.quickActions.map((a) => a.href),
      ["/mini/today", "/mini/me"]
    );
    for (const action of resolved.quickActions) {
      assert.equal(managerOnlyRoutes.has(action.href), false);
    }
  }
});

test("resolveMiniRole resolves cook with admin preset to manager", () => {
  const resolved = resolveMiniRole({ role: "cook", permissionPreset: "admin" });
  assert.equal(resolved.kind, "manager");
  assert.equal(resolved.group, "manager");
  assert.equal(resolved.homeHref, "/journals");
  assert.deepEqual(
    resolved.quickActions.map((a) => a.href),
    ["/journals", "/verifications", "/settings/users", "/reports"]
  );
});

test("resolveMiniRole resolves readonly user without journals.fill", () => {
  const readonlyNoJournals = resolveMiniRole({ role: "cook" }, ["dashboard.view"]);
  assert.equal(readonlyNoJournals.kind, "readonly");
  assert.equal(readonlyNoJournals.group, "staff");
  assert.deepEqual(
    readonlyNoJournals.quickActions.map((a) => a.href),
    ["/mini/today", "/mini/me"]
  );

  const readonlyWithJournals = resolveMiniRole(
    {
      role: "cook",
      orgPresetOverrides: { cook: ["journals.view"] },
    },
    ["journals.view"]
  );
  assert.equal(readonlyWithJournals.kind, "readonly");
  assert.equal(readonlyWithJournals.group, "staff");
  assert.deepEqual(
    readonlyWithJournals.quickActions.map((a) => a.href),
    ["/journals", "/mini/me"]
  );
});
