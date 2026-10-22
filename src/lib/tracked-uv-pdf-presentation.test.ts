import test from "node:test";
import assert from "node:assert/strict";
import { trackedPdfBoolean, trackedPdfTitle, uvPdfFreeText, uvPdfObject } from "./tracked-uv-pdf-presentation";

test("UV free-text defaults require absent original fields and preserve explicit identical/invalid source", () => {
  for (const locale of ["en", "uz"] as const) {
    assert.notEqual(uvPdfFreeText("санитарно-показательный", {}, "microorganismType", locale), "санитарно-показательный");
    assert.notEqual(uvPdfFreeText("1 раз(а) в смену", { spec: {} }, "controlFrequency", locale), "1 раз в смену");
    for (const value of ["1 раз(а) в смену", "", null, undefined]) assert.equal(uvPdfFreeText("1 раз(а) в смену", { spec: { controlFrequency: value } }, "controlFrequency", locale), "1 раз в смену");
    assert.equal(uvPdfFreeText("1 раз(а) в смену", { spec: null }, "controlFrequency", locale), "1 раз в смену");
    assert.equal(uvPdfFreeText("2 раз(а) в смену", { spec: { controlFrequency: "2 раз(а) в смену" } }, "controlFrequency", locale), "2 раза в смену");
    assert.equal(uvPdfFreeText("constructor", {}, "microorganismType", locale), "constructor");
    assert.equal(uvPdfFreeText("__proto__", {}, "controlFrequency", locale), "__proto__");
  }
});

test("tracked title/custom values and boolean semantics do not depend on translated text", () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    assert.equal(trackedPdfTitle("Журнал отгрузки", "shipment", locale), "Журнал отгрузки");
    assert.equal(trackedPdfBoolean(null, "", locale), "");
    assert.equal(trackedPdfBoolean("", "", locale), "");
    const yes=trackedPdfBoolean(true,"Да",locale),no=trackedPdfBoolean(false,"Нет",locale);
    assert.equal(trackedPdfBoolean("true","Да",locale),yes);
    assert.equal(trackedPdfBoolean("yes","Да",locale),yes);
    for(const value of [0,1,"false","unknown",{}])assert.equal(trackedPdfBoolean(value,"Нет",locale),no);
    assert.equal(uvPdfObject({disinfectionAir:false,disinfectionSurface:false},locale),"—");
    assert.ok(trackedPdfTitle("","__proto__",locale));
  }
  assert.equal(uvPdfObject({disinfectionAir:true,disinfectionSurface:true}),"воздух и поверхность");
});
