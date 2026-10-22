import assert from "node:assert/strict";
import test from "node:test";
import { defaultSdcConfig } from "@/lib/sanitary-day-checklist-document";
import { sanitationPdfCopy, sanitationSdcValue, sanitationProcedure, sanitationDefault, sanitationRole, sanitationUnboundResponsible, sanitationQuantity, sanitationQuantityTotal } from "./sanitation-pest-pdf-presentation";

test("sanitary built-ins require absent original fields and matching module defaults", () => {
  const defaults = defaultSdcConfig();
  for (const locale of ["ru", "en", "uz"] as const) {
    const t = sanitationPdfCopy(locale), item = defaults.items[0], zone = defaults.zones[0];
    assert.equal(sanitationSdcValue("items", item.text, item.id, 0, {}, locale), t("item0"));
    assert.equal(sanitationSdcValue("zones", zone.name, zone.id, 0, {}, locale), t("zone0"));
    for (const source of [{ items: defaults.items }, { items: [] }, { items: null }]) assert.equal(sanitationSdcValue("items", item.text, item.id, 0, source, locale), item.text);
    assert.equal(sanitationSdcValue("items", item.text, "custom-id", 0, {}, locale), item.text);
    assert.equal(sanitationSdcValue("items", "CUSTOM ITEM", item.id, 0, {}, locale), "CUSTOM ITEM");
    assert.equal(sanitationProcedure({ id: "disinfection", label: "Дезинфекция" }, {}, locale), t("disinfection"));
    assert.equal(sanitationProcedure({ id: "disinfection", label: "Дезинфекция" }, { procedures: [] }, locale), "Дезинфекция");
    assert.equal(sanitationDefault("1 раз в сутки", {}, "controlFrequency", "glassFrequency", locale), t("glassFrequency"));
    assert.equal(sanitationDefault("1 раз в сутки", { controlFrequency: "1 раз в сутки" }, "controlFrequency", "glassFrequency", locale), "1 раз в сутки");
  }
});
test("explicit custom job titles, even identical labels, and unknown values remain original", () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    assert.equal(sanitationRole("Управляющий", { role: "manager" }, locale), sanitationPdfCopy(locale)("manager"));
    assert.equal(sanitationRole("Управляющий", { role: "manager", positionTitle: "Управляющий" }, locale), "Управляющий");
    assert.equal(sanitationRole("Управляющий", undefined, locale), "Управляющий");
    assert.equal(sanitationProcedure({ id: "constructor", label: "CUSTOM" }, {}, locale), "CUSTOM");
    assert.equal(sanitationUnboundResponsible("Сотрудник", { id: "r", userId: "missing" }, { responsibles: [{ id: "r", userId: "missing" }] }, locale), sanitationPdfCopy(locale)("employee"));
    assert.equal(sanitationUnboundResponsible("Сотрудник", { id: "r", userId: "missing" }, { responsibles: [{ id: "r", userId: "missing", title: "Сотрудник" }] }, locale), "Сотрудник");
  }
});
test("quantity display retains zero/sign/precision/unit aggregation semantics", () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const t = sanitationPdfCopy(locale);
    assert.equal(sanitationQuantity(0, "kg", locale), "");
    assert.equal(sanitationQuantity(-2.851, "kg", locale), "-2.851 " + t("kg"));
    assert.equal(sanitationQuantityTotal([{ quantity: 1.125, unit: "l" }, { quantity: 2, unit: "l" }, { quantity: -1, unit: "kg" }, { quantity: 2, unit: "bottle" }], locale), "3.125 " + t("l") + " · 2 " + t("bottle"));
    assert.equal(sanitationQuantityTotal([{ quantity: 0, unit: "l" }], locale), "—");
  }
});
