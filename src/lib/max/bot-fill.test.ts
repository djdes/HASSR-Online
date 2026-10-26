import assert from "node:assert/strict";
import { test } from "node:test";
import type { TaskFormSchema } from "@/lib/tasksflow-adapters/task-form";
import { answerFill, defaultFor, fillSubmission, formatFillValue, parseFieldText, renderFill, type FillContext } from "./bot-fill";
import { parseWizardPayload, type MaxFillState } from "./bot-state";

const hygiene: TaskFormSchema = {
  fields: [
    { type: "select", key: "status", label: "Статус", required: true, options: [{ value: "healthy", label: "Здоров" }, { value: "sick_leave", label: "Больничный" }] },
    { type: "boolean", key: "temperatureAbove37", label: "Температура выше 37 °C" },
  ],
};

const fridge: TaskFormSchema = {
  fields: [
    { type: "number", key: "t1", label: "Холодильник №1 — t° · норма 2…6", unit: "°C", min: -40, max: 30, required: true },
    { type: "text", key: "comment", label: "Комментарий", maxLength: 200 },
  ],
};

function ctx(form: TaskFormSchema, extra: Partial<FillContext> = {}): FillContext {
  return {
    form,
    hints: {},
    suggestions: {},
    stamp: { date: "26.10.2026", time: "14:05" },
    todayKey: "2026-10-26",
    employeeName: "Анна Петрова",
    timeAgo: (minutes) => (minutes === 15 ? "13:50" : minutes === 30 ? "13:35" : minutes === 45 ? "13:20" : "13:05"),
    ...extra,
  };
}

function state(extra: Partial<MaxFillState> = {}): MaxFillState {
  return {
    kind: "fill", id: "abc123", seq: 4, orgId: "org1", code: "hygiene", name: "Гигиенический журнал",
    phase: "field", documentId: "doc1", documentTitle: "Октябрь 2026", rowKey: "employee-u1", rowLabel: null,
    choices: [], step: 0, keys: [], values: {}, off: [], correction: null, picks: [], editing: false, notice: null,
    ...extra,
  };
}

function payloads(view: { buttons: Array<Array<{ type: string; text: string } & Record<string, unknown>>> }) {
  return view.buttons.flat().map((button) => (button.type === "callback" ? String(button.payload) : `link:${String(button.url)}`));
}

test("select step shows options as buttons and a pick moves to the next field", () => {
  const first = renderFill(state({ documentTitle: "Гигиенический журнал — Октябрь 2026" }), ctx(hygiene));
  assert.match(first.view.text, /^✍️ Гигиенический журнал\nОктябрь 2026\n/);
  assert.match(first.view.text, /Шаг 1 из 2/);
  assert.match(first.view.text, /Статус/);
  assert.deepEqual(first.state.picks, ["healthy", "sick_leave"]);
  const texts = first.view.buttons.flat().map((button) => button.text);
  assert.ok(texts.includes("Здоров"));
  assert.ok(texts.includes("✖ Отменить"));
  assert.ok(!texts.includes("‹ Назад"), "no back on the first step");
  assert.ok(payloads(first.view).every((payload) => parseWizardPayload(payload)?.seq === 4));

  const picked = answerFill(first.state, ctx(hygiene), { kind: "pick", index: 0 });
  assert.equal(picked.ok, true);
  if (!picked.ok) return;
  assert.equal(picked.state.step, 1);
  assert.equal(picked.state.values.status, "healthy");

  const second = renderFill(picked.state, ctx(hygiene));
  assert.match(second.view.text, /Шаг 2 из 2/);
  assert.deepEqual(second.state.picks, [true, false]);
  const done = answerFill(second.state, ctx(hygiene), { kind: "pick", index: 1 });
  assert.equal(done.ok && done.state.phase, "confirm");
});

test("confirm screen lists answers with save, edit and cancel", () => {
  const confirm = renderFill(state({ phase: "confirm", step: 1, values: { status: "healthy", temperatureAbove37: false } }), ctx(hygiene));
  assert.match(confirm.view.text, /Статус: Здоров/);
  assert.match(confirm.view.text, /Температура выше 37 °C: Нет/);
  assert.match(confirm.view.text, /за 26\.10\.2026/);
  const actions = payloads(confirm.view).map((payload) => parseWizardPayload(payload)?.action);
  assert.deepEqual(actions, ["save", "edit", "cancel"]);
});

test("edit returns to the chosen field and back to confirm after the answer", () => {
  const base = state({ phase: "confirm", values: { status: "healthy", temperatureAbove37: false } });
  const editList = answerFill(base, ctx(hygiene), { kind: "edit" });
  assert.equal(editList.ok && editList.state.phase, "edit");
  if (!editList.ok) return;
  const field = answerFill(editList.state, ctx(hygiene), { kind: "editField", index: 0 });
  assert.ok(field.ok && field.state.editing && field.state.step === 0 && field.state.phase === "field");
  if (!field.ok) return;
  const rendered = renderFill(field.state, ctx(hygiene));
  assert.ok(rendered.view.buttons.flat().some((button) => button.text === "‹ К проверке"));
  const answered = answerFill(rendered.state, ctx(hygiene), { kind: "text", text: "2" });
  assert.ok(answered.ok && answered.state.phase === "confirm" && !answered.state.editing);
  assert.equal(answered.ok && answered.state.values.status, "sick_leave");
});

test("back walks to the previous field and from confirm to the last field", () => {
  const back = answerFill(state({ step: 1 }), ctx(hygiene), { kind: "back" });
  assert.equal(back.ok && back.state.step, 0);
  const fromConfirm = answerFill(state({ phase: "confirm" }), ctx(hygiene), { kind: "back" });
  assert.ok(fromConfirm.ok && fromConfirm.state.phase === "field" && fromConfirm.state.step === 1);
});

test("object reading: norm, quick values and «Выключено» button", () => {
  const view = renderFill(state({ code: "x", name: "Журнал" }), ctx(fridge));
  assert.match(view.view.text, /Холодильник №1 — температура/);
  assert.match(view.view.text, /Норма: 2…6 °C/);
  assert.deepEqual(view.state.picks, [2, 4, 6]);
  assert.ok(view.view.buttons.flat().some((button) => button.text === "Выключено"));
  const off = answerFill(view.state, ctx(fridge), { kind: "off" });
  assert.ok(off.ok);
  if (!off.ok) return;
  assert.deepEqual(off.state.off, ["t1"]);
  assert.equal(formatFillValue(fridge.fields[0], off.state, {}), "Выключено");
  assert.deepEqual(fillSubmission(off.state, fridge).off, ["t1"]);
});

test("out-of-norm reading asks what was done once and sends the correction", () => {
  const typed = answerFill(state(), ctx(fridge), { kind: "text", text: "12" });
  assert.ok(typed.ok && typed.state.phase === "correction");
  if (!typed.ok) return;
  const prompt = renderFill(typed.state, ctx(fridge));
  assert.match(prompt.view.text, /Что вы сделали/);
  assert.equal(prompt.state.picks[0], "Повторю через 30 минут.");
  const corrected = answerFill(prompt.state, ctx(fridge), { kind: "pick", index: 1 });
  assert.ok(corrected.ok && corrected.state.phase === "field" && corrected.state.step === 1);
  if (!corrected.ok) return;
  assert.equal(corrected.state.correction, "Сообщил руководителю");
  assert.match(formatFillValue(fridge.fields[0], corrected.state, {}), /12 °C ⚠️ вне нормы/);
  assert.equal(fillSubmission(corrected.state, fridge).correction, "Сообщил руководителю");

  // Исправили на норму — комментарий к отклонению больше не уходит.
  const fixed = answerFill({ ...corrected.state, step: 0, editing: true }, ctx(fridge), { kind: "text", text: "4,5" });
  assert.ok(fixed.ok && fixed.state.phase === "confirm");
  if (!fixed.ok) return;
  assert.equal(fixed.state.values.t1, 4.5);
  assert.equal(fillSubmission(fixed.state, fridge).correction, null);
});

test("optional text can be skipped and required text cannot be empty", () => {
  const view = renderFill(state({ step: 1, values: { t1: 4 } }), ctx(fridge));
  assert.equal(view.state.picks.at(-1), null);
  assert.ok(view.view.buttons.flat().some((button) => button.text === "Пропустить"));
  const skipped = answerFill(view.state, ctx(fridge), { kind: "pick", index: view.state.picks.length - 1 });
  assert.ok(skipped.ok && skipped.state.phase === "confirm" && skipped.state.values.comment === null);
  const required = parseFieldText({ type: "text", key: "n", label: "Наименование", required: true }, "   ", ctx(fridge));
  assert.equal(required.ok, false);
});

test("typed answers are parsed per field type", () => {
  const c = ctx(fridge);
  const number = { type: "number" as const, key: "n", label: "Вес", min: 0, max: 100 };
  assert.deepEqual(parseFieldText(number, "4,5", c), { ok: true, value: 4.5 });
  assert.deepEqual(parseFieldText(number, "12 кг", c).ok, false);
  assert.deepEqual(parseFieldText({ ...number, min: -40 }, "−18", c), { ok: true, value: -18 });
  assert.equal(parseFieldText(number, "abc", c).ok, false);
  assert.match(String((parseFieldText(number, "120", c) as { error: string }).error), /больше 100/);
  const date = { type: "date" as const, key: "d", label: "Дата" };
  assert.deepEqual(parseFieldText(date, "вчера", c), { ok: true, value: "2026-10-25" });
  assert.deepEqual(parseFieldText(date, "1.11.2026", c), { ok: true, value: "2026-11-01" });
  assert.deepEqual(parseFieldText(date, "05.10", c), { ok: true, value: "2026-10-05" });
  assert.equal(parseFieldText(date, "31.02.2026", c).ok, false);
  const time = { type: "time" as const, key: "t", label: "Время" };
  assert.deepEqual(parseFieldText(time, "930", c), { ok: true, value: "09:30" });
  assert.deepEqual(parseFieldText(time, "сейчас", c), { ok: true, value: "14:05" });
  assert.equal(parseFieldText(time, "25:00", c).ok, false);
  const yes = { type: "boolean" as const, key: "b", label: "Сделано" };
  assert.deepEqual(parseFieldText(yes, "Да", c), { ok: true, value: true });
  assert.deepEqual(parseFieldText(hygiene.fields[0], "здоров", c), { ok: true, value: "healthy" });
  assert.equal(parseFieldText({ type: "photo", key: "p", label: "Фото" }, "x", c).ok, false);
});

test("time, date and signature steps offer one-tap buttons", () => {
  const form: TaskFormSchema = {
    fields: [
      { type: "time", key: "at", label: "Время", required: true },
      { type: "date", key: "on", label: "Дата", required: true },
      { type: "signature", key: "sig", label: "Подпись", required: true },
    ],
  };
  const time = renderFill(state(), ctx(form));
  assert.deepEqual(time.state.picks, ["14:05", "13:50", "13:35", "13:20", "13:05"]);
  const withDefault = renderFill(state(), ctx(form, { hints: { timeDefaults: { at: 30 } } }));
  assert.deepEqual(withDefault.state.picks, ["14:05", "13:50", "13:35", "13:20", "13:05"]);
  assert.ok(withDefault.view.buttons.flat().some((button) => button.text === "−30 мин ✓"), "default marked, not duplicated");
  const today = renderFill(state(), ctx({ fields: [{ ...form.fields[0], defaultValue: "09:15" } as typeof form.fields[0]] }));
  assert.equal(today.state.picks[0], "09:15");
  assert.equal(today.view.buttons.flat()[0].text, "Оставить: 09:15");
  const date = renderFill(state({ step: 1 }), ctx(form));
  assert.deepEqual(date.state.picks, ["2026-10-26", "2026-10-25"]);
  const signature = renderFill(state({ step: 2 }), ctx(form));
  assert.deepEqual(signature.state.picks, ["Анна Петрова"]);
  assert.ok(signature.view.buttons.flat().some((button) => button.text === "✍️ Подписать: Анна Петрова"));
});

test("defaults: adapter values first, then journal hints; offered as «Оставить»", () => {
  const field = { type: "number" as const, key: "w", label: "Вес", defaultValue: "3,5" };
  assert.equal(defaultFor(field, ctx(fridge)), 3.5);
  assert.equal(defaultFor({ type: "select", key: "status", label: "Статус", options: [] }, ctx(fridge, { hints: { defaults: { status: "healthy" } } })), "healthy");
  assert.equal(defaultFor({ type: "time", key: "productionTime", label: "Время" }, ctx(fridge, { hints: { timeDefaults: { productionTime: 30 } } })), "13:35");
  const view = renderFill(state(), ctx({ fields: [field] }));
  assert.equal(view.state.picks[0], 3.5);
  assert.ok(view.view.buttons.flat()[0].text.startsWith("Оставить: 3,5"));
});

test("stale or wrong presses never change the answer", () => {
  const rendered = renderFill(state(), ctx(hygiene));
  assert.equal(answerFill(rendered.state, ctx(hygiene), { kind: "pick", index: 9 }).ok, false);
  assert.equal(answerFill(rendered.state, ctx(hygiene), { kind: "off" }).ok, false);
  assert.equal(answerFill(state({ phase: "confirm" }), ctx(hygiene), { kind: "text", text: "Здоров" }).ok, false);
});

test("instructions from the journal pipeline are shown on the first step; empty forms go to confirm", () => {
  const withSteps: TaskFormSchema = { ...fridge, pipeline: [{ id: "s1", title: "Откройте дверцу", detail: "" }, { id: "s2", title: "Посмотрите термометр", detail: "" }] };
  assert.match(renderFill(state(), ctx(withSteps)).view.text, /Что сделать:\n1\. Откройте дверцу\n2\. Посмотрите термометр/);
  const tick = renderFill(state(), ctx({ fields: [], pipeline: [{ id: "s1", title: "Помойте пол", detail: "" }] }));
  assert.equal(tick.state.phase, "confirm");
  assert.match(tick.view.text, /Помойте пол/);
  assert.ok(tick.view.buttons.flat().some((button) => button.text === "✅ Отметить выполнение"));
});

test("document and row choices are buttons with cancel", () => {
  const view = renderFill(state({ phase: "document", choices: [{ id: "d1", label: "Кухня" }, { id: "d2", label: "Бар" }] }), ctx(hygiene));
  assert.match(view.view.text, /Выберите документ/);
  assert.deepEqual(payloads(view.view).map((payload) => parseWizardPayload(payload)?.action), ["doc", "doc", "cancel"]);
});

test("submission keeps only current form fields", () => {
  const submission = fillSubmission(state({ values: { status: "healthy", stray: "x" }, off: ["gone"] }), hygiene);
  assert.deepEqual(submission, { values: { status: "healthy" }, off: [], correction: null });
});
