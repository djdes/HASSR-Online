import test from "node:test";
import assert from "node:assert/strict";
import { getAuditPlanDefaultConfig } from "@/lib/audit-plan-document";
import { getDefaultAuditProtocolConfig } from "@/lib/audit-protocol-document";
import { auditApproverRole, auditApprovalDate, auditDefault, auditPlanValue, auditProtocolSection, auditSignatureValue, auditTraceTitle } from "./audit-traceability-pdf-presentation";

test("audit defaults require original field absence; identical custom and unknown content stay literal", () => {
  const plan = getAuditPlanDefaultConfig();
  const protocol = getDefaultAuditProtocolConfig();
  for (const locale of ["en", "uz"] as const) {
    assert.notEqual(auditPlanValue("rows", plan.rows[0], {}, locale), plan.rows[0].text);
    assert.equal(auditPlanValue("rows", plan.rows[0], { rows: [] }, locale), plan.rows[0].text);
    assert.equal(auditPlanValue("rows", plan.rows[0], { rows: [plan.rows[0]] }, locale), plan.rows[0].text);
    assert.equal(auditPlanValue("rows", { ...plan.rows[0], id: "__proto__" }, {}, locale), plan.rows[0].text);
    assert.equal(auditPlanValue("rows", { ...plan.rows[0], text: "constructor" }, {}, locale), "constructor");
    assert.notEqual(auditProtocolSection(protocol.sections[0].title, 0, {}, locale), protocol.sections[0].title);
    assert.equal(auditProtocolSection(protocol.sections[0].title, 0, { sections: null }, locale), protocol.sections[0].title);
    assert.equal(auditSignatureValue("Главный аудитор", 0, "leadAuditor", { signatures: [] }, locale), "Главный аудитор");
    assert.equal(auditSignatureValue("Главный аудитор", 1, "leadAuditor", {}, locale), "Главный аудитор");
    assert.equal(auditDefault("Производственный участок", { auditedObject: "Производственный участок" }, "auditedObject", "objectDefault", locale), "Производственный участок");
  }
});

test("traceability title precedence proves raw config origin without translating explicit labels", () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    assert.equal(auditTraceTitle("Журнал прослеживаемости продукции", "CUSTOM TITLE", {}, locale), "CUSTOM TITLE");
    assert.equal(auditTraceTitle("Журнал прослеживаемости продукции", "CUSTOM TITLE", { documentTitle: "" }, locale), "Журнал прослеживаемости продукции");
    assert.equal(auditTraceTitle("CUSTOM CONFIG", "CUSTOM TITLE", { documentTitle: "CUSTOM CONFIG" }, locale), "CUSTOM CONFIG");
    assert.equal(auditTraceTitle("Журнал прослеживаемости продукции", "Журнал прослеживаемости продукции", {}, locale), "Журнал прослеживаемости продукции");
  }
});

test("audit approver role uses existing live fallback only and date parsing retains calendar", () => {
  const config = { ...getAuditPlanDefaultConfig(), approveEmployeeId: "person" };
  for (const locale of ["en", "uz"] as const) {
    assert.notEqual(auditApproverRole("Управляющий", config, {}, [{ id: "person", name: "USER", role: "manager" }], locale), "Управляющий");
    assert.equal(auditApproverRole("Управляющий", config, {}, [{ id: "person", name: "USER", role: "manager", positionTitle: "Управляющий" }], locale), "Управляющий");
    assert.equal(auditApproverRole("Управляющий", config, { approveRole: "Управляющий" }, [], locale), "Управляющий");
    assert.equal(auditApprovalDate("CUSTOM DATE", locale), "CUSTOM DATE");
    assert.match(auditApprovalDate("2026-01-15", locale), /2026/);
    assert.match(auditApprovalDate("2026-01-15", locale), /15/);
  }
  assert.equal(auditApprovalDate("2026-01-15"), "« 15 » января 2026 г.");
});
