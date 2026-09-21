import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { accusative, cleanLabel, esc, formSteps, introHint, jsonForScript, metricOf, normRange, renderForm } from "./journal-fill-html";

describe("journal-fill-html", () => {
  it("escapes html and keeps inline json safe", () => {
    assert.equal(esc(`<b>"x" & 'y'</b>`), "&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;");
    assert.equal(jsonForScript({ a: "</script>" }).includes("</script>"), false);
    assert.equal(jsonForScript({ a: "</script>" }).includes("u003c/script>"), true);
  });

  it("takes the deviation norm from the label, else the validator bounds", () => {
    assert.deepEqual(normRange({ type: "number", key: "t", label: "Холодильник №1 · норма 2…6", min: -40, max: 30 }), { min: 2, max: 6 });
    assert.deepEqual(normRange({ type: "number", key: "t", label: "Морозильник · норма -20…-16", min: -40, max: 30 }), { min: -20, max: -16 });
    assert.deepEqual(normRange({ type: "number", key: "t", label: "Морозильный ларь №4 · норма -18…-20", min: -40, max: 30 }), { min: -20, max: -18 });
    assert.deepEqual(normRange({ type: "number", key: "t", label: "Температура", min: -20, max: 120 }), { min: -20, max: 120 });
    assert.deepEqual(normRange({ type: "text", key: "t", label: "x" }), { min: null, max: null });
  });

  it("renders a segmented status row for hygiene with the default checked", () => {
    const html = renderForm({
      action: "/x", token: "t", who: "", correctionPresets: [], openedAt: 1, suggestions: {},
      hints: { defaults: { status: "healthy" }, segmented: { status: { healthy: "Здоров", day_off: "Выходной", sick_leave: "Болен" } } },
      values: { status: "healthy" },
      form: { fields: [{ type: "select", key: "status", label: "Состояние", required: true, options: [{ value: "healthy", label: "Здоров" }, { value: "day_off", label: "Выходной / отгул" }, { value: "sick_leave", label: "Больничный лист" }] }] },
    });
    assert.match(html, /<div class="seg"><label class="segb on"><input type="radio" name="status" value="healthy" checked required><span>Здоров<\/span><\/label><label class="segb"><input type="radio" name="status" value="day_off" required><span>Выходной<\/span><\/label>/);
    assert.doesNotMatch(html, /<select/);
  });

  it("splits a fridge with two readings a day into two big fields in one card", () => {
    const html = renderForm({
      action: "/x", token: "t", who: "", correctionPresets: [], openedAt: 1, suggestions: {}, hints: {}, values: { "t_e1": "-18.3" },
      form: { fields: [
        { type: "number", key: "t_e1", label: "Морозильный ларь №4 (П/Ф) — 1-й замер · норма -20…-18", unit: "°C", required: true },
        { type: "number", key: "t_e1#2", label: "Морозильный ларь №4 (П/Ф) — 2-й замер · норма -20…-18", unit: "°C", required: true },
      ] },
    });
    assert.equal((html.match(/class="obj"/g) ?? []).length, 1);
    assert.match(html, /<div class="obj-t">Морозильный ларь №4 \(П\/Ф\)<\/div>/);
    assert.match(html, /<label for="f-t_e1">1-й замер<span class="req"/);
    assert.match(html, /<label for="f-t_e1#2">2-й замер<span class="req"/);
    assert.match(html, /Впишите температуру в карточки ниже \(1\)/);
  });

  it("asks the PIN above the save button when required and keeps its error next to it", () => {
    const html = renderForm({
      action: "/x", token: "t", who: "", correctionPresets: [], openedAt: 1, suggestions: {}, values: {}, hints: {}, pinRequired: true, error: "Неверный PIN. Осталось попыток: 4.",
      form: { fields: [{ type: "number", key: "t", label: "Холодильник · норма 2…6", unit: "°C", min: -40, max: 30 }] },
    });
    assert.match(html, /<div class="pinbox"><p class="pin-t">Введите ваш PIN<\/p><div class="err">Неверный PIN. Осталось попыток: 4.<\/div><input class="in pin" name="pin" type="password" inputmode="numeric"[^>]*>/);
    assert.equal((html.match(/class="err"/g) ?? []).length, 1);
    assert.ok(html.indexOf('class="pinbox"') < html.indexOf('class="sticky"'));
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
      "Впишите температуру в карточки ниже (2)",
      "Выберите состояние",
      "Отметьте, если температура выше 37°C",
      "Укажите время производства",
      "Нажмите «Сохранить замеры»",
    ]);
    assert.equal(cleanLabel("Кухня — t° · норма 18…22"), "Кухня");
    assert.deepEqual(metricOf("Кухня — влажность · норма 40…60"), { metric: "влажность", base: "Кухня" });
    // Климат: два поля одного склада → одна карточка с двумя колонками, норма в подписи, статус пилюлей.
    const climate = renderForm({
      action: "/x", token: "t", who: "", correctionPresets: [], openedAt: 1, suggestions: {}, values: {}, hints: {}, stamp: { date: "20.09.2026", time: "18:31" },
      form: { fields: [
        { type: "select", key: "time", label: "Время замера", required: true, options: [{ value: "10:00", label: "10:00" }] },
        { type: "number", key: "r1t", label: "Склад Бакалея — t° · норма 18…22", unit: "°C", required: true },
        { type: "number", key: "r1h", label: "Склад Бакалея — влажность · норма 40…60", unit: "%" },
        { type: "number", key: "r2t", label: "Склад Овощи — t° · норма 16…20", unit: "°C", required: true },
      ], submitLabel: "Сохранить замер" },
    });
    assert.equal((climate.match(/class="obj"/g) ?? []).length, 2);
    assert.match(climate, /<div class="obj-t">Склад Бакалея<\/div><div class="cols one">/);
    // Две метрики — подпись над полем, «−»/«+» по бокам, дата и время после названия.
    // Один стиль: поле во всю ширину, подпись внутри с датой, «−»/«+» по краям.
    assert.match(climate, /<div class="box"><button type="button" class="stp minus" data-step="r1t"[^>]*>−<\/button><input[^>]*id="f-r1t"[^>]*><label for="f-r1t">Температура · <span class="stamp" data-stamp-date="20.09.2026">20.09.2026 18:31<\/span><span class="req"/);
    assert.match(climate, /<input[^>]*id="f-r1h"[^>]*><label for="f-r1h">Влажность · <span class="stamp"[^>]*>20.09.2026 18:31<\/span><\/label><span class="pill"[^>]*><\/span><button type="button" class="stp plus" data-step="r1h" data-delta="1" aria-label="Плюс">\+<\/button><\/div><p class="st">Норма 40…60 %<\/p>/);
    assert.doesNotMatch(climate, /class="pinbox"/);
    assert.match(climate, /<p class="today">Показания вносятся за сегодня, <b>20.09.2026<\/b>, время <b class="stamp-t">18:31<\/b>.<\/p>/);
    // Пометка вместо показания: у температуры «Выключено», у влажности «Нет показания».
    assert.match(climate, /<div class="chips offrow"><label class="chip offc"><input type="checkbox" name="off:r1t" value="1">Выключено<\/label><\/div>/);
    // В две колонки чип у обеих метрик (симметрично), в одну колонку — только у обязательного поля.
    assert.match(climate, /name="off:r1h"/);
    assert.match(climate, /<div class="box"><button type="button" class="stp minus" data-step="r2t"[^>]*>−<\/button><input[^>]*id="f-r2t"[^>]*><label for="f-r2t">Температура · <span class="stamp"/);
    assert.doesNotMatch(climate, /class="note"/);
    assert.match(climate, /<div class="obj-t">Склад Овощи<\/div><div class="cols one">/);
    assert.match(climate, /Впишите температуру и влажность в карточки ниже \(2\)/);
    assert.match(climate, /data-label="Склад Бакалея · влажность"/);
    // Быстрый ввод: границы нормы и середина, текущее значение подсвечено.
    assert.match(climate, /<div class="chips qv"><button type="button" class="chip" data-fill="r1t" data-value="18">18<\/button><button type="button" class="chip" data-fill="r1t" data-value="20">20<\/button><button type="button" class="chip" data-fill="r1t" data-value="22">22<\/button><\/div>/);
    assert.match(climate, /<button type="button" class="chip" data-fill="r1h" data-value="50">50<\/button>/);
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
