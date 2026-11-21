import assert from "node:assert/strict";
import test from "node:test";

import {
  accountPayChargeKey,
  accountPayReminderLine,
  accountPayTransferKey,
  isAccountPayKey,
  planAccountCollection,
  showAccountCollect,
  type AccountPaySource,
} from "./account-pay";
import { isTransferIdempotencyKey } from "./account-transfer";

const KEY = "3f1c2a9e-1b7d-4c55-9a0e-8f6d2b1c0a77";

const sum = (transfers: ReadonlyArray<{ amountRub: number }>) => transfers.reduce((total, row) => total + row.amountRub, 0);

test("plan: the missing amount exactly, largest balances first, never more than a balance", () => {
  const sources: AccountPaySource[] = [
    { id: "b", name: "Бар", balanceRub: 1000 },
    { id: "c", name: "Столовая", balanceRub: 4000 },
    { id: "d", name: "Кофейня", balanceRub: 2500 },
  ];
  const plan = planAccountCollection({ missingRub: 5500, sources });
  assert.ok(plan.ok);
  assert.deepEqual(plan.transfers, [
    { orgId: "c", name: "Столовая", amountRub: 4000 },
    { orgId: "d", name: "Кофейня", amountRub: 1500 },
  ]);
  assert.equal(sum(plan.transfers), 5500);
  for (const transfer of plan.transfers) {
    assert.ok(transfer.amountRub <= sources.find((source) => source.id === transfer.orgId)!.balanceRub);
  }
});

test("plan: one source is enough — a single transfer from the largest", () => {
  const plan = planAccountCollection({
    missingRub: 300,
    sources: [
      { id: "x", name: "X", balanceRub: 500 },
      { id: "y", name: "Y", balanceRub: 900 },
    ],
  });
  assert.ok(plan.ok);
  assert.deepEqual(plan.transfers, [{ orgId: "y", name: "Y", amountRub: 300 }]);
});

test("plan: deterministic order — ties broken by id, not by the order of rows", () => {
  const rows: AccountPaySource[] = [
    { id: "org-b", name: "B", balanceRub: 700 },
    { id: "org-a", name: "A", balanceRub: 700 },
    { id: "org-c", name: "C", balanceRub: 700 },
  ];
  const forward = planAccountCollection({ missingRub: 1000, sources: rows });
  const backward = planAccountCollection({ missingRub: 1000, sources: [...rows].reverse() });
  assert.deepEqual(forward, backward);
  assert.ok(forward.ok);
  assert.deepEqual(
    forward.transfers.map((row) => [row.orgId, row.amountRub]),
    [
      ["org-a", 700],
      ["org-b", 300],
    ],
  );
});

test("plan: the account is short — refused with how much is missing, nothing planned", () => {
  const plan = planAccountCollection({
    missingRub: 5000,
    sources: [
      { id: "a", name: "A", balanceRub: 1000 },
      { id: "b", name: "B", balanceRub: 1500 },
    ],
  });
  assert.deepEqual(plan, { ok: false, missingRub: 5000, availableRub: 2500, shortRub: 2500 });
});

test("plan: zero, negative, fractional and duplicate balances are not overdrawn", () => {
  const plan = planAccountCollection({
    missingRub: 1000,
    sources: [
      { id: "zero", name: "Z", balanceRub: 0 },
      { id: "minus", name: "M", balanceRub: -500 },
      { id: "nan", name: "N", balanceRub: Number.NaN },
      { id: "frac", name: "F", balanceRub: 600.9 },
      { id: "frac", name: "F again", balanceRub: 600.9 },
      { id: "rest", name: "R", balanceRub: 400 },
    ],
  });
  assert.ok(plan.ok);
  assert.deepEqual(plan.transfers, [
    { orgId: "frac", name: "F", amountRub: 600 },
    { orgId: "rest", name: "R", amountRub: 400 },
  ]);
  const short = planAccountCollection({ missingRub: 1001, sources: [{ id: "frac", name: "F", balanceRub: 600.9 }, { id: "rest", name: "R", balanceRub: 400 }] });
  assert.equal(short.ok, false);
});

test("plan: nothing missing — no transfers", () => {
  assert.deepEqual(planAccountCollection({ missingRub: 0, sources: [{ id: "a", name: "A", balanceRub: 10 }] }), {
    ok: true,
    missingRub: 0,
    transfers: [],
  });
  assert.deepEqual(planAccountCollection({ missingRub: -5, sources: [] }), { ok: true, missingRub: 0, transfers: [] });
  // Копейки недостающего округляются вверх: иначе оплате не хватит рубля.
  const plan = planAccountCollection({ missingRub: 99.2, sources: [{ id: "a", name: "A", balanceRub: 500 }] });
  assert.ok(plan.ok);
  assert.equal(plan.transfers[0].amountRub, 100);
});

test("keys: payment key alphabet; transfer keys are stable, per source, and valid transfer keys", () => {
  assert.equal(isAccountPayKey(KEY), true);
  assert.equal(isAccountPayKey("lq3k9x-ab12cd34ef"), true);
  assert.equal(isAccountPayKey("short"), false);
  assert.equal(isAccountPayKey("has_underscore_123"), false);
  assert.equal(isAccountPayKey("x".repeat(49)), false);
  assert.equal(isAccountPayKey(42), false);

  assert.equal(accountPayChargeKey("acc1", KEY), `account_pay:acc1:${KEY}`);

  const a = accountPayTransferKey(KEY, "cmh1a2b3c4d5e6f7g8h9i0j1k");
  assert.equal(a, accountPayTransferKey(KEY, "cmh1a2b3c4d5e6f7g8h9i0j1k"));
  assert.notEqual(a, accountPayTransferKey(KEY, "cmh1a2b3c4d5e6f7g8h9i0j1z"));
  assert.notEqual(a, accountPayTransferKey("another-key-1234", "cmh1a2b3c4d5e6f7g8h9i0j1k"));
  // Необычные символы id: читаемая часть совпадает, отпечаток — нет.
  assert.notEqual(accountPayTransferKey(KEY, "demo-org-1"), accountPayTransferKey(KEY, "demoorg1"));
  for (const source of ["cmh1a2b3c4d5e6f7g8h9i0j1k", "platform", "demo-org-1", "ид организации", "x".repeat(200)]) {
    const key = accountPayTransferKey("k".repeat(48), source);
    assert.ok(isTransferIdempotencyKey(key), key);
  }
});

test("reminder line: only when the account covers the point", () => {
  const line = accountPayReminderLine({ priceRub: 1990, accountTotalRub: 1990 });
  assert.equal(line, "На балансах организаций аккаунта хватает денег — точку можно оплатить с баланса в один шаг.");
  assert.equal(accountPayReminderLine({ priceRub: 1990, accountTotalRub: 1989 }), null);
  assert.equal(accountPayReminderLine({ priceRub: null, accountTotalRub: 100_000 }), null);
  assert.equal(accountPayReminderLine({ priceRub: 0, accountTotalRub: 100_000 }), null);
  assert.equal(accountPayReminderLine({ priceRub: Number.NaN, accountTotalRub: 100_000 }), null);
});

test("button: shown only when the active organization is short and the account is not", () => {
  assert.equal(showAccountCollect({ payRub: 6000, activeBalanceRub: 1000, accountTotalRub: 7000 }), true);
  assert.equal(showAccountCollect({ payRub: 6000, activeBalanceRub: 1000, accountTotalRub: 6000 }), true);
  // Активной хватает — обычная оплата с баланса, кнопки сбора нет.
  assert.equal(showAccountCollect({ payRub: 6000, activeBalanceRub: 6000, accountTotalRub: 9000 }), false);
  // По аккаунту не хватает — только прежние способы оплаты.
  assert.equal(showAccountCollect({ payRub: 6000, activeBalanceRub: 1000, accountTotalRub: 5999 }), false);
  assert.equal(showAccountCollect({ payRub: 0, activeBalanceRub: 0, accountTotalRub: 100 }), false);
});
