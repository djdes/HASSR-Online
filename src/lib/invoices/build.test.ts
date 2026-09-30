import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EMPTY_REQUISITES, type PartySnapshot, type PlatformRequisites } from "@/lib/closing-documents/types";
import {
  INVOICE_VALID_DAYS,
  TOPUP_INVOICE_LINE_TITLE,
  buildInvoiceDraft,
  buildInvoiceLines,
  invoiceFilename,
  invoiceRequisitesReady,
} from "@/lib/invoices/build";

const full: PlatformRequisites = {
  ...EMPTY_REQUISITES,
  nameFull: "Общество с ограниченной ответственностью «БФС»",
  inn: "5018215599",
  ogrn: "1235000105306",
  address: "141065, Московская область, г. Королёв, ул. Ленина, д. 10/6",
  bank: { name: "АО «Банк»", bik: "044525225", account: "40702810000000000001", corrAccount: "30101810400000000225" },
  head: { post: "Генеральный директор", name: "Иванов И. И." },
};

const seller: PartySnapshot = { name: full.nameFull, inn: full.inn, kpp: null, ogrn: full.ogrn, address: full.address, head: full.head, bank: full.bank };
const buyer: PartySnapshot = { name: "ООО «Ромашка»", inn: "7712345678", kpp: "771201001", ogrn: null, address: "Москва", head: null };
const createdAt = new Date("2026-09-09T10:00:00.000Z");

describe("invoiceRequisitesReady", () => {
  it("картинки не обязательны, банк и подписант — да", () => {
    assert.equal(invoiceRequisitesReady(full), true);
    assert.equal(invoiceRequisitesReady({ ...full, bank: { ...full.bank, account: "" } }), false);
    assert.equal(invoiceRequisitesReady({ ...full, head: { post: "", name: "" } }), false);
  });
});

describe("buildInvoiceLines", () => {
  it("подписка — одна строка на длительность, без дат", () => {
    const lines = buildInvoiceLines({
      order: { id: 26, createdAt, amountRub: 1990, bundleConfig: null },
      tariff: { title: "Подписка", periodDays: 30, priceRub: 1990 },
      seller,
      buyer,
    });
    assert.equal(lines.length, 1);
    assert.equal(lines[0].sumRub, 1990);
    assert.match(lines[0].title, /30 дн\. \(период — с даты оплаты\)/);
    assert.doesNotMatch(lines[0].title, /\d{2}\.\d{2}\.\d{4}/);
  });

  it("комплект — оборудование строками, услуге остаток", () => {
    const lines = buildInvoiceLines({
      order: { id: 27, createdAt, amountRub: 1990 + 12900, bundleConfig: { tablet: 1 } },
      tariff: { title: "Подписка", periodDays: 30, priceRub: 1990 },
      seller,
      buyer,
    });
    assert.deepEqual(lines.map((l) => [l.sumRub, l.unit]), [[1990, "усл. ед."], [12900, "шт"]]);
  });

  it("пополнение баланса — одна строка «Пополнение баланса…» на всю сумму, без периода подписки", () => {
    const lines = buildInvoiceLines({
      order: { id: 28, createdAt, amountRub: 5000, bundleConfig: null },
      tariff: null,
      seller,
      buyer,
      purpose: "topup",
    });
    assert.deepEqual(lines, [
      { title: TOPUP_INVOICE_LINE_TITLE, unit: "усл. ед.", unitCode: "876", qty: 1, priceRub: 5000, sumRub: 5000 },
    ]);
    assert.doesNotMatch(lines[0].title, /\d+ дн\./);
  });

  it("примечание счёта: подписка продлевается / баланс пополняется", () => {
    const subscription = buildInvoiceDraft({
      order: { id: 29, createdAt, amountRub: 1990, bundleConfig: null },
      tariff: { title: "Подписка", periodDays: 30, priceRub: 1990 },
      seller,
      buyer,
    });
    assert.match(subscription.afterPayment ?? "", /подписка продлевается автоматически/);
    const topup = buildInvoiceDraft({
      order: { id: 30, createdAt, amountRub: 300000, bundleConfig: null },
      tariff: null,
      seller,
      buyer,
      purpose: "topup",
    });
    assert.equal(topup.totalRub, 300000);
    assert.match(topup.afterPayment ?? "", /баланс организации пополняется на сумму счёта \(1 ₽ = 1 балл\)/);
    assert.doesNotMatch(topup.afterPayment ?? "", /подписка продлевается/);
  });
});

describe("buildInvoiceDraft", () => {
  it("номер = заказ, срок действия INVOICE_VALID_DAYS, итог = сумма строк", () => {
    const draft = buildInvoiceDraft({
      order: { id: 26, createdAt, amountRub: 1990, bundleConfig: null },
      tariff: { title: "Подписка", periodDays: 30, priceRub: 1990 },
      seller,
      buyer,
    });
    assert.equal(draft.number, "26");
    assert.equal(draft.totalRub, 1990);
    assert.equal(draft.dueAt.getTime() - createdAt.getTime(), INVOICE_VALID_DAYS * 24 * 60 * 60 * 1000);
    assert.equal(draft.seller.bank?.bik, "044525225");
    assert.match(draft.basis, /оферта/);
  });
});

describe("invoiceFilename", () => {
  it("ASCII и кириллица", () => {
    assert.deepEqual(invoiceFilename("26"), { ascii: "Invoice-26.pdf", utf8: "Счёт-26.pdf" });
  });
});
