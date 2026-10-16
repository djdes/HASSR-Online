import assert from "node:assert/strict";
import test from "node:test";
import type { Session } from "next-auth";
import { keyAdminGuard } from "./key-admin-guard";

function session(user: Record<string, unknown>): Session {
  return { expires: "2099-01-01", user: { id: "u1", name: "Анна", organizationId: "org1", role: "manager", isRoot: false, ...user } } as unknown as Session;
}

test("руководитель → ok с организацией и владельцем", () => {
  assert.deepEqual(keyAdminGuard(session({})), { ok: true, orgId: "org1", user: { id: "u1", name: "Анна" } });
});

test("руководитель в другой своей организации → ключ выпускается в активной", () => {
  const res = keyAdminGuard(session({ activeOrganizationId: "org2" }));
  assert.equal(res.ok ? res.orgId : null, "org2");
});

test("повар → 403", () => {
  assert.equal(keyAdminGuard(session({ role: "cook" })).ok, false);
});

test("ROOT в режиме «войти как» → 403", () => {
  const res = keyAdminGuard(session({ isRoot: true, role: "manager", actingAsOrganizationId: "org9" }));
  assert.deepEqual(res, { ok: false, status: 403, error: "Ключ выпускает сам руководитель организации" });
});

test("партнёр в кабинете клиента → 403", () => {
  const res = keyAdminGuard(session({ partnerAccess: { partnerId: "p1", organizationId: "org1", level: "edit" } }));
  assert.deepEqual(res, { ok: false, status: 403, error: "Партнёр не выпускает ключи клиента" });
});
