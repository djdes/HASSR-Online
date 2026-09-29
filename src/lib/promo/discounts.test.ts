import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  appliedDiscountNotice,
  discountForPrice,
  discountLabel,
  pickBestDiscount,
  type AppliedDiscount,
} from "@/lib/promo/discounts";

const nb = (text: string | null) => (text ?? "").replace(/[  ]/g, " ");

describe("pickBestDiscount — выгоднейший из двух, не складываются", () => {
  const lifetime10 = { kind: "percent" as const, value: 10 };

  it("только скидка навсегда — применяется сама", () => {
    assert.deepEqual(pickBestDiscount({ offerRub: 1990, code: null, lifetime: lifetime10 }), {
      source: "lifetime",
      discountRub: 199,
      codeRub: 0,
      lifetimeRub: 199,
    });
  });

  it("код выгоднее скидки навсегда — применяется код (−500 ₽ против −159 ₽ от цены по акции)", () => {
    const best = pickBestDiscount({ offerRub: 1592, code: { kind: "fixed", value: 500 }, lifetime: lifetime10 });
    assert.equal(best.source, "code");
    assert.equal(best.discountRub, 500);
    assert.equal(best.lifetimeRub, 159);
  });

  it("скидка навсегда выгоднее кода — применяется она", () => {
    const best = pickBestDiscount({ offerRub: 1990, code: { kind: "percent", value: 5 }, lifetime: lifetime10 });
    assert.equal(best.source, "lifetime");
    assert.equal(best.discountRub, 199);
    assert.equal(best.codeRub, 100);
  });

  it("поровну — скидка навсегда (лимит кода не тратится)", () => {
    const best = pickBestDiscount({ offerRub: 1990, code: { kind: "percent", value: 10 }, lifetime: lifetime10 });
    assert.equal(best.source, "lifetime");
  });

  it("не складываются: скидка всегда одна", () => {
    const best = pickBestDiscount({ offerRub: 1990, code: { kind: "percent", value: 20 }, lifetime: lifetime10 });
    assert.equal(best.discountRub, 398);
    assert.notEqual(best.discountRub, 398 + 199);
  });

  it("цена 0 — скидки нет; без кода и без скидки — нет", () => {
    assert.equal(pickBestDiscount({ offerRub: 0, code: { kind: "fixed", value: 500 }, lifetime: lifetime10 }).source, null);
    assert.equal(pickBestDiscount({ offerRub: 1990, code: null, lifetime: null }).source, null);
  });

  it("скидка считается от переданной цены (цена с акцией)", () => {
    assert.equal(discountForPrice(lifetime10, 1592), 159);
    assert.equal(discountForPrice({ kind: "fixed", value: 5000 }, 1592), 1592);
  });
});

describe("подписи и пояснения", () => {
  const lifetime: AppliedDiscount = {
    source: "lifetime",
    code: "ROMASHKA10",
    kind: "percent",
    value: 10,
    lifetime: true,
    discountRub: 199,
    lifetimeDiscountId: "ld1",
  };
  const code: AppliedDiscount = { ...lifetime, source: "code", code: "PARTNER500", kind: "fixed", value: 500, lifetime: false, discountRub: 500, lifetimeDiscountId: null };

  it("плашки: «Ваша скидка −10 % навсегда», «Промокод X: −10 % навсегда», «Промокод X: −500 ₽»", () => {
    assert.equal(nb(discountLabel(lifetime)), "Ваша скидка −10 % навсегда");
    assert.equal(nb(discountLabel({ ...lifetime, source: "code" })), "Промокод ROMASHKA10: −10 % навсегда");
    assert.equal(nb(discountLabel(code)), "Промокод PARTNER500: −500 ₽");
  });

  it("скидка навсегда выиграла у введённого кода — говорим, что применили и почему", () => {
    const notice = nb(appliedDiscountNotice({ applied: lifetime, lifetime, typedCode: "START5" }));
    assert.equal(notice, "Ваша скидка навсегда (−10 %) выгоднее промокода START5 — применили её. Скидки не складываются.");
  });

  it("код выиграл у скидки навсегда — применили его к этой оплате, следующие снова со скидкой навсегда", () => {
    const notice = nb(appliedDiscountNotice({ applied: code, lifetime, typedCode: "PARTNER500" }));
    assert.match(notice, /^Промокод PARTNER500 выгоднее вашей скидки навсегда \(−10 %\) — применили его к этой оплате/);
    assert.match(notice, /следующие оплаты — снова со скидкой навсегда/);
  });

  it("ввели свой же код, уже закреплённый навсегда", () => {
    assert.equal(
      appliedDiscountNotice({ applied: lifetime, lifetime, typedCode: "ROMASHKA10" }),
      "Промокод ROMASHKA10 уже работает у вас как скидка навсегда — вводить его не нужно."
    );
  });

  it("код «навсегда» без привязки — объясняем, что закрепится после оплаты; обычный код — без пояснений", () => {
    assert.match(
      appliedDiscountNotice({ applied: { ...lifetime, source: "code", lifetimeDiscountId: null }, lifetime: null, typedCode: "ROMASHKA10" }) ?? "",
      /после оплаты она закрепится за аккаунтом/
    );
    assert.equal(appliedDiscountNotice({ applied: code, lifetime: null, typedCode: "PARTNER500" }), null);
    assert.equal(appliedDiscountNotice({ applied: lifetime, lifetime, typedCode: null }), null);
  });
});
