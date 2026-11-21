import assert from "node:assert/strict";
import test from "node:test";

import {
  NETWORK_MANAGERS_MAX,
  canManageNetworkRole,
  decideAppointment,
  hasAccountFullAccess,
  isAccountOwnerRole,
  resolveAccountRole,
  type AccountAccessFacts,
} from "./account-roles";

const facts = (patch: Partial<AccountAccessFacts> = {}): AccountAccessFacts => ({
  isActive: true,
  archivedAt: null,
  isRoot: false,
  homeInAccount: true,
  homeManagement: true,
  homePointScoped: false,
  accountMemberships: 0,
  ...patch,
});

test("полный доступ в аккаунте: руководитель всей компании дома или участник организации", () => {
  assert.equal(hasAccountFullAccess(facts()), true);
  // Член организации аккаунта (домашняя — чужая компания) — тоже руководство.
  assert.equal(hasAccountFullAccess(facts({ homeInAccount: false, accountMemberships: 1 })), true);
  // Руководитель точки дома — не вся компания; но членство в другой организации аккаунта — да.
  assert.equal(hasAccountFullAccess(facts({ homePointScoped: true })), false);
  assert.equal(hasAccountFullAccess(facts({ homePointScoped: true, accountMemberships: 2 })), true);
  // Сотрудник без руководства и без членств, чужая домашняя организация.
  assert.equal(hasAccountFullAccess(facts({ homeManagement: false })), false);
  assert.equal(hasAccountFullAccess(facts({ homeInAccount: false })), false);
});

test("уволенный, в архиве и администратор платформы прав не имеют", () => {
  assert.equal(hasAccountFullAccess(facts({ isActive: false, accountMemberships: 3 })), false);
  assert.equal(hasAccountFullAccess(facts({ archivedAt: new Date("2026-11-20T00:00:00Z") })), false);
  assert.equal(hasAccountFullAccess(facts({ isRoot: true })), false);
});

test("роль: владелец всегда владелец, управляющий — пока назначен и с полным доступом", () => {
  assert.equal(resolveAccountRole({ userId: "o", ownerUserId: "o", appointed: false, fullAccess: false }), "owner");
  assert.equal(resolveAccountRole({ userId: "m", ownerUserId: "o", appointed: true, fullAccess: true }), "network_manager");
  // Сняли — прав нет; потерял полный доступ — тоже нет, хоть строка и осталась.
  assert.equal(resolveAccountRole({ userId: "m", ownerUserId: "o", appointed: false, fullAccess: true }), null);
  assert.equal(resolveAccountRole({ userId: "m", ownerUserId: "o", appointed: true, fullAccess: false }), null);
  assert.equal(resolveAccountRole({ userId: "m", ownerUserId: null, appointed: false, fullAccess: true }), null);
});

test("права: сеть — владельцу и управляющему; назначение, запросы, тариф — только владельцу", () => {
  assert.equal(canManageNetworkRole("owner"), true);
  assert.equal(canManageNetworkRole("network_manager"), true);
  assert.equal(canManageNetworkRole(null), false);
  assert.equal(isAccountOwnerRole("owner"), true);
  assert.equal(isAccountOwnerRole("network_manager"), false);
  assert.equal(isAccountOwnerRole(undefined), false);
});

test("назначение: только кандидат, не владелец, не повторно и не сверх предела", () => {
  const eligibleIds = new Set(["a", "b"]);
  assert.deepEqual(decideAppointment({ userId: "a", ownerUserId: "o", appointedIds: new Set(), eligibleIds }), { ok: true });
  assert.deepEqual(decideAppointment({ userId: "o", ownerUserId: "o", appointedIds: new Set(), eligibleIds: new Set(["o"]) }), {
    ok: false,
    reason: "owner",
  });
  assert.deepEqual(decideAppointment({ userId: "a", ownerUserId: "o", appointedIds: new Set(["a"]), eligibleIds }), {
    ok: false,
    reason: "already",
  });
  assert.deepEqual(decideAppointment({ userId: "x", ownerUserId: "o", appointedIds: new Set(), eligibleIds }), {
    ok: false,
    reason: "not_eligible",
  });
  const full = new Set(Array.from({ length: NETWORK_MANAGERS_MAX }, (_, index) => `m${index}`));
  assert.deepEqual(decideAppointment({ userId: "a", ownerUserId: "o", appointedIds: full, eligibleIds }), { ok: false, reason: "limit" });
});
