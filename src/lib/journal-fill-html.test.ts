import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  accusative,
  cleanLabel,
  esc,
  formSteps,
  introHint,
  jsonForScript,
  menuMetaScript,
  metricOf,
  normRange,
  readPostedMarks,
  renderEmployeeStep,
  renderForm,
  renderHub,
  renderPinNoAccess,
  renderPinStep,
  renderResult,
  resolveFillMarks,
  tempMetaScript,
  QR_FILL_JS,
} from "./journal-fill-html";
import type { TaskFormSchema } from "./tasksflow-adapters/task-form";
import { journalFillHints } from "./journal-fill-hints";
import { QR_FILL_CORRECTION_PRESETS, QR_FILL_DEFAULT_CORRECTION } from "@/lib/qr-correction-presets";

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

  // PIN — ДО формы, на своём шаге: в самой форме его больше нет.
  it("keeps the PIN out of the form; after the PIN step shows a check and lets fields rise", () => {
    const base = {
      action: "/x", token: "t", who: "<div class=\"who\"></div>", correctionPresets: [], openedAt: 1, suggestions: {}, values: {}, hints: {},
      form: { fields: [{ type: "number" as const, key: "t", label: "Холодильник · норма 2…6", unit: "°C", min: -40, max: 30 }] },
    };
    const plain = renderForm(base);
    assert.doesNotMatch(plain, /name="pin"/);
    assert.doesNotMatch(plain, /qp-ok/);
    const afterPin = renderForm({ ...base, pinOk: true });
    assert.match(afterPin, /<div class="who"><\/div><div class="qp-ok" role="status"/);
    assert.match(afterPin, /<div class="qp-rise">[\s\S]*<form method="post"/);
  });

  it("renders the PIN step full-width with a big field and the change-PIN link", () => {
    const html = renderPinStep({ action: "/x?f=1", who: "<div class=\"who\"></div>", error: "Неверный PIN. Осталось попыток: 4.", changePinHref: "/x?pinreq=change" });
    assert.doesNotMatch(html, /class="card"/);
    assert.match(html, /<label class="qp-k" for="qp-pin">Ваш PIN<\/label><a class="qp-link" href="\/x\?pinreq=change">Запросить смену PIN<\/a>/);
    assert.match(html, /<input id="qp-pin" class="qp-pin" type="password" name="pin" inputmode="numeric"/);
    assert.match(html, /<div class="qp-err" role="alert">Неверный PIN. Осталось попыток: 4.<\/div>/);
    // Кнопка шага PIN — «Войти», не «Продолжить».
    assert.match(html, /<button class="btn" type="submit">Войти<\/button>/);
    assert.equal(html.includes("Продолжить"), false);
    assert.equal(QR_FILL_DEFAULT_CORRECTION, "Повторю через 30 минут.");
  });

  it("renders the employee picker as a plain GET form with «remember» checked", () => {
    const html = renderEmployeeStep({
      pick: { action: "/journal-fill/o/hygiene", hidden: { token: "t", doc: "d1" }, showRemember: true },
      employees: [{ id: "u1", name: "Репешко Ирина Васильевна", positionTitle: "Заведующий производством" }],
    });
    assert.match(html, /^<form method="get" action="\/journal-fill\/o\/hygiene" class="card"><input type="hidden" name="token" value="t"><input type="hidden" name="doc" value="d1"><input type="hidden" name="rf" value="1">/);
    assert.match(html, /<button class="item" type="submit" name="employee" value="u1" data-emp="Репешко Ирина Васильевна"><span>Репешко Ирина Васильевна<small>Заведующий производством<\/small><\/span>/);
    assert.match(html, /<input type="checkbox" name="remember" value="1" checked>Запомнить выбор на этом оборудовании<\/label>/);
  });

  it("offers «request access» with a self-chosen PIN when the employee has none", () => {
    const html = renderPinNoAccess({ who: "", action: "/x", status: { text: "Запрос отправлен, ждёт одобрения.", tone: "wait" } });
    assert.match(html, /<input type="hidden" name="action" value="pin-request"><input type="hidden" name="kind" value="issue">|name="action" value="pin-request">\n<input type="hidden" name="kind" value="issue">/);
    assert.match(html, /name="pin2"/);
    assert.match(html, />Запросить доступ<\/button>/);
    assert.match(html, /qp-ok-note" role="status">Запрос отправлен, ждёт одобрения/);
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
      correctionPresets: QR_FILL_CORRECTION_PRESETS,
      openedAt: 1,
    });
    // «Что сделали» по умолчанию — «Повторю через 30 минут.»: в поле и отмеченный чип.
    assert.match(html, /<textarea class="in" name="__correction"[^>]*>Повторю через 30 минут\.<\/textarea>/);
    assert.match(html, /<button type="button" class="chip on" data-fill="__correction" data-value="Повторю через 30 минут\.">/);
    assert.match(html, /<button type="button" class="chip" data-fill="__correction" data-value="Сообщил руководителю">/);
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

describe("journal-fill-html: меню мастер-кабинета в QR-форме", () => {
  const hints = journalFillHints("finished_product");
  const meta = {
    "борщ": { productTemp: "75", portionWeight: "250", productionTime: "08:30" },
    "плов": { productTemp: "80" },
    "компот": { productionTime: "07:15" },
  };
  const suggestions = { dish: { values: ["Борщ", "Плов", "Компот"], meta } };

  it("отдаёт выход и время по блюдам только для полей, которые есть в форме", () => {
    const all = menuMetaScript(hints, suggestions, ["productName", "productionTime", "portionWeight"]);
    assert.ok(all);
    assert.match(all, /window\.__qrMenu=\{"борщ":\{"p":"250","h":"08:30"\},"компот":\{"h":"07:15"\}\};/);
    assert.match(all, /window\.__qrMenuKeys=\{"name":"productName","portion":"portionWeight","time":"productionTime"\};/);
    const noPortion = menuMetaScript(hints, suggestions, ["productName", "productionTime"]);
    assert.ok(noPortion && !noPortion.includes('"p":') && noPortion.includes('"portion":null'));
  });

  it("без меню мастера (нет выхода/времени в meta) — скрипта нет, температура как раньше", () => {
    const plain = { dish: { values: ["Плов"], meta: { "плов": { productTemp: "80" } } } };
    assert.equal(menuMetaScript(hints, plain, ["productName", "productionTime", "portionWeight"]), null);
    assert.equal(menuMetaScript({}, suggestions, ["productName", "productionTime"]), null);
    assert.match(tempMetaScript(hints, plain) ?? "", /window\.__qrTemps=\{"плов":"80"\}/);
  });

  it("инлайн-скрипт заполняет только пустой выход и нетронутое время", () => {
    assert.match(QR_FILL_JS, /mP\.value===""\|\|pAuto/);
    assert.match(QR_FILL_JS, /if\(mT&&!tUser\)/);
  });
});

describe("journal-fill-html: «Обслуживание»/«Ремонт» у холодильников", () => {
  const fridgeForm: TaskFormSchema = {
    fields: [
      { type: "number", key: "t_a", label: "Холодильник №1 — t° · норма 2…6", unit: "°C", required: true, min: -40, max: 30 },
      { type: "number", key: "t_b#2", label: "Морозильник — 2-й замер · норма -20…-18", unit: "°C", required: true, min: -40, max: 30 },
    ],
    statusFields: ["t_a", "t_b#2"],
    submitLabel: "Сохранить замеры",
  };
  const base = { action: "/x", token: "t", who: "", correctionPresets: [] as string[], openedAt: 1, suggestions: {}, hints: {}, values: {} };
  /** Кусок разметки одного поля: от его input до следующего поля. */
  const fieldHtml = (html: string, key: string) => {
    const start = html.indexOf(`id="f-${key}"`);
    const next = html.indexOf(`<div class="fl `, start);
    return html.slice(html.lastIndexOf(`<div class="fl `, start), next === -1 ? undefined : next);
  };

  it("рядом с «Выключено» — «Обслуживание» и «Ремонт», и только у холодильников", () => {
    const html = renderForm({ ...base, form: fridgeForm });
    assert.match(
      html,
      /<div class="chips offrow"><label class="chip offc"><input type="checkbox" name="off:t_a" value="1">Выключено<\/label><\/div><div class="chips offrow sts" role="group" aria-label="Вместо температуры"><label class="chip offc"><input type="radio" name="status:t_a" value="service">Обслуживание<\/label><label class="chip offc"><input type="radio" name="status:t_a" value="repair">Ремонт<\/label><\/div>/
    );
    // У каждого замера своя пара: `t_b#2` — второй замер морозильника.
    assert.equal((html.match(/type="radio" name="status:/g) ?? []).length, 4);
    assert.match(html, /name="status:t_b#2" value="repair"/);
    // Склад (журнал климата) — только «Выключено», без отметок холодильника.
    const climate = renderForm({ ...base, form: { fields: [{ type: "number", key: "r1t", label: "Склад Бакалея — t° · норма 18…22", unit: "°C", required: true }] } });
    assert.match(climate, /name="off:r1t"/);
    assert.doesNotMatch(climate, /name="status:|Обслуживание|Ремонт/);
    // Форма без `statusFields` (другой клиент адаптера) — кнопок тоже нет.
    assert.doesNotMatch(renderForm({ ...base, form: { fields: fridgeForm.fields } }), /name="status:/);
  });

  it("выбранная отметка: поле пустое, гаснет и не обязательно, подпись «в журнал «рем»»; с «Выключено» не смешивается", () => {
    const html = renderForm({ ...base, values: { t_a: 4 }, form: fridgeForm, statusMarks: { t_a: "repair" }, offKeys: ["t_a", "t_b#2"] });
    const a = fieldHtml(html, "t_a");
    assert.match(a, /^<div class="fl up has-step big is-off">/);
    assert.match(a, /id="f-t_a"[^>]*value=""/);
    assert.match(a, /id="f-t_a"[^>]*data-req="1">/);
    assert.doesNotMatch(a, /aria-required/);
    assert.match(a, /<p class="st">Ремонт — в журнал «рем», норма не проверяется<\/p>/);
    assert.match(a, /<label class="chip offc on"><input type="radio" name="status:t_a" value="repair" checked>Ремонт<\/label>/);
    // «Выключено» у того же поля не отмечено: отметка сильнее.
    assert.match(a, /<label class="chip offc"><input type="checkbox" name="off:t_a" value="1">Выключено<\/label>/);
    const b = fieldHtml(html, "t_b#2");
    assert.match(b, /<label class="chip offc on"><input type="checkbox" name="off:t_b#2" value="1" checked>Выключено<\/label>/);
    assert.doesNotMatch(b, / checked>(Обслуживание|Ремонт)/);
  });

  it("разбор POST: отметки только у холодильников, «Обслуживание»/«Ремонт» сильнее «Выключено»", () => {
    const posted = new FormData();
    posted.set("action", "submit");
    posted.set("t_a", "");
    posted.set("off:t_a", "1");
    posted.set("status:t_a", "repair");
    posted.set("off:t_b#2", "1");
    posted.set("status:t_b#2", "мусор");
    posted.set("status:t_x", "service");
    posted.set("off:comment", "1");
    assert.deepEqual(readPostedMarks(posted, fridgeForm), { off: ["t_b#2"], statuses: { t_a: "repair" } });
    const service = new FormData();
    service.set("status:t_b#2", "service");
    assert.deepEqual(readPostedMarks(service, fridgeForm), { off: [], statuses: { "t_b#2": "service" } });
    // Склад: статуса нет в форме — `status:` игнорируется, «Выключено» остаётся.
    const climate: TaskFormSchema = { fields: [{ type: "number", key: "r1t", label: "Склад — t° · норма 18…22", unit: "°C" }] };
    const climatePosted = new FormData();
    climatePosted.set("off:r1t", "1");
    climatePosted.set("status:r1t", "repair");
    assert.deepEqual(readPostedMarks(climatePosted, climate), { off: ["r1t"], statuses: {} });
  });

  it("в адаптер уходят только допустимые отметки (ядро записи по QR)", () => {
    const schema = { ...fridgeForm, fields: [...fridgeForm.fields, { type: "text" as const, key: "comment", label: "Комментарий" }] };
    const marks = resolveFillMarks(schema, ["t_a", "t_b#2", "comment", "nope"], { t_a: "service", comment: "repair", "t_b#2": "x" });
    assert.deepEqual(marks.statuses, { t_a: "service" });
    assert.deepEqual(Array.from(marks.offKeys), ["t_b#2"]);
    assert.deepEqual(resolveFillMarks(null, ["t_a"], { t_a: "repair" }), { offKeys: new Set(), statuses: {} });
  });

  it("экран «Записано» называет отметки, скрипт держит одну отметку на поле и помнит выбор в черновике", () => {
    const html = renderResult({ mode: "updated", documentTitle: "Журнал", employeeName: "Иванова", timeLabel: "18:31", addMoreHref: null, statusCount: 2 });
    assert.match(html, /Отмечено «Обслуживание» или «Ремонт»: 2\. В журнале вместо температуры «обсл» или «рем»\./);
    assert.doesNotMatch(renderResult({ mode: "updated", documentTitle: "Журнал", employeeName: "Иванова", timeLabel: "18:31", addMoreHref: null }), /Обслуживание/);
    assert.match(QR_FILL_JS, /t\.name\.indexOf\("status:"\)===0/);
    assert.match(QR_FILL_JS, /if\(t\.checked&&x!==t\) x\.checked=false;/);
    assert.match(QR_FILL_JS, /"repair":"Ремонт — в журнал «рем», норма не проверяется"/);
    assert.match(QR_FILL_JS, /if\(el\.type==="radio"\)\{ if\(el\.checked\)\{ v\[el\.name\]=el\.value;/);
  });
});

describe("journal-fill-html: хаб «Все журналы»", () => {
  it("объектный журнал — с подписью, обычный — без", () => {
    const html = renderHub([
      { code: "hygiene", name: "Гигиенический журнал", href: "/h" },
      { code: "cold_equipment_control", name: "Холодильники", href: "/c", note: "Статус за сегодня · записывают по наклейке на объекте" },
    ]);
    assert.match(html, /Холодильники<small>Статус за сегодня · записывают по наклейке на объекте<\/small>/);
    assert.match(html, /Гигиенический журнал<\/span>/);
  });
});
