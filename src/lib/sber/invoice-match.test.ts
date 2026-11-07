import assert from "node:assert/strict";
import test from "node:test";

import { invoiceNumbersInPurpose, matchIncomingPayment, type OpenInvoice } from "@/lib/sber/invoice-match";
import { parseStatementPage } from "@/lib/sber/statement-parse";
import { daysUntil, isExpiringSoon, scanflowUtcToIso } from "@/lib/sber/scanflow-shared";

const invoices: OpenInvoice[] = [
  { id: 1287, amountRub: 3000, buyerInn: "7701234567" },
  { id: 1290, amountRub: 18900, buyerInn: "5018215599" },
  { id: 1301, amountRub: 3000, buyerInn: "5018215599" },
];

test("номер счёта из назначения: наш формат, переписанный бухгалтерией и без ложных чисел", () => {
  assert.deepEqual(invoiceNumbersInPurpose("Оплата по счёту № 1287 от 30.10.2026 за доступ к сервису WeSetup. Без НДС"), [1287]);
  assert.deepEqual(invoiceNumbersInPurpose("оплата по счету 1290 за подписку, НДС не облагается"), [1290]);
  assert.deepEqual(invoiceNumbersInPurpose("Оплата сч. 1301; сумма 3000-00"), [1301]);
  assert.deepEqual(invoiceNumbersInPurpose("Счет N1287"), [1287]);
  assert.deepEqual(invoiceNumbersInPurpose("Оплата за услуги по договору от 30.10.2026, ИНН 7701234567"), []);
});

test("номер и сумма совпали — счёт оплачен, даже если платит другое юрлицо", () => {
  const m = matchIncomingPayment({ operationId: "a", amountRub: 3000, purpose: "Оплата по счёту № 1287 от 30.10.2026", payerInn: "9999999999" }, invoices);
  assert.deepEqual(m, { kind: "paid", orderId: 1287, by: "number" });
});

test("номер наш, сумма другая — на разбор, ничего не отмечаем", () => {
  const m = matchIncomingPayment({ operationId: "b", amountRub: 2500, purpose: "Оплата по счёту № 1290", payerInn: "5018215599" }, invoices);
  assert.equal(m.kind, "review");
  assert.equal(m.kind === "review" && m.orderId, 1290);
});

test("номера нет: ИНН плательщика и сумма однозначно указывают на счёт", () => {
  const m = matchIncomingPayment({ operationId: "c", amountRub: 18900, purpose: "Оплата за сервис журналов", payerInn: "5018215599" }, invoices);
  assert.deepEqual(m, { kind: "paid", orderId: 1290, by: "inn" });
});

test("номера нет, у плательщика счёт на другую сумму — на разбор", () => {
  const m = matchIncomingPayment({ operationId: "d", amountRub: 5000, purpose: "Оплата", payerInn: "7701234567" }, invoices);
  assert.equal(m.kind, "review");
});

test("чужое поступление на общий счёт — пропускаем", () => {
  assert.deepEqual(matchIncomingPayment({ operationId: "e", amountRub: 3000, purpose: "Оплата по договору поставки № 77", payerInn: "1111111111" }, invoices), { kind: "none" });
  assert.deepEqual(matchIncomingPayment({ operationId: "f", amountRub: 3000, purpose: "Возврат", payerInn: null }, invoices), { kind: "none" });
});

test("выписка Sber v2: входящие с плательщиком, сумма-объект, пагинация по ссылке next", () => {
  const page = parseStatementPage(
    {
      transactions: [
        {
          operationId: "op-1",
          operationDate: "2026-11-07T10:15:00",
          direction: "CREDIT",
          amountRub: { amount: "3000.00", currencyName: "RUB" },
          paymentPurpose: "Оплата по счёту № 1287",
          rurTransfer: { payerName: "ООО Ромашка", payerInn: "7701234567" },
        },
        { uuid: "op-2", direction: "DEBIT", amount: 150.5, description: "Комиссия" },
      ],
      links: [{ rel: "next", href: "…" }],
    },
    "2026-11-07"
  );
  assert.equal(page.hasMore, true);
  assert.deepEqual(page.transactions[0], {
    operationId: "op-1",
    date: "2026-11-07T10:15:00",
    amountRub: 3000,
    direction: "CREDIT",
    purpose: "Оплата по счёту № 1287",
    payerInn: "7701234567",
    payerName: "ООО Ромашка",
  });
  assert.equal(page.transactions[1].direction, "DEBIT");
  assert.equal(page.transactions[1].amountRub, 150.5);
  assert.equal(page.transactions[1].date, "2026-11-07");
});

test("сроки ScanFlow: UTC без пояса, «истекает скоро», дни до даты", () => {
  assert.equal(scanflowUtcToIso("2026-11-07 12:40:02"), "2026-11-07T12:40:02.000Z");
  assert.equal(scanflowUtcToIso(""), null);
  const now = Date.parse("2026-11-07T12:39:00Z");
  assert.equal(isExpiringSoon("2026-11-07 12:40:02", now), true);
  assert.equal(isExpiringSoon("2026-11-07 13:40:02", now), false);
  assert.equal(isExpiringSoon(null, now), false);
  assert.equal(daysUntil("2026-11-17T12:39:00Z", now), 10);
});
