import assert from "node:assert/strict";
import test from "node:test";

import {
  canAccessWebPath,
  getBotMiniAppLabel,
  getWebHomeHref,
  hasFullWorkspaceAccess,
} from "@/lib/role-access";

test("hasFullWorkspaceAccess treats management and root as full-access users", () => {
  assert.equal(hasFullWorkspaceAccess({ role: "manager", isRoot: false }), true);
  assert.equal(
    hasFullWorkspaceAccess({ role: "head_chef", isRoot: false }),
    true
  );
  assert.equal(hasFullWorkspaceAccess({ role: "cook", isRoot: false }), false);
  assert.equal(hasFullWorkspaceAccess({ role: "waiter", isRoot: false }), false);
  assert.equal(hasFullWorkspaceAccess({ role: "cook", isRoot: true }), true);
});

test("staff web access is limited to journals", () => {
  const staff = { role: "cook", isRoot: false };

  assert.equal(canAccessWebPath(staff, "/journals"), true);
  assert.equal(canAccessWebPath(staff, "/journals/hygiene"), true);
  assert.equal(canAccessWebPath(staff, "/settings"), false);
  assert.equal(canAccessWebPath(staff, "/settings/users"), false);
  // Исключение: страница баллов — сотрудник оставляет там отзыв.
  assert.equal(canAccessWebPath(staff, "/settings/balance"), true);
  assert.equal(canAccessWebPath(staff, "/dashboard"), false);
  assert.equal(canAccessWebPath(staff, "/reports"), false);
  assert.equal(getWebHomeHref(staff), "/journals");
});

test("bot CTA copy and mini app root follow the same home rule", () => {
  const staff = { role: "waiter", isRoot: false };
  const manager = { role: "manager", isRoot: false };

  assert.equal(getBotMiniAppLabel(staff), "Открыть журналы");
  assert.equal(getWebHomeHref(staff), "/journals");

  assert.equal(getBotMiniAppLabel(manager), "Открыть кабинет");
  assert.equal(getWebHomeHref(manager), "/dashboard");
});
