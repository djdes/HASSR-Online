import assert from "node:assert/strict";
import test from "node:test";

import {
  NETWORK_ORG_LIMIT,
  buildNetworkRows,
  formatNetworkDay,
  formatNetworkRub,
  hasUnfilledJournals,
  isNetworkOwner,
  isNetworkViewer,
  journalDayStatus,
  latestByOrganization,
  networkPlanOf,
  networkTotals,
  networkTrialCell,
} from "./network-summary";

const at = (iso: string) => new Date(iso);

test("журналы за сегодня: статус по «сделано / всего», как на главной", () => {
  assert.equal(journalDayStatus({ done: 5, total: 5 }), "done");
  assert.equal(journalDayStatus({ done: 2, total: 5 }), "partial");
  assert.equal(journalDayStatus({ done: 0, total: 5 }), "none");
  assert.equal(journalDayStatus({ done: 0, total: 0 }), "empty");
  assert.equal(journalDayStatus(null), "unknown");
  assert.equal(hasUnfilledJournals({ done: 2, total: 5 }), true);
  assert.equal(hasUnfilledJournals({ done: 5, total: 5 }), false);
  // Журналов нет или посчитать не удалось — «незаполненной» организацию не считаем.
  assert.equal(hasUnfilledJournals({ done: 0, total: 0 }), false);
  assert.equal(hasUnfilledJournals(null), false);
});

test("свои 14 дней: в силе по последнему дню, закрыта или нет отметки", () => {
  const ends = at("2026-11-23T21:00:00.000Z"); // полночь 24 ноября по Москве
  const trial = networkTrialCell({ status: "trial", trialEndsAt: ends });
  assert.equal(trial.state, "trial");
  assert.equal(trial.state === "trial" ? trial.lastDay.toISOString() : null, "2026-11-23T20:59:59.999Z");
  assert.equal(formatNetworkDay(trial.state === "trial" ? trial.lastDay : ends, "ru"), "23 ноября");
  assert.deepEqual(networkTrialCell({ status: "locked", trialEndsAt: ends }), { state: "locked" });
  assert.deepEqual(networkTrialCell(null), { state: "none" });
});

test("тариф аккаунта одной строкой", () => {
  const base = { planPoints: 3, trialEndsAt: null };
  assert.deepEqual(networkPlanOf({ ...base, kind: "paid", paidTier: "standard" }), { kind: "paid", tier: "standard", points: 3 });
  assert.deepEqual(networkPlanOf({ ...base, kind: "paid", paidTier: "legacy" }), { kind: "legacy" });
  assert.deepEqual(networkPlanOf({ ...base, kind: "free", paidTier: null }), { kind: "free" });
  assert.deepEqual(networkPlanOf({ ...base, kind: "needs_decision", paidTier: null }), { kind: "free" });
  assert.deepEqual(networkPlanOf({ ...base, kind: "exempt", paidTier: null }), { kind: "none" });
  assert.deepEqual(networkPlanOf(null), { kind: "none" });
  const trial = networkPlanOf({ ...base, kind: "free_period", paidTier: null, trialEndsAt: at("2026-12-01T21:00:00.000Z") });
  assert.equal(trial.kind, "trial");
  assert.equal(trial.kind === "trial" ? trial.lastDay?.toISOString() : null, "2026-12-01T20:59:59.999Z");
});

test("строки и итоги: суммы, текущая, обмен — самый поздний по кабинетам", () => {
  const rows = buildNetworkRows({
    activeOrgId: "b",
    orgs: [
      { id: "a", name: "Первая", balanceRub: 5000, deletionRequested: false },
      { id: "b", name: "Вторая", balanceRub: 1200, deletionRequested: false },
      { id: "c", name: "Третья", balanceRub: 0, deletionRequested: true },
    ],
    journals: new Map([
      ["a", { done: 4, total: 4 }],
      ["b", { done: 1, total: 4 }],
      ["c", null],
    ]),
    trials: [
      { organizationId: "b", status: "trial", trialEndsAt: at("2026-11-23T21:00:00.000Z") },
      { organizationId: "c", status: "locked", trialEndsAt: at("2026-11-01T21:00:00.000Z") },
    ],
    exchanges: [
      { organizationId: "a", lastSyncedAt: at("2026-11-19T10:00:00.000Z") },
      { organizationId: "a", lastSyncedAt: at("2026-11-20T08:30:00.000Z") },
      { organizationId: "b", lastSyncedAt: null },
    ],
  });
  assert.deepEqual(rows.map((row) => [row.id, row.current, row.journalStatus, row.trial.state]), [
    ["a", false, "done", "none"],
    ["b", true, "partial", "trial"],
    ["c", false, "unknown", "locked"],
  ]);
  assert.equal(rows[0].lastExchangeAt?.toISOString(), "2026-11-20T08:30:00.000Z");
  assert.equal(rows[1].lastExchangeAt, null);
  assert.equal(rows[2].deletionRequested, true);
  assert.deepEqual(networkTotals(rows), { organizations: 3, balanceRub: 6200, withUnfilled: 1 });
  assert.equal(latestByOrganization([]).size, 0);
});

test("пункт меню «Сеть»: владелец аккаунта, две организации и больше, полный доступ без «войти как» и точки", () => {
  assert.equal(isNetworkOwner({ userId: "u", ownerUserId: "u", organizations: 2 }), true);
  assert.equal(isNetworkOwner({ userId: "u", ownerUserId: "u", organizations: 1 }), false);
  assert.equal(isNetworkOwner({ userId: "u", ownerUserId: "other", organizations: 3 }), false);
  assert.equal(isNetworkOwner({ userId: "u", ownerUserId: null, organizations: 3 }), false);
  assert.equal(isNetworkViewer({ fullAccess: true, impersonating: false, pointScoped: false }), true);
  assert.equal(isNetworkViewer({ fullAccess: false, impersonating: false, pointScoped: false }), false);
  assert.equal(isNetworkViewer({ fullAccess: true, impersonating: true, pointScoped: false }), false);
  assert.equal(isNetworkViewer({ fullAccess: true, impersonating: false, pointScoped: true }), false);
  assert.ok(NETWORK_ORG_LIMIT >= 2);
});

test("суммы — с неразрывным пробелом и ₽ на каждом языке", () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const text = formatNetworkRub(12345, locale);
    assert.ok(text.endsWith(" ₽"), text);
    assert.ok(text.replace(/\D/g, "") === "12345", text);
  }
});
