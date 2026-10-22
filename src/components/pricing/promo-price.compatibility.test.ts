import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PromoPrice, formatPriceRub, type PersonalDiscount } from "./promo-price";

test("optional price formatter receives only final display values; default remains identical", () => {
  const promotion = { id: "p", title: "Название custom", percent: 20, startsAt: "2026-10-01T00:00:00.000Z", endsAt: "2026-11-01T00:00:00.000Z" };
  const personal: PersonalDiscount = { source: "code", code: "CUSTOM", kind: "percent", value: 10, lifetime: false };
  for (const locale of ["ru","en","uz"] as const) for (const promo of [false,true]) for (const discount of [false,true]) for (const layout of ["inline","stacked"] as const) {
    const price = { baseRub: 12500, priceRub: promo ? 10000 : 12500, promotion: promo ? promotion : null };
    const props = { locale, price, personal: discount ? personal : null, layout };
    const original = renderToStaticMarkup(createElement(PromoPrice, props));
    assert.equal(renderToStaticMarkup(createElement(PromoPrice, { ...props, formatAmount: formatPriceRub })), original);
    const calls: [number,string][] = [];
    const custom = renderToStaticMarkup(createElement(PromoPrice, { ...props, formatAmount: (value, lang) => { calls.push([value,lang]); return `CUSTOM_${value}_${lang}`; } }));
    const final = price.priceRub - (discount ? Math.round(price.priceRub / 10) : 0);
    assert.deepEqual(calls, promo || discount ? [[12500,locale],[final,locale]] : [[12500,locale]]);
    assert.ok(custom.includes(`CUSTOM_${final}_${locale}`));
    assert.equal(JSON.stringify(price), JSON.stringify({ baseRub: 12500, priceRub: promo ? 10000 : 12500, promotion: promo ? promotion : null }));
  }
});
