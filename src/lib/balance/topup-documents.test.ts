import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { topupReceiptItems } from "@/lib/balance/topup";
import { TOPUP_TARIFF_KEY, topupOrderDescription } from "@/lib/balance/topup-core";
import { reviewSocialText, type ReviewView } from "@/lib/balance/review-view";
import { buildClosingLines } from "@/lib/closing-documents/build";
import { closingEligibility } from "@/lib/closing-documents/service";
import { EMPTY_REQUISITES, type PlatformRequisites } from "@/lib/closing-documents/types";

/**
 * Документы вокруг пополнения (решение бухгалтера 2026-09-30): пополнение — сразу
 * продажа 100 %: УПД выпускается сразу после оплаты, чек — полный расчёт за услугу,
 * второго чека при трате баллов нет. И текст анонимного отзыва — без имени и заведения.
 */

const requisites: PlatformRequisites = {
  ...EMPTY_REQUISITES,
  nameFull: "Общество с ограниченной ответственностью «БФС»",
  inn: "5018215599",
  ogrn: "1235000105306",
  address: "141065, Московская область, г. Королёв, ул. Ленина, д. 10/6",
  bank: { name: "АО «Банк»", bik: "044525225", account: "40702810000000000001", corrAccount: "30101810400000000225" },
  head: { post: "Генеральный директор", name: "Иванов И. И." },
  facsimileFile: "facsimile.png",
  stampFile: "stamp.png",
};

const paid = { status: "paid", isTest: false, amountRub: 5000, refundedAt: null };

describe("закрывающий документ и пополнение", () => {
  it("оплаченное пополнение — УПД выпускается сразу после оплаты", () => {
    assert.deepEqual(closingEligibility({ ...paid, tariffKey: TOPUP_TARIFF_KEY }, requisites), { ok: true });
  });

  it("строка УПД на пополнение — одна услуга на всю сумму, без периода подписки", () => {
    const lines = buildClosingLines({
      order: { id: 77, amountRub: 5000, pointsSpent: 0, paidAt: new Date("2026-10-02T09:00:00Z"), description: "Пополнение баланса на 5 000 ₽", tariffKey: TOPUP_TARIFF_KEY, bundleConfig: null },
      tariff: null,
      subscriptionEnd: null,
      organization: { name: "Кафе", inn: "7700000000", address: null, legalProfile: null },
      requisites,
    } as Parameters<typeof buildClosingLines>[0]);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].sumRub, 5000);
    assert.match(lines[0].title, /пополнение баланса/);
    assert.doesNotMatch(lines[0].title, /период/);
  });

  it("оплаченная подписка — как раньше: УПД выпускается", () => {
    assert.deepEqual(closingEligibility({ ...paid, tariffKey: "monthly" }, requisites), { ok: true });
    // Без tariffKey (старые вызовы) — тоже как раньше.
    assert.deepEqual(closingEligibility(paid, requisites), { ok: true });
  });

  it("прочие причины не изменились: не оплачен, тест, ноль", () => {
    assert.deepEqual(closingEligibility({ ...paid, status: "pending", tariffKey: TOPUP_TARIFF_KEY }, requisites), {
      ok: false,
      reason: "not-paid",
    });
    assert.deepEqual(closingEligibility({ ...paid, isTest: true, tariffKey: "monthly" }, requisites), {
      ok: false,
      reason: "test",
    });
    assert.deepEqual(closingEligibility({ ...paid, amountRub: 0, tariffKey: "monthly" }, requisites), {
      ok: false,
      reason: "zero",
    });
  });
});

describe("чек 54-ФЗ для пополнения (уходит, только если чеки включены env)", () => {
  it("полный расчёт за услугу, сумма заказа, без НДС (второй чек при трате баллов не нужен)", () => {
    const name = topupOrderDescription(5000, "card");
    assert.deepEqual(topupReceiptItems(5000, name), [
      {
        name: "Пополнение баланса на 5 000 ₽",
        quantity: 1,
        sum: 5000,
        payment_method: "full_payment",
        payment_object: "service",
        tax: "none",
      },
    ]);
  });

  it("название строки чека не длиннее 128 символов", () => {
    const [item] = topupReceiptItems(300000, "П".repeat(300));
    assert.equal(item.name.length, 128);
  });
});

function view(partial: Partial<ReviewView>): ReviewView {
  return {
    id: "r1",
    organizationId: "org1",
    organizationName: "Кафе «Ромашка»",
    userId: "u1",
    authorName: "Анна Петрова",
    place: "Кафе «Ромашка», Казань",
    text: "Журналы ведём в WeSetup — проверку прошли без замечаний.",
    kind: "text",
    mediaUrl: null,
    mediaMime: null,
    rating: 5,
    consentPublic: true,
    anonymous: false,
    organizationSphere: "Кафе / Кофейня",
    status: "approved",
    rewardRub: 300,
    suggestedRewardRub: 300,
    rejectReason: null,
    showOnLanding: true,
    createdAt: "2026-09-30T10:00:00.000Z",
    moderatedAt: null,
    ...partial,
  };
}

describe("текст отзыва для соцсетей", () => {
  it("обычный — с именем и заведением", () => {
    assert.match(reviewSocialText(view({})), /\n— Анна Петрова, Кафе «Ромашка», Казань\n/);
  });

  it("анонимный — «Анонимный отзыв» и сфера, без имени и заведения", () => {
    const text = reviewSocialText(view({ anonymous: true, authorName: "", place: "", suggestedRewardRub: 240 }));
    assert.match(text, /\n— Анонимный отзыв, Кафе \/ Кофейня\n/);
    assert.doesNotMatch(text, /Анна|Ромашка|Казань/);
  });

  it("анонимный без известной сферы — только «Анонимный отзыв»", () => {
    const text = reviewSocialText(view({ anonymous: true, authorName: "", place: "", organizationSphere: null }));
    assert.match(text, /\n— Анонимный отзыв\n/);
  });
});
