import assert from "node:assert/strict";
import { test } from "node:test";

import { loadMessages } from "@/i18n/messages";
import type { Locale } from "@/i18n/locales";
import type { SchemaPresentationMessages } from "@/lib/task-fill-schema-presentation";
import { presentNoEventsReason, presentTaskFillSchema } from "@/lib/task-fill-schema-presentation";
import type { TaskFormField, TaskFormSchema } from "@/lib/tasksflow-adapters/task-form";
import { buildFormFromConfig, prefillColdEquipmentForm } from "@/lib/tasksflow-adapters/cold-equipment";
import { setClimatePrefilledNotice } from "@/lib/tasksflow-adapters/climate";
import type { ColdEquipmentDocumentConfig } from "@/lib/cold-equipment-document";

async function messages(locale: Locale): Promise<SchemaPresentationMessages> {
  return await loadMessages(locale);
}

test("schema presentation translates built-in labels while preserving values and custom fields", async () => {
  const source: TaskFormSchema = {
    intro: "Employee name, keep this personalized intro",
    fields: [
      {
        type: "number",
        key: "room-temp",
        label: "Kitchen — t° · норма 2…6",
        sourceLabel: "Kitchen — t° · норма 2…6",
        presentationSource: "adapter",
        presentationKey: "dynamic.climateTemperatureWithRange",
        presentationValues: { room: "Kitchen", min: 2, max: 6 },
        normalRange: { min: 2, max: 6 },
        min: -40,
        max: 60,
        unit: "°C",
        required: true,
      },
      {
        type: "select",
        key: "organoleptic",
        label: "Органолептическая оценка",
        presentationSource: "adapter",
        options: [
          { value: "Отлично", label: "Отлично", presentationKey: "options.finishedProduct.organoleptic.dish.0" },
          { value: "Organization custom grade", label: "Organization custom grade" },
        ],
        defaultValue: "Отлично",
      },
      {
        type: "text",
        key: "comment",
        label: "Customer-defined comment label",
        sourceLabel: "Customer-defined comment label",
        presentationSource: "template",
      },
    ],
    pipeline: [{ id: "same-as-built-in", title: "Custom step title", sourceTitle: "Audit source title", detail: "Custom step detail" }],
  };

  for (const locale of ["ru", "en", "uz"] as const) {
    const presented = presentTaskFillSchema(source, "climate_control", locale, await messages(locale));
    assert.notEqual(presented, source);
    assert.equal(presented.intro, source.intro);
    const temperature = presented.fields[0];
    assert.equal(temperature?.type, "number");
    if (temperature?.type !== "number") throw new Error("Expected number field");
    assert.equal(temperature.label, locale === "ru"
      ? "Kitchen — температура (°C), норма 2…6"
      : locale === "en"
        ? "Kitchen — temperature (°C), target range 2–6"
        : "Kitchen — harorat (°C), me’yor 2–6");
    assert.deepEqual(temperature.normalRange, { min: 2, max: 6 });
    assert.equal(temperature.min, -40);
    assert.equal(temperature.max, 60);

    const grades = presented.fields[1];
    assert.equal(grades?.type, "select");
    if (grades?.type !== "select") throw new Error("Expected select field");
    assert.equal(grades.options[0]?.value, "Отлично");
    assert.equal(grades.options[0]?.label, locale === "ru" ? "Отлично" : locale === "en" ? "Excellent" : "A’lo");
    assert.equal(grades.options[1]?.label, "Organization custom grade");
    assert.equal(grades.defaultValue, "Отлично");

    assert.equal(presented.fields[2]?.label, "Customer-defined comment label");
    assert.equal(presented.pipeline?.[0]?.title, "Custom step title");
    assert.equal(presented.pipeline?.[0]?.sourceTitle, "Audit source title");
  }
  assert.equal(source.fields[0]?.label, "Kitchen — t° · норма 2…6");
});

test("no-events labels localize only built-in reasons scoped to that journal code", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const catalog = await messages(locale);
    const closed = presentNoEventsReason("Заведение закрыто", "acceptance", locale, catalog);
    assert.equal(closed.value, "Заведение закрыто");
    assert.equal(closed.label, locale === "ru" ? "Заведение закрыто" : locale === "en" ? "The establishment was closed" : "Muassasa yopiq edi");

    const copiedToWrongCode = presentNoEventsReason("Фритюр не использовался", "acceptance", locale, catalog);
    assert.deepEqual(copiedToWrongCode, { value: "Фритюр не использовался", label: "Фритюр не использовался" });

    const custom = presentNoEventsReason("Другая причина от организации", "acceptance", locale, catalog);
    assert.deepEqual(custom, { value: "Другая причина от организации", label: "Другая причина от организации" });
  }
});

test("dynamic intro uses explicit presence state and preserves a literal employee name 'none'", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const catalog = await messages(locale);
    const named: TaskFormSchema = {
      intro: "fallback",
      introPresentationKey: "dynamic.climateIntro",
      introPresentationValues: { employeeName: "none", hasEmployee: "yes" },
      fields: [],
    };
    const rendered = presentTaskFillSchema(named, "climate_control", locale, catalog).intro ?? "";
    assert.match(rendered, /^none[,\.]/);
    assert.ok(!rendered.includes("undefined"));

    const unnamed = presentTaskFillSchema({
      ...named,
      introPresentationValues: { employeeName: "", hasEmployee: "no" },
    }, "climate_control", locale, catalog).intro ?? "";
    assert.ok(!unnamed.includes("undefined"));
    assert.ok(!unnamed.startsWith("none"));
  }
});

test("template placeholders translate only when the stored placeholder is the canonical built-in", async () => {
  const russian = await messages("ru");
  const canonical: { label?: string; placeholder?: string } | undefined = russian.taskFillSchema.fields?.incoming_control?.productName;
  assert.ok(canonical?.label);
  assert.ok(canonical?.placeholder);

  for (const locale of ["ru", "en", "uz"] as const) {
    const catalog = await messages(locale);
    const customText = "CUSTOM organization placeholder Otkir";
    const custom: TaskFormField = presentTaskFillSchema({
      fields: [{
        type: "text",
        key: "productName",
        label: canonical.label,
        placeholder: customText,
        presentationSource: "template",
      }],
    }, "incoming_control", locale, catalog).fields[0];
    assert.equal(custom?.label, locale === "ru" ? canonical.label : catalog.taskFillSchema.fields?.incoming_control?.productName?.label);
    assert.equal(custom?.type === "text" ? custom.placeholder : undefined, customText);

    const builtin: TaskFormField = presentTaskFillSchema({
      fields: [{
        type: "text",
        key: "productName",
        label: canonical.label,
        placeholder: canonical.placeholder,
        presentationSource: "template",
      }],
    }, "incoming_control", locale, catalog).fields[0];
    assert.equal(builtin?.type === "text" ? builtin.placeholder : undefined, catalog.taskFillSchema.fields?.incoming_control?.productName?.placeholder);
  }
});

test("sanitation, maintenance, and both cleaning presentation families use the canonical catalog", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const catalog = await messages(locale);
    const cleaning = presentTaskFillSchema({
      intro: "source intro",
      introPresentationKey: "dynamic.cleaning.roomIntro",
      introPresentationValues: { type: "general", room: "Kitchen A", roomKind: "custom", hasDetergent: "yes", detergent: "Soap X" },
      fields: [{ type: "boolean", key: "confirmed", label: "source label", presentationKey: "dynamic.cleaning.kindLabel", presentationValues: { type: "general" } }],
      pipeline: [{ id: "step-1", title: "source title", detail: "source detail", titlePresentationKey: "dynamic.sanitationDay.floor", detailPresentationKey: "dynamic.sanitationDay.stepCount", detailPresentationValues: { step: 1, total: 8 } }],
      submitLabel: "source submit",
      submitPresentationKey: "dynamic.equipmentMaintenance.submit",
    }, "cleaning", locale, catalog);
    assert.match(cleaning.intro ?? "", /Kitchen A/);
    assert.match(cleaning.intro ?? "", /Soap X/);
    assert.match(cleaning.fields[0]?.label ?? "", /Deep cleaning|Генеральная|Umumiy tozalash/i);
    assert.match(cleaning.pipeline?.[0]?.title ?? "", /[Ff]loor|[Пп]ола|[Pp]ol/);
    assert.match(cleaning.pipeline?.[0]?.detail ?? "", /1/);
    assert.notEqual(cleaning.submitLabel, "source submit");

    const pairMode = presentTaskFillSchema({
      intro: "source",
      introPresentationKey: "dynamic.cleaning.todayCount",
      introPresentationValues: { count: 3 },
      fields: [{ type: "boolean", key: "room-1", label: "source", presentationKey: "dynamic.cleaning.kindRoomLabel", presentationValues: { type: "current", room: "Kitchen B", roomKind: "custom" } }],
    }, "cleaning", locale, catalog);
    assert.match(pairMode.intro ?? "", /3/);
    assert.match(pairMode.fields[0]?.label ?? "", /Kitchen B/);

    const maintenance = presentTaskFillSchema({
      intro: "source",
      introPresentationKey: "dynamic.equipmentMaintenance.intro",
      introPresentationValues: { equipment: "Mixer 7", type: "B" },
      fields: [],
      pipeline: [{ id: "step-1", title: "source", detail: "source", titlePresentationKey: "dynamic.equipmentMaintenance.disconnect", detailPresentationKey: "dynamic.equipmentMaintenance.stepCount", detailPresentationValues: { step: 1, total: 7 } }],
    }, "equipment_maintenance", locale, catalog);
    assert.match(maintenance.intro ?? "", /Mixer 7/);
    assert.match(maintenance.pipeline?.[0]?.title ?? "", /equipment|оборудование|uskun/i);
    assert.match(maintenance.pipeline?.[0]?.detail ?? "", /7/);

    const sanitation = presentTaskFillSchema({
      intro: "source",
      introPresentationKey: "dynamic.sanitationDay.deepIntro",
      introPresentationValues: { room: "Kitchen C", hasDate: "yes", date: new Date("2026-10-15T12:00:00.000Z") },
      fields: [],
      pipeline: [{ id: "step-1", title: "source", detail: "source", titlePresentationKey: "dynamic.sanitationDay.floor", detailPresentationKey: "dynamic.sanitationDay.deepStepDetail", detailPresentationValues: { step: 1, total: 8 } }],
      submitLabel: "source",
      submitPresentationKey: "dynamic.sanitationDay.submit",
    }, "sanitation_day", locale, catalog);
    assert.match(sanitation.intro ?? "", /Kitchen C/);
    assert.match(sanitation.pipeline?.[0]?.detail ?? "", /1/);
    assert.notEqual(sanitation.submitLabel, "source");
  }
});

test("prefilled climate and cold-equipment notices use canonical localized messages", async () => {
  const coldConfig: ColdEquipmentDocumentConfig = {
    skipWeekends: false,
    equipment: [{ id: "cold-1", sourceEquipmentId: null, name: "Freezer A", min: -20, max: -18 }],
  };
  for (const locale of ["ru", "en", "uz"] as const) {
    const catalog = await messages(locale);
    const cold = buildFormFromConfig(coldConfig, null);
    prefillColdEquipmentForm(cold, coldConfig, [{ responsibleTitle: null, temperatures: { "cold-1": -19 } }]);
    const coldPresented = presentTaskFillSchema(cold, "cold_equipment_control", locale, catalog);
    assert.match(coldPresented.notice ?? "", /1/);
    assert.match(coldPresented.notice ?? "", locale === "ru" ? /записано/ : locale === "en" ? /recorded/ : /qayd/);

    const climate: TaskFormSchema = { fields: [], notice: "legacy source notice" };
    setClimatePrefilledNotice(climate, "10:00", 1);
    const climatePresented = presentTaskFillSchema(climate, "climate_control", locale, catalog);
    assert.match(climatePresented.notice ?? "", /10:00/);
    assert.notEqual(climatePresented.notice, "legacy source notice");
  }
});
