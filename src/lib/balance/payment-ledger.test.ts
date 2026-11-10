import assert from "node:assert/strict";
import test from "node:test";

import {
  passThroughEntries,
  paymentInDedupeKey,
  paymentOutDedupeKey,
  recordPassThrough,
  type PassThroughEntry,
  type PassThroughOrder,
} from "./payment-ledger";

const paid: PassThroughOrder = {
  id: 501,
  tariffKey: "standard_month",
  status: "paid",
  amountRub: "1990.00",
  organizationId: "org-a",
  paymentMethod: "card",
  description: "Тариф «Стандарт» на месяц, 1 точка",
  isTest: false,
  heldAt: null,
  refundedAt: null,
};

function memoryLedger() {
  const rows: PassThroughEntry[] = [];
  let balance = 0;
  return {
    rows,
    balance: () => balance,
    ledger: {
      has: async (key: string) => rows.some((row) => row.dedupeKey === key),
      apply: async (entry: PassThroughEntry) => {
        if (balance + entry.amount < 0) throw new Error("balance below zero");
        balance += entry.amount;
        rows.push(entry);
      },
    },
  };
}

test("оплата тарифа картой — «+N пополнение» и «−N оплата тарифа», баланс не меняется", async () => {
  const entries = passThroughEntries(paid);
  assert.ok(entries.ok);
  assert.equal(entries.credit.amount, 1990);
  assert.equal(entries.credit.kind, "topup");
  assert.equal(entries.credit.dedupeKey, paymentInDedupeKey(501));
  assert.match(entries.credit.description, /Пополнение картой, заказ №501/);
  assert.equal(entries.debit.amount, -1990);
  assert.equal(entries.debit.kind, "subscription_charge");
  assert.equal(entries.debit.dedupeKey, paymentOutDedupeKey(501));
  assert.match(entries.debit.description, /^Оплата тарифа: Тариф «Стандарт» на месяц, 1 точка, заказ №501$/);

  const memory = memoryLedger();
  const first = await recordPassThrough(memory.ledger, paid);
  assert.deepEqual(first, { status: "recorded", amount: 1990, organizationId: "org-a" });
  assert.deepEqual(memory.rows.map((row) => row.amount), [1990, -1990], "сначала кредит, потом дебет");
  assert.equal(memory.balance(), 0);

  // Повтор (ROOT «Применено», второй вызов) — ничего не пишет.
  const again = await recordPassThrough(memory.ledger, paid);
  assert.equal(again.status, "already");
  assert.equal(memory.rows.length, 2);
});

test("по счёту — «Пополнение по счёту»; тестовый платёж помечен", () => {
  const entries = passThroughEntries({ ...paid, paymentMethod: "invoice", isTest: true });
  assert.ok(entries.ok);
  assert.equal(entries.credit.description, "Пополнение по счёту, заказ №501 (тестовый платёж)");
});

test("строк нет: пополнение баланса, не оплачен, на разборе, возвращён, без организации, без денег", () => {
  const cases: Array<[Partial<PassThroughOrder>, string]> = [
    [{ tariffKey: "balance_topup" }, "topup-order"],
    [{ status: "pending" }, "not-paid"],
    [{ heldAt: new Date() }, "held"],
    [{ refundedAt: new Date() }, "refunded"],
    [{ organizationId: null }, "no-organization"],
    // Заказ целиком оплачен баллами: деньги не приходили — списание уже строкой order_spend.
    [{ amountRub: 0 }, "no-money"],
  ];
  for (const [patch, reason] of cases) {
    const entries = passThroughEntries({ ...paid, ...patch });
    assert.deepEqual(entries, { ok: false, reason }, reason);
  }
});

test("частично записанная пара дописывается без дубля", async () => {
  const memory = memoryLedger();
  const entries = passThroughEntries(paid);
  assert.ok(entries.ok);
  await memory.ledger.apply(entries.credit);
  const result = await recordPassThrough(memory.ledger, paid);
  assert.equal(result.status, "recorded");
  assert.deepEqual(memory.rows.map((row) => row.dedupeKey), [paymentInDedupeKey(501), paymentOutDedupeKey(501)]);
  assert.equal(memory.balance(), 0);
});

test("детализация: кредит и дебет отдельно, остаток после каждой операции, итоги", async () => {
  const { balanceDetail } = await import("./constants");
  // От новых к старым, текущий баланс 600: −1990 тариф, +1990 карта, +500 бонус, +100 бонус.
  const rows = [
    { id: "4", amount: -1990 },
    { id: "3", amount: 1990 },
    { id: "2", amount: 500 },
    { id: "1", amount: 100 },
  ];
  const detail = balanceDetail(rows, 600);
  assert.deepEqual(
    detail.rows.map((row) => [row.credit, row.debit, row.after]),
    [
      [0, 1990, 600],
      [1990, 0, 2590],
      [500, 0, 600],
      [100, 0, 100],
    ],
  );
  assert.equal(detail.creditTotal, 2590);
  assert.equal(detail.debitTotal, 1990);
  assert.deepEqual(balanceDetail([], 0), { rows: [], creditTotal: 0, debitTotal: 0 });
});
