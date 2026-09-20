import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { accusative, cleanLabel, esc, formSteps, introHint, jsonForScript, normRange, renderForm } from "./journal-fill-html";

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
      form: { fields: [{ type: "text", key: "productName", label: "Блюдо" }, { type: "number", key: "productTemp", label: "Температура", min: -20, max: 120 }, { type: "select", key: "s", label: "Оценка", required: true, options: [{ value: "a", label: "А" }] }] },
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
    // подпись внутри поля: input, затем label; звёздочка у обязательного
    assert.match(html, /<input class="in" id="f-productName"[^>]*placeholder=" "[^>]*>(?:<datalist[^]*?<\/datalist>)?<label for="f-productName">Блюдо<\/label>/);
    assert.match(html, /<label for="f-s">Оценка<span class="req"/);
    assert.equal(html.includes("по желанию"), false);
    assert.equal(html.includes("обязательно"), false);
  });

  it("builds short numbered steps without the employee name", () => {
    const steps = formSteps(
      {
        intro: "Иванова Ольга Петровна, снимите показания каждого холодильника и введите температуру в °C. Если оборудование выключено — оставьте поле пустым и сообщите начальнику.",
        fields: [
          { type: "number", key: "a", label: "Холодильник №1 · норма 2…6", unit: "°C", min: -40, max: 30 },
          { type: "number", key: "b", label: "Морозильник · норма -20…-16", unit: "°C", min: -40, max: 30 },
          { type: "select", key: "s", label: "Состояние", options: [] },
          { type: "boolean", key: "t", label: "Температура выше 37°C" },
          { type: "time", key: "tm", label: "Время производства" },
          { type: "text", key: "c", label: "Корректирующее действие (если брак)" },
        ],
        submitLabel: "Сохранить замеры",
      },
      {}
    );
    assert.deepEqual(steps, [
      "Укажите температуру: Холодильник №1, Морозильник",
      "Выберите состояние",
      "Отметьте, если температура выше 37°C",
      "Укажите время производства",
      "Нажмите «Сохранить замеры»",
    ]);
    assert.equal(cleanLabel("Кухня — t° · норма 18…22"), "Кухня");
    assert.equal(accusative("органолептическая оценка"), "органолептическую оценку");
    assert.equal(accusative("температура внутри продукта"), "температуру внутри продукта");
    assert.equal(accusative("время производства"), "время производства");
    assert.equal(accusative("наименование блюд (изделий)"), "наименование блюд (изделий)");
    assert.equal(accusative("дата и время изготовления"), "дату и время изготовления");
    assert.match(
      renderForm({ action: "/x", token: "t", form: { fields: [{ type: "number", key: "t", label: "Температура", min: 0, max: 100 }, { type: "select", key: "o", label: "Органолептическая оценка", options: [] }] }, hints: {}, values: {}, suggestions: {}, who: "", correctionPresets: [], openedAt: 1 }),
      /Укажите температуру<[^]*?Выберите органолептическую оценку</
    );
    assert.equal(
      introHint("Иванова Ольга Петровна, снимите показания. Если оборудование выключено — оставьте поле пустым и сообщите начальнику.", "Иванова Ольга Петровна"),
      "Если оборудование выключено — оставьте поле пустым и сообщите начальнику."
    );
    assert.equal(introHint("Отметьте своё состояние перед сменой.", "Иванова"), null);
  });
});
