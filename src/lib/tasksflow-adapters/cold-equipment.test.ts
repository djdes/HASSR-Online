import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ColdEquipmentDocumentConfig, ColdEquipmentEntryData } from "@/lib/cold-equipment-document";

import { buildFormFromConfig, mergeColdEquipmentFormValues, prefillColdEquipmentForm } from "./cold-equipment";
import {
  OFF_NOTE_EQUIPMENT,
  TASK_FORM_CORRECTION_KEY,
  TASK_FORM_OFF_KEY,
  TASK_FORM_STATUS_KEY,
  encodeStatusMarks,
  parseStatusMarks,
} from "./task-form";

/**
 * «Обслуживание»/«Ремонт» в общей QR-форме журнала холодильников
 * (2026-09-25): те же данные записи, что и с наклейки — `statuses[замер]`,
 * температура `null`, — чтобы в документе и в печати было «обсл»/«рем».
 */
const config: ColdEquipmentDocumentConfig = {
  skipWeekends: false,
  equipment: [
    { id: "a", sourceEquipmentId: null, name: "Холодильник №1", min: 2, max: 6 },
    // Два замера в день: ключ второго — `b#2`.
    { id: "b", sourceEquipmentId: null, name: "Морозильник", min: -20, max: -18, readingMode: "twice" },
  ],
};

const empty: ColdEquipmentEntryData = { responsibleTitle: null, temperatures: {} };

describe("cold-equipment adapter: «Обслуживание»/«Ремонт» из общей QR-формы", () => {
  it("форма даёт кнопки «Обслуживание»/«Ремонт» у каждого замера холодильника", () => {
    const form = buildFormFromConfig(config, null);
    assert.deepEqual(
      form.fields.map((field) => field.key),
      ["t_a", "t_b", "t_b#2"]
    );
    assert.deepEqual(form.statusFields, ["t_a", "t_b", "t_b#2"]);
  });

  it("служебный ключ `__status`: туда и обратно, мусор пропускается", () => {
    const encoded = encodeStatusMarks({ "t_b#2": "repair", t_a: "service" });
    assert.deepEqual(Object.fromEntries(parseStatusMarks({ [TASK_FORM_STATUS_KEY]: encoded })), { "t_b#2": "repair", t_a: "service" });
    assert.equal(parseStatusMarks({ [TASK_FORM_STATUS_KEY]: "{не json" }).size, 0);
    assert.deepEqual(Object.fromEntries(parseStatusMarks({ [TASK_FORM_STATUS_KEY]: JSON.stringify({ t_a: "broken", t_b: "рем" }) })), { t_b: "repair" });
    assert.equal(parseStatusMarks({}).size, 0);
  });

  it("статус пишется как с наклейки: statuses[замер], температура null, норма не проверяется", () => {
    const data = mergeColdEquipmentFormValues({
      config,
      prior: { responsibleTitle: "Повар", temperatures: { a: 4 } },
      values: {
        t_a: "",
        t_b: -19,
        "t_b#2": "",
        [TASK_FORM_STATUS_KEY]: encodeStatusMarks({ t_a: "repair", "t_b#2": "service" }),
        [TASK_FORM_CORRECTION_KEY]: "Повторю через 30 минут.",
      },
    });
    assert.equal(data.responsibleTitle, "Повар");
    assert.deepEqual(data.statuses, { a: "repair", "b#2": "service" });
    assert.equal(data.temperatures.a, null);
    assert.equal(data.temperatures["b#2"], null);
    assert.equal(data.temperatures.b, -19);
    // Отметка — не отклонение: комментария к ней нет.
    assert.equal(data.corrections, undefined);
  });

  it("«Выключено» и отметка не смешиваются", () => {
    // Было «Выключено» — выбрали «Ремонт»: пометка «Выключено» снимается.
    const toRepair = mergeColdEquipmentFormValues({
      config,
      prior: { ...empty, temperatures: { a: null }, corrections: { a: OFF_NOTE_EQUIPMENT } },
      values: { t_a: "", [TASK_FORM_STATUS_KEY]: encodeStatusMarks({ t_a: "repair" }) },
    });
    assert.deepEqual(toRepair.statuses, { a: "repair" });
    assert.equal(toRepair.corrections, undefined);

    // Было «рем» (наклейка) — отметили «Выключено»: отметка снимается.
    const toOff = mergeColdEquipmentFormValues({
      config,
      prior: { ...empty, temperatures: { a: null }, statuses: { a: "repair" } },
      values: { t_a: "", [TASK_FORM_OFF_KEY]: "t_a" },
    });
    assert.equal(toOff.statuses, undefined);
    assert.deepEqual(toOff.corrections, { a: OFF_NOTE_EQUIPMENT });
    assert.equal(toOff.temperatures.a, null);

    // Пришли обе (форма без скриптов) — остаётся отметка, без «Выключено».
    const both = mergeColdEquipmentFormValues({
      config,
      prior: empty,
      values: { t_a: "", [TASK_FORM_OFF_KEY]: "t_a", [TASK_FORM_STATUS_KEY]: encodeStatusMarks({ t_a: "service" }) },
    });
    assert.deepEqual(both.statuses, { a: "service" });
    assert.equal(both.corrections, undefined);
  });

  it("пустое поле не снимает отметку с наклейки, число — снимает", () => {
    const prior: ColdEquipmentEntryData = { ...empty, temperatures: { a: null, b: null }, statuses: { a: "service", b: "repair" } };
    // Поле пустое или его нет в форме (TasksFlow) — «обсл»/«рем» остаются.
    const kept = mergeColdEquipmentFormValues({ config, prior, values: { t_a: "", t_b: null } });
    assert.deepEqual(kept.statuses, { a: "service", b: "repair" });
    assert.deepEqual(mergeColdEquipmentFormValues({ config, prior, values: {} }).statuses, { a: "service", b: "repair" });
    // Ввели температуру — отметка снимается, как на наклейке.
    const replaced = mergeColdEquipmentFormValues({ config, prior, values: { t_a: 3.5, t_b: "" } });
    assert.equal(replaced.temperatures.a, 3.5);
    assert.deepEqual(replaced.statuses, { b: "repair" });
  });

  it("комментарий к прежнему отклонению при отметке не пропадает", () => {
    const data = mergeColdEquipmentFormValues({
      config,
      prior: { ...empty, temperatures: { a: 12 }, corrections: { a: "Вызвал мастера" } },
      values: { t_a: "", [TASK_FORM_STATUS_KEY]: encodeStatusMarks({ t_a: "repair" }) },
    });
    assert.deepEqual(data.statuses, { a: "repair" });
    assert.deepEqual(data.corrections, { a: "Вызвал мастера" });
  });

  it("повторное открытие формы: «обсл»/«рем» за сегодня выбраны, своё число важнее чужой отметки", () => {
    const form = buildFormFromConfig(config, null);
    prefillColdEquipmentForm(form, config, [
      // своя запись: число у «a»
      { ...empty, temperatures: { a: 4 } },
      // чужая (наклейка): «рем» у «a» и «b», «Выключено» у второго замера «b»
      { ...empty, temperatures: { a: null, b: null, "b#2": null }, statuses: { a: "repair", b: "repair" }, corrections: { "b#2": OFF_NOTE_EQUIPMENT } },
    ]);
    const byKey = Object.fromEntries(form.fields.map((field) => [field.key, (field as { defaultValue?: unknown }).defaultValue]));
    assert.equal(byKey.t_a, 4);
    assert.deepEqual(form.prefilledStatuses, { t_b: "repair" });
    assert.deepEqual(form.prefilledOff, ["t_b#2"]);
    assert.match(form.notice ?? "", /Сегодня уже записано: 3 из 3/);
  });
});
