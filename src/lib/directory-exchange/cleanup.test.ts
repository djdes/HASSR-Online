import assert from "node:assert/strict";
import test from "node:test";

import {
  CLOSED_REQUEST_RETENTION_DAYS,
  SKIP_RETENTION_DAYS,
  TRANSFER_RETENTION_DAYS,
  emptyCleanupCounts,
  exchangeCleanupCutoffs,
  isDisposableRequest,
  orphanSkipScopes,
} from "@/lib/directory-exchange/cleanup";

const NOW = new Date("2026-11-21T01:00:00.000Z");
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

test("retention: skips 30 days, closed requests and transfers 180 days", () => {
  assert.equal(SKIP_RETENTION_DAYS, 30);
  assert.equal(CLOSED_REQUEST_RETENTION_DAYS, 180);
  assert.equal(TRANSFER_RETENTION_DAYS, 180);
  const cutoffs = exchangeCleanupCutoffs(NOW);
  assert.equal(cutoffs.skipsSeenBefore.toISOString(), daysAgo(30).toISOString());
  assert.equal(cutoffs.requestsBefore.toISOString(), daysAgo(180).toISOString());
  assert.equal(cutoffs.transfersBefore.toISOString(), daysAgo(180).toISOString());
  assert.deepEqual(emptyCleanupCounts(), { skips: 0, requests: 0, transfers: 0 });
});

test("orphan skips: member gone, list unticked or unknown entity — removed; still exchanging — kept", () => {
  const members = [
    { masterOrganizationId: "m1", organizationId: "a", kinds: ["products", "staff"] },
    { masterOrganizationId: "m1", organizationId: "b", kinds: ["objects", "junk"] },
    { masterOrganizationId: "m2", organizationId: "a", kinds: null },
  ];
  const scopes = [
    { masterOrganizationId: "m1", organizationId: "a", entity: "product" },
    { masterOrganizationId: "m1", organizationId: "a", entity: "position" },
    { masterOrganizationId: "m1", organizationId: "a", entity: "staff" },
    { masterOrganizationId: "m1", organizationId: "a", entity: "equipment" },
    { masterOrganizationId: "m1", organizationId: "b", entity: "room" },
    { masterOrganizationId: "m1", organizationId: "b", entity: "area" },
    { masterOrganizationId: "m1", organizationId: "c", entity: "product" },
    { masterOrganizationId: "m2", organizationId: "a", entity: "product" },
    { masterOrganizationId: "m1", organizationId: "a", entity: "recipe" },
  ];
  assert.deepEqual(
    orphanSkipScopes(scopes, members).map((scope) => `${scope.masterOrganizationId}/${scope.organizationId}/${scope.entity}`),
    ["m1/a/equipment", "m1/b/area", "m1/c/product", "m2/a/product", "m1/a/recipe"],
  );
  assert.deepEqual(orphanSkipScopes([], members), []);
});

test("requests: closed and untouched for 180 days — removed; approved, fresh and open — kept", () => {
  const cutoffs = exchangeCleanupCutoffs(NOW);
  const old = { updatedAt: daysAgo(200), decidedAt: daysAgo(200), expiresAt: daysAgo(193) };
  for (const status of ["declined", "cancelled", "expired", "weird"]) {
    assert.equal(isDisposableRequest({ status, ...old }, cutoffs), true, status);
  }
  assert.equal(isDisposableRequest({ status: "approved", ...old }, cutoffs), false);
  assert.equal(isDisposableRequest({ status: "declined", ...old, updatedAt: daysAgo(10) }, cutoffs), false);
  assert.equal(isDisposableRequest({ status: "declined", ...old, decidedAt: daysAgo(179) }, cutoffs), false);
  assert.equal(isDisposableRequest({ status: "cancelled", ...old, decidedAt: null }, cutoffs), true);
  // Открытый запрос: истёк больше 180 дней назад — «истёк» (лениво не отмечен); иначе остаётся.
  assert.equal(isDisposableRequest({ status: "pending", ...old }, cutoffs), true);
  assert.equal(isDisposableRequest({ status: "pending", ...old, expiresAt: daysAgo(170) }, cutoffs), false);
  assert.equal(isDisposableRequest({ status: "pending", updatedAt: daysAgo(1), decidedAt: null, expiresAt: new Date(NOW.getTime() + 6 * DAY) }, cutoffs), false);
});
