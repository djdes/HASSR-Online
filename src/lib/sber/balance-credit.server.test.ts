import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Exercise the actual server workflow with isolated database and delivery ports.
// No production database, mail or Telegram connection is opened by these tests.
const source = ts.transpileModule(
  readFileSync(path.join(process.cwd(), "src/lib/sber/balance-credit.server.ts"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

function fixture(contact: { email: string; userId: string | null } | null, failSettlement = false) {
  const bank = new Map<string, Record<string, unknown>>();
  const orders: Array<Record<string, unknown>> = [];
  let balance = 0;
  const db = {
    paymentOrder: {
      findFirst: async () => contact,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const order = { ...data, id: orders.length + 1 };
        orders.push(order);
        return order;
      },
    },
    user: { findFirst: async () => null },
    organization: { findMany: async () => [{ id: "org-a", name: "Cafe" }] },
    sberIncomingPayment: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const id = String(data.operationId);
        if (bank.has(id)) throw Object.assign(new Error("Duplicate operation"), { code: "P2002" });
        bank.set(id, { ...data });
      },
      update: async ({ where, data }: { where: { operationId: string }; data: Record<string, unknown> }) => {
        Object.assign(bank.get(where.operationId)!, data);
      },
    },
  };
  const ports: Record<string, unknown> = {
    "@/lib/db": { db },
    "@/lib/balance/constants": { formatPoints: (value: number) => String(value) },
    "@/lib/balance/topup-core": { TOPUP_TARIFF_KEY: "balance_topup" },
    "@/lib/invoices/service": {
      markInvoicePaid: async (id: number) => {
        if (failSettlement) return { ok: false, error: "Settlement unavailable" };
        const order = orders.find((row) => row.id === id)!;
        assert.equal(order.status, "pending");
        order.status = "paid";
        balance += Number(order.amountRub);
        return { ok: true };
      },
    },
    "@/lib/platform-admin": { notifyPlatformAdmin: async () => undefined },
    "@/lib/telegram": { escapeTelegramHtml: (value: string) => value },
    "./scanflow-shared": { digitsOnly: (value: unknown) => String(value ?? "").replace(/\D/g, "") },
  };
  const exports: Record<string, (...args: unknown[]) => Promise<string>> = {};
  vm.runInNewContext(source, {
    exports,
    require: (name: string) => {
      assert.ok(name in ports, `Unexpected dependency: ${name}`);
      return ports[name];
    },
    process: { env: {} },
    console: { info: () => undefined, error: () => undefined },
  });
  return { apply: exports.applyStatementCredit, bank, orders, balance: () => balance };
}

const payment = {
  operationId: "bank-op-1", date: "2026-11-13T09:00:00", amountRub: 5000,
  payerInn: "7701234567", payerName: "Cafe", direction: "CREDIT", purpose: "WeSetup access",
};
const decision = { kind: "credit", organizationId: "org-a", amount: 5000, orderId: null };

test("bank payment credits the organization without any billing email", async () => {
  const f = fixture(null);
  assert.equal(await f.apply(payment, decision, null), "credited");
  assert.equal(f.balance(), 5000);
  assert.equal(f.orders.length, 1);
  assert.equal(f.orders[0].email, "");
  assert.equal(f.orders[0].userId, null);
  assert.equal(f.orders[0].tariffKey, "balance_topup");
  assert.equal(f.bank.get(payment.operationId)?.status, "credited");
  assert.equal(f.bank.get(payment.operationId)?.orderId, f.orders[0].id);
});

test("bank payment preserves the existing billing recipient", async () => {
  const f = fixture({ email: "billing@example.test", userId: "manager" });
  assert.equal(await f.apply(payment, decision, null), "credited");
  assert.equal(f.orders[0].email, "billing@example.test");
  assert.equal(f.orders[0].userId, "manager");
  assert.equal(f.balance(), 5000);
});

test("concurrent imports without an email settle the operation only once", async () => {
  const f = fixture(null);
  const results = await Promise.allSettled([f.apply(payment, decision, null), f.apply(payment, decision, null)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(f.orders.length, 1);
  assert.equal(f.balance(), 5000);
});

test("failed settlement is recorded without claiming a balance credit", async () => {
  const f = fixture(null, true);
  assert.equal(await f.apply(payment, decision, null), "failed");
  assert.equal(f.balance(), 0);
  assert.equal(f.bank.get(payment.operationId)?.status, "failed");
  assert.equal(f.bank.get(payment.operationId)?.note, "Settlement unavailable");
});

test("ambiguous INN and already-paid invoices do not add money", async () => {
  for (const d of [{ kind: "ambiguous", organizationIds: ["org-a", "org-b"] }, { kind: "already-paid", orderId: 42 }]) {
    const f = fixture(null);
    await f.apply(payment, d, null);
    assert.equal(f.orders.length, 0);
    assert.equal(f.balance(), 0);
  }
});
