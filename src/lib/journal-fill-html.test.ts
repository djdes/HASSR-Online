import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { esc, jsonForScript, normRange, renderForm } from "./journal-fill-html";

describe("journal-fill-html", () => {
  it("escapes html and keeps inline json safe", () => {
    assert.equal(esc(`<b>"x" & 'y'</b>`), "&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;");
    assert.equal(jsonForScript({ a: "</script>" }).includes("</script>"), false);
    assert.equal(jsonForScript({ a: "</script>" }).includes("u003c/script>"), true);
  });

  it("takes the deviation norm from the label, else the validator bounds", () => {
    assert.deepEqual(normRange({ type: "number", key: "t", label: "Холодильник №1 · норма 2…6", min: -40, max: 30 }), { min: 2, max: 6 });
    assert.deepEqual(normRange({ type: "number", key: "t", label: "Морозильник · норма -20…-16", min: -40, max: 30 }), { min: -20, max: -16 });
    assert.deepEqual(normRange({ type: "number", key: "t", label: "Температура", min: -20, max: 120 }), { min: -20, max: 120 });
    assert.deepEqual(normRange({ type: "text", key: "t", label: "x" }), { min: null, max: null });
  });

  it("renders a plain form that works without scripts", () => {
    const html = renderForm({
      action: "/journal-fill/o/c?token=t",
      token: "t",
      form: { fields: [{ type: "text", key: "productName", label: "Блюдо" }, { type: "number", key: "productTemp", label: "Температура", min: -20, max: 120 }, { type: "select", key: "s", label: "Оценка", options: [{ value: "a", label: "А" }] }] },
      hints: { nameFields: { productName: "dish" }, tempField: { nameKey: "productName", tempKey: "productTemp" } },
      values: { productName: "Борщ <b>", productTemp: 75, s: "a" },
      suggestions: { dish: { values: ["Борщ <b>", "Плов"], meta: {} } },
      who: "",
      correctionPresets: ["Сообщил руководителю"],
      openedAt: 1,
    });
    assert.match(html, /<form method="post" action="\/journal-fill\/o\/c\?token=t"/);
    assert.match(html, /name="productName"[^>]*value="Борщ &lt;b&gt;"/);
    assert.match(html, /data-min="-20" data-max="120"/);
    assert.match(html, /<option value="a" selected>/);
    assert.match(html, /<datalist id="dl-productName">/);
    assert.match(html, /id="deviation" hidden/);
    assert.equal(html.includes("<b>"), false);
  });
});
