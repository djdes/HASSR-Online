import assert from "node:assert/strict";
import test from "node:test";
import { personnelMedColumn, personnelPdfTitle, personnelPdfCopy, personnelPlanTopic, personnelPlanPosition, personnelInjectedRole, personnelRole, personnelMonth, personnelApprovalDate } from "./personnel-maintenance-pdf-presentation";

test("defaults require absent original properties; explicit identical labels remain literal", () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const t = personnelPdfCopy(locale);
    assert.equal(personnelMedColumn("examinations", "Гинеколог", {}, locale), t("exam_gynecologist"));
    for (const source of [{ examinations: ["Гинеколог"] }, { examinations: [] }, { examinations: null }]) assert.equal(personnelMedColumn("examinations", "Гинеколог", source, locale), "Гинеколог");
    assert.equal(personnelPlanTopic({ id: "kkt", name: "ККТ" }, {}, locale), t("kkt"));
    assert.equal(personnelPlanTopic({ id: "kkt", name: "ККТ" }, { topics: [] }, locale), "ККТ");
    assert.equal(personnelPlanPosition({ id: "row-2", positionName: "Повар" }, {}, locale), t("cook"));
    assert.equal(personnelPlanPosition({ id: "custom", positionName: "Повар" }, {}, locale), "Повар");
    assert.equal(personnelInjectedRole("Управляющий", "approveRole", {}, null, "manager", locale), t("manager"));
    assert.equal(personnelInjectedRole("Управляющий", "approveRole", { approveRole: "Управляющий" }, null, "manager", locale), "Управляющий");
    assert.equal(personnelPdfTitle("Медицинские книжки", "medTitle", locale), "Медицинские книжки");
    assert.equal(personnelPdfTitle("", "medTitle", locale), t("medTitle"));
  }
});
test("role fallback requires matched person without custom position, including identical labels", () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    assert.equal(personnelRole("Повар", { role: "cook" }, locale), personnelPdfCopy(locale)("cook"));
    assert.equal(personnelRole("Повар", { role: "cook", positionTitle: "Повар" }, locale), "Повар");
    assert.equal(personnelRole("Повар", { role: "cook", jobPosition: { name: "Повар" } }, locale), "Повар");
    assert.equal(personnelRole("Повар", undefined, locale), "Повар");
  }
});
test("calendar retains RU formatting and stable numeric date parts", () => {
  assert.equal(personnelApprovalDate("2026-01-11", 2030, "ORIGINAL", "ru"), "ORIGINAL");
  assert.equal(personnelApprovalDate("2026-01-11", 2030, "ORIGINAL", "en"), "11 January 2026");
  assert.equal(personnelMonth("jan", "en"), "Jan");
  assert.equal(personnelMonth("jan", "uz"), "Yan");
});
