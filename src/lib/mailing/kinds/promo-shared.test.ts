import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PROMO_DESIGNS,
  checkPromoPayload,
  coercePromoPayload,
  defaultPromoPayload,
  designDefaults,
  fillPromoText,
  promoPrices,
  type PromoDesign,
} from "./promo-shared";

const KEYS: PromoDesign[] = ["aurora", "coupon", "countdown", "compare", "letter"];

describe("«Акция»: данные", () => {
  it("promoPrices считает как applyPromotion: цена − round(цена × % / 100); 298,5 → 299", () => {
    assert.deepEqual(promoPrices(1990, 15), { oldRub: 1990, newRub: 1691, savingRub: 299 });
    assert.deepEqual(promoPrices(1990, 90), { oldRub: 1990, newRub: 199, savingRub: 1791 });
  });

  it("пять дизайнов с подписями; тексты по умолчанию у каждого свои", () => {
    assert.deepEqual(PROMO_DESIGNS.map((d) => d.key), KEYS);
    for (const d of PROMO_DESIGNS) assert.ok(d.title && d.hint);
    const subjects = new Set(KEYS.map((k) => designDefaults(k).subject));
    assert.equal(subjects.size, 5);
  });

  it("новый черновик: aurora, 15 %, 30 дней, 1990, персональный код, 4 выгоды", () => {
    const p = defaultPromoPayload();
    assert.equal(p.design, "aurora");
    assert.equal(p.discountPercent, 15);
    assert.equal(p.durationDays, 30);
    assert.equal(p.priceRub, 1990);
    assert.equal(p.tariffLabel, "Подписка");
    assert.equal(p.benefits.length, 4);
    assert.deepEqual(p.promo, { mode: "personal", code: null, lifetime: false });
    assert.equal(checkPromoPayload(p).ok, true);
    assert.equal(defaultPromoPayload("letter").design, "letter");
    assert.equal(defaultPromoPayload("letter").headline, designDefaults("letter").headline);
  });

  it("coerce не падает на мусоре и возвращает полную форму", () => {
    for (const raw of [null, undefined, 5, "x", [], { design: "nope", discountPercent: "abc" }]) {
      const p = coercePromoPayload(raw);
      assert.ok(KEYS.includes(p.design));
      assert.ok(Array.isArray(p.benefits));
      assert.equal(typeof p.promo.lifetime, "boolean");
    }
    assert.equal(coercePromoPayload({ discountPercent: "20", durationDays: "14" }).discountPercent, 20);
  });

  it("проверка: границы и тексты ошибок по-русски", () => {
    const base = defaultPromoPayload();
    const err = (patch: Record<string, unknown>) => {
      const r = checkPromoPayload({ ...base, ...patch });
      return r.ok ? null : r.error;
    };
    assert.match(err({ subject: " " }) ?? "", /тему/);
    assert.match(err({ headline: "" }) ?? "", /заголовок/);
    assert.match(err({ subject: "x".repeat(151) }) ?? "", /Тема/);
    assert.match(err({ headline: "x".repeat(121) }) ?? "", /Заголовок/);
    assert.match(err({ lead: "x".repeat(601) }) ?? "", /Текст/);
    assert.match(err({ buttonText: "x".repeat(41) }) ?? "", /кнопки/);
    assert.match(err({ discountPercent: 0 }) ?? "", /Скидка/);
    assert.match(err({ discountPercent: 91 }) ?? "", /Скидка/);
    assert.match(err({ discountPercent: 7.5 }) ?? "", /Скидка/);
    assert.match(err({ durationDays: 0 }) ?? "", /Срок/);
    assert.match(err({ durationDays: 91 }) ?? "", /Срок/);
    assert.match(err({ priceRub: 99 }) ?? "", /Цена/);
    assert.match(err({ priceRub: 1_000_001 }) ?? "", /Цена/);
    assert.match(err({ benefits: Array(7).fill("a") }) ?? "", /выгод/i);
    assert.match(err({ benefits: ["x".repeat(121)] }) ?? "", /выгод/i);
    assert.equal(err({ discountPercent: 90, durationDays: 90, priceRub: 100 }), null);
  });

  it("выбранный код — по формату, в верхнем регистре", () => {
    const base = defaultPromoPayload();
    const bad = checkPromoPayload({ ...base, promo: { mode: "existing", code: null, lifetime: false } });
    assert.equal(bad.ok, false);
    const bad2 = checkPromoPayload({ ...base, promo: { mode: "existing", code: "a b!", lifetime: false } });
    assert.equal(bad2.ok, false);
    const ok = checkPromoPayload({ ...base, promo: { mode: "existing", code: "osen20", lifetime: true } });
    assert.equal(ok.ok && ok.payload.promo.code, "OSEN20");
    const personal = checkPromoPayload({ ...base, promo: { mode: "personal", code: "ZZZ", lifetime: true } });
    assert.equal(personal.ok && personal.payload.promo.code, null);
  });

  it("fillPromoText: подстановка величин акции, неразрывные пробелы, переменные получателя", () => {
    const vars = { percent: 15, tariff: "Подписка", days: 30, date: "21 ноября", saving: 298, offer: "−15 % на 30 дней" };
    const out = fillPromoText("{компания}: −{percent} % на {tariff}, {days} до {date}, {saving} ₽", vars, {
      name: "Анна",
      company: "Кафе «Ромашка»",
      sphere: null,
    });
    assert.equal(out, "Кафе «Ромашка»: −15 % на Подписка, 30 дней до 21 ноября, 298 ₽");
    // значение из CSV не превращается в величину акции
    assert.equal(fillPromoText("{компания}", vars, { name: null, company: "{percent}", sphere: null }), "{percent}");
  });
});
