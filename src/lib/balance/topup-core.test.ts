import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TOPUP_TARIFF_KEY,
  creditTopupOrder,
  isTopupOrder,
  settleOrderPayment,
  topupCreditDedupeKey,
  topupLedgerDescription,
  topupOrderDescription,
  type SettleStore,
  type SettleTx,
  type TopupOrderSnapshot,
} from "@/lib/balance/topup-core";

/**
 * Зачисление пополнения — то, что делают ResultURL кассы (`/payment`) и
 * ROOT «Оплата поступила» по счёту: settleOrderPayment → pending → paid
 * и строка леджера `topup:<orderId>` одной транзакцией. Здесь хранилище в
 * памяти с откатом транзакции, как у Postgres.
 */

type Order = TopupOrderSnapshot & { paidAt: Date | null; rawResult: unknown };
type LedgerRow = {
  organizationId: string;
  amount: number;
  description: string;
  dedupeKey: string;
  paymentOrderId: number;
  actorUserId: string | null;
};

function order(partial: Partial<Order> & { id: number }): Order {
  return {
    tariffKey: TOPUP_TARIFF_KEY,
    status: "pending",
    amountRub: "5000.00",
    organizationId: "org-1",
    userId: "user-1",
    isTest: false,
    paymentMethod: "card",
    paidAt: null,
    rawResult: null,
    ...partial,
  };
}

function memoryDb(initial: Order[]) {
  let orders = initial.map((o) => ({ ...o }));
  let ledger: LedgerRow[] = [];
  let balances = new Map<string, number>();
  const faults = { failCredit: 0 };

  const tx: SettleTx = {
    async claimPending({ orderId, paymentMethod, paidAt, rawResult }) {
      const row = orders.find((o) => o.id === orderId);
      if (!row || row.status !== "pending") return false;
      if (paymentMethod && row.paymentMethod !== paymentMethod) return false;
      row.status = "paid";
      row.paidAt = paidAt;
      row.rawResult = rawResult;
      return true;
    },
    async findOrder(orderId) {
      const row = orders.find((o) => o.id === orderId);
      return row ? { ...row } : null;
    },
    async hasCredit(dedupeKey) {
      return ledger.some((row) => row.dedupeKey === dedupeKey);
    },
    async credit(entry) {
      if (faults.failCredit > 0) {
        faults.failCredit -= 1;
        throw new Error("connection reset");
      }
      // unique dedupeKey — как в БД.
      if (ledger.some((row) => row.dedupeKey === entry.dedupeKey)) throw new Error("P2002");
      balances.set(entry.organizationId, (balances.get(entry.organizationId) ?? 0) + entry.amount);
      ledger.push({ ...entry });
    },
  };

  const store: SettleStore = {
    async transaction(fn) {
      const snapshot = {
        orders: orders.map((o) => ({ ...o })),
        ledger: ledger.map((r) => ({ ...r })),
        balances: new Map(balances),
      };
      try {
        return await fn(tx);
      } catch (error) {
        orders = snapshot.orders;
        ledger = snapshot.ledger;
        balances = snapshot.balances;
        throw error;
      }
    },
  };

  return {
    store,
    tx,
    faults,
    balance: (organizationId = "org-1") => balances.get(organizationId) ?? 0,
    ledger: () => ledger,
    order: (id: number) => orders.find((o) => o.id === id)!,
  };
}

describe("пополнение: зачисление после подтверждённой оплаты", () => {
  it("касса подтвердила — заказ оплачен, баланс вырос на сумму заказа, строка «Пополнение»", async () => {
    const db = memoryDb([order({ id: 7 })]);
    const result = await settleOrderPayment(db.store, { orderId: 7, rawResult: { OutSum: "5000.00" } });
    assert.equal(result.claimed, true);
    assert.deepEqual(result.topup, { status: "credited", organizationId: "org-1", amountRub: 5000 });
    assert.equal(db.order(7).status, "paid");
    assert.equal(db.balance(), 5000);
    assert.equal(db.ledger().length, 1);
    assert.equal(db.ledger()[0].dedupeKey, "topup:7");
    assert.equal(db.ledger()[0].paymentOrderId, 7);
    assert.equal(db.ledger()[0].description, "Пополнение баланса картой, заказ №7");
  });

  it("повторное уведомление кассы — без второго зачисления", async () => {
    const db = memoryDb([order({ id: 7 })]);
    await settleOrderPayment(db.store, { orderId: 7, rawResult: {} });
    const again = await settleOrderPayment(db.store, { orderId: 7, rawResult: {} });
    assert.equal(again.claimed, false);
    assert.equal(again.topup, null);
    assert.equal(db.balance(), 5000);
    assert.equal(db.ledger().length, 1);
  });

  it("два уведомления одновременно — одно зачисление", async () => {
    const db = memoryDb([order({ id: 8, amountRub: "1990.00" })]);
    const results = await Promise.all([
      settleOrderPayment(db.store, { orderId: 8, rawResult: { n: 1 } }),
      settleOrderPayment(db.store, { orderId: 8, rawResult: { n: 2 } }),
    ]);
    assert.equal(results.filter((r) => r.claimed).length, 1);
    assert.equal(db.balance(), 1990);
    assert.equal(db.ledger().length, 1);
  });

  it("повторный вызов зачисления по уже оплаченному заказу — no-op", async () => {
    const db = memoryDb([order({ id: 9 })]);
    await settleOrderPayment(db.store, { orderId: 9, rawResult: {} });
    const paid = { ...db.order(9) };
    const second = await db.store.transaction((tx) => creditTopupOrder(tx, paid));
    assert.deepEqual(second, { status: "already", organizationId: "org-1", amountRub: 5000 });
    assert.equal(db.balance(), 5000);
    assert.equal(db.ledger().length, 1);
  });

  it("сбой записи в леджер откатывает и оплату: касса повторит — зачислится один раз", async () => {
    const db = memoryDb([order({ id: 10 })]);
    db.faults.failCredit = 1;
    await assert.rejects(settleOrderPayment(db.store, { orderId: 10, rawResult: {} }), /connection reset/);
    assert.equal(db.order(10).status, "pending");
    assert.equal(db.balance(), 0);
    const retry = await settleOrderPayment(db.store, { orderId: 10, rawResult: {} });
    assert.equal(retry.claimed, true);
    assert.equal(retry.topup?.status, "credited");
    assert.equal(db.balance(), 5000);
    assert.equal(db.ledger().length, 1);
  });

  it("«Оплата поступила» по счёту: зачисляет один раз, повтор — no-op; карточный заказ так не подтвердить", async () => {
    const db = memoryDb([
      order({ id: 11, paymentMethod: "invoice", amountRub: "10000.00" }),
      order({ id: 12, paymentMethod: "card" }),
    ]);
    const first = await settleOrderPayment(db.store, {
      orderId: 11,
      paymentMethod: "invoice",
      rawResult: { manual: true },
      actorUserId: "root-1",
    });
    assert.equal(first.topup?.status, "credited");
    assert.equal(db.ledger()[0].actorUserId, "root-1");
    assert.equal(db.ledger()[0].description, "Пополнение баланса по счёту, заказ №11");
    const second = await settleOrderPayment(db.store, { orderId: 11, paymentMethod: "invoice", rawResult: {} });
    assert.equal(second.claimed, false);
    const wrong = await settleOrderPayment(db.store, { orderId: 12, paymentMethod: "invoice", rawResult: {} });
    assert.equal(wrong.claimed, false);
    assert.equal(db.order(12).status, "pending");
    assert.equal(db.balance(), 10000);
  });

  it("сумма зачисления — из заказа в БД, не из уведомления и не от клиента", async () => {
    const db = memoryDb([order({ id: 13, amountRub: "5000.00" })]);
    const result = await settleOrderPayment(db.store, {
      orderId: 13,
      rawResult: { OutSum: "300000.00", amountRub: 300000 },
    });
    assert.equal(result.topup?.status === "credited" && result.topup.amountRub, 5000);
    assert.equal(db.balance(), 5000);
  });

  it("оплата подписки — заказ оплачен, баланс не трогаем", async () => {
    const db = memoryDb([order({ id: 14, tariffKey: "monthly", amountRub: "1990.00" })]);
    const result = await settleOrderPayment(db.store, { orderId: 14, rawResult: {} });
    assert.equal(result.claimed, true);
    assert.equal(result.topup, null);
    assert.equal(db.order(14).status, "paid");
    assert.equal(db.balance(), 0);
    assert.equal(db.ledger().length, 0);
  });

  it("тестовый платёж зачисляется с пометкой в истории", async () => {
    const db = memoryDb([order({ id: 15, isTest: true })]);
    await settleOrderPayment(db.store, { orderId: 15, rawResult: {} });
    assert.equal(db.ledger()[0].description, "Пополнение баланса картой, заказ №15 (тестовый платёж)");
  });

  it("без организации, с копейками или неоплаченный — не зачисляем молча", async () => {
    const db = memoryDb([]);
    const noOrg = await creditTopupOrder(db.tx, order({ id: 16, status: "paid", organizationId: null }));
    assert.deepEqual(noOrg, { status: "skipped", reason: "no-organization" });
    const cents = await creditTopupOrder(db.tx, order({ id: 17, status: "paid", amountRub: "1990.50" }));
    assert.deepEqual(cents, { status: "skipped", reason: "bad-amount" });
    const pending = await creditTopupOrder(db.tx, order({ id: 18, status: "pending" }));
    assert.deepEqual(pending, { status: "skipped", reason: "not-paid" });
    const subscription = await creditTopupOrder(db.tx, order({ id: 19, status: "paid", tariffKey: "monthly" }));
    assert.deepEqual(subscription, { status: "skipped", reason: "not-topup" });
    assert.equal(db.ledger().length, 0);
  });
});

describe("пополнение: вид заказа и подписи", () => {
  it("пополнение отличается от подписки по tariffKey", () => {
    assert.equal(isTopupOrder({ tariffKey: "balance_topup" }), true);
    assert.equal(isTopupOrder({ tariffKey: "monthly" }), false);
    assert.equal(isTopupOrder({ tariffKey: "bundle" }), false);
    assert.equal(isTopupOrder(null), false);
  });

  it("ключ идемпотентности и описания", () => {
    assert.equal(topupCreditDedupeKey(42), "topup:42");
    assert.equal(topupOrderDescription(5000, "card"), "Пополнение баланса на 5 000 ₽");
    assert.equal(topupOrderDescription(300000, "invoice"), "Пополнение баланса на 300 000 ₽ (счёт)");
    assert.equal(
      topupLedgerDescription({ id: 3, paymentMethod: "invoice", isTest: false }),
      "Пополнение баланса по счёту, заказ №3",
    );
  });
});
