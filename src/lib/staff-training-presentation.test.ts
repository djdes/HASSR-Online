import assert from "node:assert/strict";
import { test } from "node:test";
import { USER_ROLE_LABELS } from "@/lib/user-roles";
import { buildStaffTrainingRoleDisplay, presentStaffTrainingRole, presentStaffTrainingStaffOption, presentStaffTrainingStartDate, staffTrainingServerRevision } from "./staff-training-presentation";

const copy = (key: "manager" | "head_chef" | "cook" | "waiter") => `translated:${key}`;

test("only descriptor-proven role fallbacks are translated; custom-identical positions block collisions", () => {
  const fallback = { id: "a", name: "Employee", role: "cook" };
  const display = buildStaffTrainingRoleDisplay([fallback]);
  assert.equal(presentStaffTrainingRole("Повар", display, copy), "translated:cook");
  assert.equal(presentStaffTrainingRole("My role", display, copy), "My role");
  assert.equal(presentStaffTrainingStaffOption("Повар - Employee", fallback, display, copy, "unnamed"), "translated:cook - Employee");
  const custom = { id: "b", name: "Other", role: "waiter", jobPosition: { name: "Повар" } };
  const blocked = buildStaffTrainingRoleDisplay([fallback, custom]);
  assert.equal(presentStaffTrainingRole("Повар", blocked, copy), "Повар");
  assert.equal(presentStaffTrainingStaffOption("Повар - Employee", fallback, blocked, copy, "unnamed"), "Повар - Employee");
});

test("presentation never invokes custom getters, and native labels remain raw for exotic users", () => {
  let reads = 0;
  const user = { id: "a", name: "Employee", get role() { reads++; return "cook"; } };
  const display = buildStaffTrainingRoleDisplay([user]);
  assert.equal(reads, 0);
  assert.equal(presentStaffTrainingRole("Повар", display, copy), "Повар");
  assert.equal(presentStaffTrainingStaffOption("Повар - Employee", user, display, copy, "unnamed"), "Повар - Employee");
  assert.equal(reads, 0);
});

test("unnamed fallback is translated by source fields while custom-identical employee names remain verbatim", () => {
  const unnamed = { id: "a", name: "", role: "cook" };
  const named = { id: "b", name: "без имени", role: "cook" };
  const display = buildStaffTrainingRoleDisplay([unnamed, named]);
  assert.equal(presentStaffTrainingStaffOption("Повар - без имени", unnamed, display, copy, "unnamed"), "translated:cook - unnamed");
  assert.equal(presentStaffTrainingStaffOption("Повар - без имени", named, display, copy, "unnamed"), "translated:cook - без имени");
});

test("server revisions retain equivalent serialized values and distinguish real config and removed-row changes", () => {
  const data = { rows: [{ id: "a", topic: "Принципы ХАССП" }], showSignatureField: false };
  const revision = staffTrainingServerRevision(data);
  assert.equal(staffTrainingServerRevision(JSON.parse(JSON.stringify(data))), revision);
  assert.equal(staffTrainingServerRevision({ showSignatureField: false, rows: [{ topic: data.rows[0].topic, id: "a" }] }), revision);
  assert.notEqual(staffTrainingServerRevision({ ...data, rows: [] }), revision);
  assert.notEqual(staffTrainingServerRevision({ ...data, rows: [{ id: "a", topic: "New topic" }] }), revision);
  let reads = 0;
  assert.equal(staffTrainingServerRevision({ get rows() { reads++; return []; } }), undefined);
  assert.equal(reads, 0);
  assert.equal(staffTrainingServerRevision({ rows: [], toJSON() { throw new Error("must not run"); } }), undefined);
});

test("localized display metadata never changes a list editing revision", () => {
  const fields = ["id", "title", "dateFrom", "status", "config"];
  const data = { id: "a", title: "Custom", dateFrom: "2026-10-21", status: "active", config: { rows: [] }, startedAtLabel: "21-10-2026" };
  assert.equal(staffTrainingServerRevision(data, fields), staffTrainingServerRevision({ ...data, startedAtLabel: "21/10/2026" }, fields));
  assert.notEqual(staffTrainingServerRevision(data, fields), staffTrainingServerRevision({ ...data, title: "Changed" }, fields));
});

test("start-date presentation keeps the original chosen day and unsupported labels", () => {
  assert.equal(presentStaffTrainingStartDate("21-10-2026", "ru"), "21-10-2026");
  assert.equal(presentStaffTrainingStartDate("21-10-2026", "en"), "21/10/2026");
  assert.equal(presentStaffTrainingStartDate("21-10-2026", "uz"), "21/10/2026");
  assert.equal(presentStaffTrainingStartDate("custom-date", "en"), "custom-date");
});

test("legacy role codes and native missing-role defaults are translated without changing raw source", () => {
  const legacy = { id: "legacy", name: "Legacy", role: "technologist" };
  const missing = { id: "missing", name: "Missing" };
  const display = buildStaffTrainingRoleDisplay([legacy, missing]);
  assert.equal(presentStaffTrainingRole(USER_ROLE_LABELS.head_chef, display, copy), "translated:head_chef");
  assert.equal(presentStaffTrainingRole(USER_ROLE_LABELS.cook, display, copy), "translated:cook");
  assert.equal(legacy.role, "technologist");
  assert.equal("role" in missing, false);
});
