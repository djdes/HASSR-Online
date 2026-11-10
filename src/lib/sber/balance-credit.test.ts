import assert from "node:assert/strict";
import test from "node:test";

import { creditAmountRub, decideStatementCredit, type PayerOrganization } from "@/lib/sber/balance-credit";

const orgs: PayerOrganization[] = [
  { id: "cafe", name: "Кафе", inn: "7701234567", hasPaidOrders: false },
  { id: "dup-a", name: "Солянка", inn: "9701290368", hasPaidOrders: true },
  { id: "dup-b", name: "Солянка (2)", inn: " 9701290368 ", hasPaidOrders: false },
  { id: "twin-a", name: "Аквамарин", inn: "2460204198", hasPaidOrders: false },
  { id: "twin-b", name: "Аквамарин", inn: "2460204198", hasPaidOrders: false },
];
const ctx = { ownInn: "5018215599", organizations: orgs, recentPaidInvoices: [] };

test("платёж без счёта от ИНН клиента — на его баланс, копейки отбрасываем", () => {
  const d = decideStatementCredit({ date: "2026-11-10", amountRub: 5000.4, payerInn: "7701234567", reviewInvoice: null }, ctx);
  assert.deepEqual(d, { kind: "credit", organizationId: "cafe", amount: 5000, orderId: null });
});

test("похож на наш счёт, сумма не та — зачисляем и связываем со счётом этой организации", () => {
  const d = decideStatementCredit({ date: "2026-11-10", amountRub: 2500, payerInn: "7701234567", reviewInvoice: { id: 1287, organizationId: "cafe" } }, ctx);
  assert.deepEqual(d, { kind: "credit", organizationId: "cafe", amount: 2500, orderId: 1287 });
  const guest = decideStatementCredit({ date: "2026-11-10", amountRub: 2500, payerInn: "7701234567", reviewInvoice: { id: 1300, organizationId: null } }, ctx);
  assert.equal(guest.kind === "credit" && guest.orderId, null);
});

test("наш ИНН, банк (эквайринг) и чужие плательщики — не зачисляем", () => {
  assert.deepEqual(decideStatementCredit({ date: "2026-11-10", amountRub: 100, payerInn: "5018215599", reviewInvoice: null }, ctx), { kind: "skip", reason: "own" });
  assert.deepEqual(decideStatementCredit({ date: "2026-11-10", amountRub: 100, payerInn: "7707083893", reviewInvoice: null }, ctx), { kind: "skip", reason: "bank" });
  assert.deepEqual(decideStatementCredit({ date: "2026-11-10", amountRub: 100, payerInn: "1111111111", reviewInvoice: null }, ctx), { kind: "skip", reason: "no-organization" });
  assert.deepEqual(decideStatementCredit({ date: "2026-11-10", amountRub: 100, payerInn: null, reviewInvoice: null }, ctx), { kind: "skip", reason: "no-inn" });
});

test("ту же сумму недавно отметили оплатой счёта вручную — второй раз не зачисляем", () => {
  const d = decideStatementCredit(
    { date: "2026-11-10", amountRub: 3000, payerInn: "7701234567", reviewInvoice: null },
    { ...ctx, recentPaidInvoices: [{ id: 1250, amountRub: 3000, buyerInn: "7701234567" }] },
  );
  assert.deepEqual(d, { kind: "already-paid", orderId: 1250 });
  const other = decideStatementCredit(
    { date: "2026-11-10", amountRub: 4000, payerInn: "7701234567", reviewInvoice: null },
    { ...ctx, recentPaidInvoices: [{ id: 1250, amountRub: 3000, buyerInn: "7701234567" }] },
  );
  assert.equal(other.kind, "credit");
});

test("дубли ИНН: та, что платила раньше, или по счёту; иначе — админу", () => {
  const paying = decideStatementCredit({ date: "2026-11-10", amountRub: 1990, payerInn: "9701290368", reviewInvoice: null }, ctx);
  assert.equal(paying.kind === "credit" && paying.organizationId, "dup-a");
  const byInvoice = decideStatementCredit({ date: "2026-11-10", amountRub: 1990, payerInn: "9701290368", reviewInvoice: { id: 9, organizationId: "dup-b" } }, ctx);
  assert.equal(byInvoice.kind === "credit" && byInvoice.organizationId, "dup-b");
  assert.deepEqual(decideStatementCredit({ date: "2026-11-10", amountRub: 1990, payerInn: "2460204198", reviewInvoice: null }, ctx), {
    kind: "ambiguous",
    organizationIds: ["twin-a", "twin-b"],
  });
});

test("меньше рубля на баланс не попадает", () => {
  assert.equal(creditAmountRub(0.99), 0);
  assert.equal(creditAmountRub(1990), 1990);
  assert.deepEqual(decideStatementCredit({ date: "2026-11-10", amountRub: 0.5, payerInn: "7701234567", reviewInvoice: null }, ctx), { kind: "skip", reason: "too-small" });
});

test("поступления до запуска не зачисляем — их разбирали вручную", () => {
  assert.deepEqual(decideStatementCredit({ date: "2026-11-09T15:00:00", amountRub: 5000, payerInn: "7701234567", reviewInvoice: null }, ctx), {
    kind: "skip",
    reason: "before-launch",
  });
  assert.equal(decideStatementCredit({ date: "2026-11-10T09:00:00", amountRub: 5000, payerInn: "7701234567", reviewInvoice: null }, ctx).kind, "credit");
});
