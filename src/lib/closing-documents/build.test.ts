import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  amountInWords,
  buildBuyerSnapshot,
  buildClosingDocument,
  buildClosingLines,
  numberToWords,
  subscriptionPeriod,
  type BuildInput,
} from "@/lib/closing-documents/build";
import {
  EMPTY_REQUISITES,
  closingDocumentFilename,
  isRequisitesComplete,
  requisitesChecklist,
  type PlatformRequisites,
} from "@/lib/closing-documents/types";

const requisites: PlatformRequisites = {
  ...EMPTY_REQUISITES,
  nameFull: "Общество с ограниченной ответственностью «БФС»",
  nameShort: "ООО «БФС»",
  inn: "5018215599",
  ogrn: "1235000105306",
  address: "141065, Московская область, г. Королёв, ул. Пример, д. 1",
  bank: { name: "АО «Банк»", bik: "044525225", account: "40702810000000000001", corrAccount: "30101810400000000225" },
  head: { post: "Генеральный директор", name: "Иванов И. И." },
  facsimileFile: "facsimile.png",
  stampFile: "stamp.png",
};

const paidAt = new Date("2026-09-09T10:00:00.000Z");

function input(overrides: Partial<BuildInput["order"]> = {}, extra: Partial<BuildInput> = {}): BuildInput {
  return {
    order: {
      id: 4321,
      amountRub: 1990,
      pointsSpent: 0,
      paidAt,
      description: "Подписка",
      bundleConfig: null,
      ...overrides,
    },
    tariff: { title: "Подписка", periodDays: 30 },
    subscriptionEnd: new Date("2026-10-09T10:00:00.000Z"),
    organization: { name: "Кафе «Тестовое 1»", inn: "7700000000", address: "Москва", legalProfile: null },
    requisites,
    ...extra,
  };
}

describe("requisitesChecklist", () => {
  it("пустые реквизиты — ничего не готово, полные — всё", () => {
    assert.equal(isRequisitesComplete(EMPTY_REQUISITES), false);
    assert.equal(isRequisitesComplete(requisites), true);
    assert.equal(requisitesChecklist({ ...requisites, bank: { ...requisites.bank, bik: "123" } }).find((i) => i.key === "bank.bik")?.ok, false);
    // КПП необязателен — у ИП его нет.
    assert.equal(isRequisitesComplete({ ...requisites, kpp: "" }), true);
  });
});

describe("buildClosingLines", () => {
  it("подписка без оборудования — одна строка на всю сумму с периодом", () => {
    const lines = buildClosingLines(input());
    assert.equal(lines.length, 1);
    assert.equal(lines[0].sumRub, 1990);
    assert.equal(lines[0].unitCode, "876");
    assert.match(lines[0].title, /тариф «Подписка», период 09\.09\.2026 — 09\.10\.2026/);
    assert.doesNotMatch(lines[0].title, /Скидка/);
  });

  it("баллы — скидка в описании, сумма документа = деньги", () => {
    const doc = buildClosingDocument(input({ amountRub: 1490, pointsSpent: 500 }));
    assert.equal(doc.totalRub, 1490);
    assert.match(doc.lines[0].title, /Скидка баллами: 500 ₽/);
  });

  it("акция и промокод поверх неё — обе скидки в описании, сумма = оплате", () => {
    // 1990 − 20 % = 1592; промокод −10 % от 1592 = −159 → 1433.
    const doc = buildClosingDocument(
      input({ amountRub: 1433, promotionPercent: 20, promotionDiscountRub: 398, promoCode: "START10", discountRub: 159 })
    );
    assert.equal(doc.totalRub, 1433);
    const title = doc.lines[0].title.replace(/[\u00a0\u202f]/g, " ");
    assert.match(title, /Скидка по акции \(−20 %\): 398 ₽/);
    assert.match(title, /Промокод START10: −159 ₽/);
  });

  it("комплект: оборудование строками по каталогу, услуге — остаток", () => {
    const lines = buildClosingLines(
      input({ amountRub: 1990 + 3490 * 2 + 490 * 5, bundleConfig: { temp: 2, nfc: 5, ghost: 3 } })
    );
    const titles = lines.map((l) => l.title.split(",")[0]);
    assert.equal(lines.length, 3);
    assert.match(titles[0], /Доступ к сервису WeSetup/);
    assert.equal(lines[0].sumRub, 1990);
    assert.deepEqual(lines.slice(1).map((l) => [l.title, l.qty, l.priceRub, l.sumRub, l.unit]), [
      ["Датчик температуры", 2, 3490, 6980, "шт"],
      ["NFC-брелоки", 5, 490, 2450, "шт"],
    ]);
  });

  it("деньгами не покрыто даже оборудование — строки уменьшаются, итог = оплате", () => {
    const lines = buildClosingLines(input({ amountRub: 5000, pointsSpent: 4430, bundleConfig: { temp: 2, nfc: 5 } }));
    assert.equal(lines.length, 2);
    const total = lines.reduce((s, l) => s + l.sumRub, 0);
    assert.equal(Math.round(total * 100) / 100, 5000);
    assert.ok(lines.every((l) => l.sumRub > 0));
  });

  it("монтаж — условная единица, датчики — штуки", () => {
    const lines = buildClosingLines(input({ amountRub: 1990 + 9900, bundleConfig: { install: 1 } }));
    assert.equal(lines[1].unitCode, "876");
    assert.equal(lines[1].qty, 1);
  });
});

describe("buildClosingDocument", () => {
  it("номер = заказ, дата = оплата, стороны из реквизитов и юрпрофиля", () => {
    const doc = buildClosingDocument(
      input({}, {
        organization: {
          name: "Кафе",
          inn: "7700000000",
          address: "Москва",
          legalProfile: {
            inn: "7712345678",
            type: "LEGAL",
            nameShort: "ООО «Ромашка»",
            nameFull: "Общество с ограниченной ответственностью «Ромашка»",
            opfShort: "ООО",
            opfFull: null,
            kpp: "771201001",
            ogrn: "1027700000000",
            ogrnDate: null,
            address: "г. Москва, ул. Ленина, д. 1",
            management: { name: "Петров П. П.", post: "Директор" },
          } as never,
        },
      })
    );
    assert.equal(doc.number, "4321");
    assert.equal(doc.issuedAt, paidAt);
    assert.equal(doc.seller.name, requisites.nameFull);
    assert.equal(doc.seller.bank?.bik, "044525225");
    assert.equal(doc.buyer.name, "Общество с ограниченной ответственностью «Ромашка»");
    assert.equal(doc.buyer.inn, "7712345678");
    assert.equal(doc.buyer.kpp, "771201001");
    assert.deepEqual(doc.buyer.head, { post: "Директор", name: "Петров П. П." });
    assert.match(doc.basis, /заказ № 4321 от 09\.09\.2026/);
    assert.equal(doc.vatMode, "none");
  });

  it("без юрпрофиля покупатель — название, ИНН и адрес из настроек", () => {
    const buyer = buildBuyerSnapshot({ name: "Кафе", inn: null, address: null, legalProfile: null });
    assert.deepEqual(buyer, { name: "Кафе", inn: null, kpp: null, ogrn: null, address: null, head: null });
  });
});

describe("subscriptionPeriod", () => {
  it("конец известен — начало на periodDays раньше; иначе от даты оплаты", () => {
    const known = subscriptionPeriod({ paidAt, periodDays: 30, subscriptionEnd: new Date("2026-11-08T10:00:00.000Z") });
    assert.equal(known.from.toISOString(), "2026-10-09T10:00:00.000Z");
    const derived = subscriptionPeriod({ paidAt, periodDays: 30, subscriptionEnd: null });
    assert.equal(derived.from.toISOString(), paidAt.toISOString());
    assert.equal(derived.to.toISOString(), "2026-10-09T10:00:00.000Z");
  });
});

describe("сумма прописью", () => {
  it("числа", () => {
    assert.equal(numberToWords(0), "ноль");
    assert.equal(numberToWords(1990), "одна тысяча девятьсот девяносто");
    assert.equal(numberToWords(21), "двадцать один");
    assert.equal(numberToWords(12000), "двенадцать тысяч");
    assert.equal(numberToWords(1000000), "один миллион");
  });

  it("рубли и копейки со склонением", () => {
    assert.equal(amountInWords(1990), "одна тысяча девятьсот девяносто рублей 00 копеек");
    assert.equal(amountInWords(21.05), "двадцать один рубль 05 копеек");
    assert.equal(amountInWords(2.5), "два рубля 50 копеек");
  });
});

describe("closingDocumentFilename", () => {
  it("ASCII для заголовка, кириллица рядом", () => {
    assert.deepEqual(closingDocumentFilename("4321"), { ascii: "UPD-4321.pdf", utf8: "УПД-4321.pdf" });
  });
});
