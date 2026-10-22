import test from "node:test";
import assert from "node:assert/strict";
import { specializedDefault, specializedHygieneMark, specializedHygienePosition, specializedPdfTitle } from "./specialized-hygiene-glass-pdf-presentation";

test("specialized PDF defaults distinguish absent fields from Russian-identical and invalid custom fields", () => {
  for (const locale of ["en", "uz"] as const) {
    assert.notEqual(specializedDefault("Управляющий", {}, "responsibleTitle", "manager", locale), "Управляющий");
    for (const value of ["Управляющий", "", null, undefined]) assert.equal(specializedDefault("Управляющий", { responsibleTitle: value }, "responsibleTitle", "manager", locale), "Управляющий");
    assert.equal(specializedDefault("constructor", {}, "responsibleTitle", "manager", locale), "constructor");
    assert.equal(specializedPdfTitle("Перечень изделий", "glass", locale), "Перечень изделий");
    assert.equal(specializedPdfTitle("Гигиенический журнал (сотрудники)", "hygiene", locale), "Гигиенический журнал (сотрудники)");
  }
});

test("hygiene position preserves explicit demo-email custom content and unknown roles", () => {
  const user = { id: "u", name: "CUSTOM USER", email: "quality@haccp.local", role: "technologist" };
  for (const locale of ["ru", "en", "uz"] as const) {
    assert.equal(specializedHygienePosition({ ...user, positionTitle: "Технолог по качеству" }, locale), "Технолог по качеству");
    assert.equal(specializedHygienePosition({ ...user, positionTitle: "__proto__" }, locale), "__proto__");
    assert.equal(specializedHygienePosition({ ...user, email: "custom@example.test", role: "CUSTOM ROLE" }, locale), "CUSTOM ROLE");
    assert.equal(specializedHygieneMark("UNKNOWN MARK", locale), "UNKNOWN MARK");
    assert.equal(specializedHygieneMark("", locale), "");
  }
  assert.equal(specializedHygienePosition(user), "Технолог по качеству");
  assert.equal(specializedHygienePosition(user, "en"), "Quality technologist");
  assert.equal(specializedHygieneMark("✓"), "да");
  assert.equal(specializedHygieneMark("✗"), "нет");
  assert.equal(specializedHygieneMark("✓", "en"), "yes");
});
