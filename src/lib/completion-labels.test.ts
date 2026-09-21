import test from "node:test";
import assert from "node:assert/strict";

import { buildCompletionView } from "./completion-labels";
import { humanizeFetchError, isFetchNetworkError } from "./humanize-fetch-error";
import { journalIconName, looksLikeJournalCode } from "./journal-label";

/**
 * Блок «Введённые данные» на /verifications.
 *
 * Раньше он печатал `String(v)` подряд, и заведующая видела
 * «steps [object Object],[object Object]», «pipelineCompleted ✓» и
 * «skipped ✓» без причины.
 */

test("шаги раскладываются в список, а не в [object Object]", () => {
  const view = buildCompletionView({
    pipelineCompleted: true,
    steps: [
      { id: "thermometer", title: "Возьми термометр", done: true },
      { id: "record", title: "Запиши значение", done: false },
    ],
    temperature: 4,
  });
  assert.equal(view.steps.length, 2);
  assert.deepEqual(
    view.steps.map((s) => [s.title, s.done]),
    [
      ["Возьми термометр", true],
      ["Запиши значение", false],
    ]
  );
  // Служебный флаг в поля не попадает.
  assert.ok(!view.fields.some((f) => f.key === "pipelineCompleted"));
  assert.ok(!view.fields.some((f) => f.key === "steps"));
});

test("поля получают русские подписи", () => {
  const view = buildCompletionView({ temperature: 4, correctiveAction: "" });
  assert.deepEqual(view.fields, [
    { key: "temperature", label: "Температура", value: "4" },
  ]);
});

test("пропуск показывается причиной, а не галочкой", () => {
  const view = buildCompletionView({
    skipped: true,
    reason: "Поставщик не приехал",
  });
  assert.equal(view.skippedReason, "Поставщик не приехал");
  assert.deepEqual(view.fields, []);
});

test("неизвестный объект не печатается вовсе", () => {
  const view = buildCompletionView({ meta: { a: 1 }, dish: "Суп" });
  assert.deepEqual(
    view.fields.map((f) => f.key),
    ["dish"]
  );
});

/* ---------- сетевые ошибки ---------- */

test("сообщения браузера о пропаже связи заменяются русской фразой", () => {
  for (const raw of ["Failed to fetch", "NetworkError when attempting to fetch resource", "Load failed"]) {
    assert.ok(isFetchNetworkError(new Error(raw)), raw);
    assert.match(humanizeFetchError(new Error(raw)), /Нет связи с сервером/);
  }
});

test("осмысленный ответ сервера не подменяется", () => {
  assert.equal(
    humanizeFetchError(new Error("Нет доступа к этому журналу")),
    "Нет доступа к этому журналу"
  );
});

/* ---------- подписи и иконки задач ---------- */

test("служебные названия документов опознаются как код", () => {
  for (const title of ["health_check", "Проверка health_check", "E2E doc 12", ""]) {
    assert.ok(looksLikeJournalCode(title), title);
  }
});

test("человеческое название документа не трогаем", () => {
  for (const title of ["Журнал гигиены смены", "Холодильник №2 — Утро"]) {
    assert.ok(!looksLikeJournalCode(title), title);
  }
});

test("иконка подбирается по виду журнала", () => {
  assert.equal(journalIconName("cold_equipment_control"), "Thermometer");
  assert.equal(journalIconName("cleaning"), "Sparkles");
  assert.equal(journalIconName("hygiene"), "Droplets");
  assert.equal(journalIconName("health_check"), "HeartPulse");
  assert.equal(journalIconName("нечто_неизвестное"), "ClipboardList");
});
