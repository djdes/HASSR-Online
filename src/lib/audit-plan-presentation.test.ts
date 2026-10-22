import assert from "node:assert/strict";
import { test } from "node:test";
import { getAuditPlanDefaultConfig, getAuditPlanPrintDateLabel, normalizeAuditPlanConfig } from "./audit-plan-document";
import { USER_ROLE_LABELS } from "./user-roles";
import {
  auditPlanConfigWithDisplay, auditPlanOrganizationFallback, buildAuditPlanRoleDisplay,
  captureAuditPlanProvenance, captureAuditPlanTitle, completeAuditPlanProvenance,
  presentAuditPlanApprovalDate, presentAuditPlanApproverTitle, presentAuditPlanItem,
  presentAuditPlanRoleLabel, presentAuditPlanTitle, type AuditPlanPdfCopy,
} from "./audit-plan-presentation";

const date = new Date("2026-10-20T12:00:00.000Z");
const options = { organizationName: "RAW/Org", users: [], date };
const copy: AuditPlanPdfCopy = (...args) => JSON.stringify({ key: args[0], values: args[1] });

test("route sidecar preserves one normalizer and its raw getter order and exact config", () => {
  const calls: string[] = [];
  const makeRaw = () => ({
    get columns() { calls.push("columns"); return undefined; },
    get sections() { calls.push("sections"); return undefined; },
    get rows() { calls.push("rows"); return undefined; },
  });
  const baseline = normalizeAuditPlanConfig(makeRaw(), options);
  const baselineCalls = [...calls]; calls.length = 0;
  let normalizations = 0;
  const raw = makeRaw();
  const prepared = auditPlanConfigWithDisplay(raw, value => {
    normalizations++; assert.equal(value, raw);
    return normalizeAuditPlanConfig(value, options);
  });
  assert.equal(normalizations, 1);
  assert.deepEqual(calls, baselineCalls);
  assert.deepEqual(prepared.config, baseline);
  assert.equal(prepared.displayProvenance.rows, false);
  assert.equal(JSON.stringify(prepared.config).includes("displayProvenance"), false);
});

test("only before-normalization factory provenance translates standard rows and actual-organization columns", () => {
  const result = auditPlanConfigWithDisplay({}, raw => normalizeAuditPlanConfig(raw, options));
  const before = JSON.stringify(result.config);
  assert.equal(result.config.rows.length, 23);
  assert.equal(result.config.sections.length, 3);
  assert.equal(result.config.columns.length, 2);
  assert.equal(presentAuditPlanItem("rows", result.config.rows[0], result.displayProvenance, copy), copy("planRow0"));
  assert.equal(presentAuditPlanItem("sections", result.config.sections[2], result.displayProvenance, copy), copy("planSection2"));
  assert.equal(presentAuditPlanItem("columns", result.config.columns[1], result.displayProvenance, copy), copy("planColumn", { number: "2", organization: "RAW/Org" }));
  assert.equal(JSON.stringify(result.config), before);
  assert.equal(presentAuditPlanItem("rows", { ...result.config.rows[0], text: "RAW edit" }, result.displayProvenance, copy), "RAW edit");
  assert.equal(presentAuditPlanItem("rows", { ...result.config.rows[0], id: "RAW id" }, result.displayProvenance, copy), result.config.rows[0].text);
});

test("explicit persisted default-identical arrays, empty arrays and invalid fields stay raw", () => {
  const raw = getAuditPlanDefaultConfig(options);
  const result = auditPlanConfigWithDisplay(raw, value => normalizeAuditPlanConfig(value, options));
  assert.equal(presentAuditPlanItem("rows", result.config.rows[0], result.displayProvenance, copy), raw.rows[0].text);
  assert.equal(presentAuditPlanItem("sections", result.config.sections[0], result.displayProvenance, copy), raw.sections[0].title);
  assert.equal(presentAuditPlanItem("columns", result.config.columns[0], result.displayProvenance, copy), raw.columns[0].title);
  const empty = auditPlanConfigWithDisplay({ columns: [], sections: [], rows: [] }, value => normalizeAuditPlanConfig(value, options));
  assert.deepEqual([empty.config.columns, empty.config.sections, empty.config.rows], [[], [], []]);
  const invalid = auditPlanConfigWithDisplay({ columns: null, sections: 0, rows: "RAW" }, value => normalizeAuditPlanConfig(value, options));
  assert.equal(invalid.displayProvenance.rows, false);
  assert.equal(presentAuditPlanItem("rows", invalid.config.rows[0], invalid.displayProvenance, copy), invalid.config.rows[0].text);
});

test("descriptor capture does not read accessors or infer inherited origins", () => {
  let reads = 0;
  const raw = { get rows() { reads++; return []; } };
  assert.equal(captureAuditPlanProvenance(raw).rows, false);
  assert.equal(reads, 0);
  assert.equal(captureAuditPlanProvenance(Object.create({ rows: undefined })).rows, false);
  assert.equal(auditPlanOrganizationFallback({ get name() { reads++; return ""; } }), false);
  assert.equal(reads, 0);
});

test("organization fallback localizes only a descriptor-proven falsy branch", () => {
  const config = getAuditPlanDefaultConfig({ date });
  const trueOrigin = completeAuditPlanProvenance(captureAuditPlanProvenance({}, true), config);
  const customOrigin = completeAuditPlanProvenance(captureAuditPlanProvenance({}, false), config);
  assert.equal(auditPlanOrganizationFallback({ name: "" }), true);
  assert.equal(auditPlanOrganizationFallback({ name: config.columns[0].title.slice(8) }), false);
  assert.equal(presentAuditPlanItem("columns", config.columns[0], trueOrigin, copy), copy("planColumn", { number: "1", organization: copy("organization") }));
  assert.notEqual(presentAuditPlanItem("columns", config.columns[0], customOrigin, copy), presentAuditPlanItem("columns", config.columns[0], trueOrigin, copy));
});

test("title display fallback leaves original business title and copy title list intact", () => {
  const original = "RAW/standard-identical-title";
  let fallbacks = 0;
  const missing = captureAuditPlanTitle("", () => { fallbacks++; return original; });
  const custom = captureAuditPlanTitle(original, () => { fallbacks++; return "unused"; });
  assert.equal(fallbacks, 1);
  assert.deepEqual([missing.title, custom.title], [original, original]);
  assert.equal(presentAuditPlanTitle(missing.title, missing.displayTitleMissing, "EN/default"), "EN/default");
  assert.equal(presentAuditPlanTitle(custom.title, custom.displayTitleMissing, "EN/default"), original);
  assert.deepEqual([missing.title, custom.title], [original, original]);
});

test("known role and legacy origins translate display while raw labels and roster remain intact", () => {
  const users = [{ id: "a", name: "RAW A", role: "owner" }, { id: "b", name: "RAW B", role: "technologist" }, { id: "c", name: "RAW C", role: "operator" }, { id: "d", name: "RAW D", role: "waiter" }];
  const before = JSON.stringify(users); const display = buildAuditPlanRoleDisplay(users);
  for (const role of ["manager", "head_chef", "cook", "waiter"] as const) assert.equal(presentAuditPlanRoleLabel(USER_ROLE_LABELS[role], display, copy), copy(role));
  assert.equal(presentAuditPlanRoleLabel("RAW unknown", display, copy), "RAW unknown");
  assert.equal(JSON.stringify(users), before);
});

test("custom-identical and unknown role collisions win over standard enum display", () => {
  const standard = { id: "a", name: "RAW A", role: "manager" };
  const custom = { id: "b", name: "RAW B", role: "cook", jobPosition: { name: USER_ROLE_LABELS.manager } };
  const display = buildAuditPlanRoleDisplay([standard, custom]);
  assert.equal(presentAuditPlanRoleLabel(USER_ROLE_LABELS.manager, display, copy), USER_ROLE_LABELS.manager);
  const unknown = buildAuditPlanRoleDisplay([standard, { id: "c", name: "RAW C", role: USER_ROLE_LABELS.manager }]);
  assert.equal(presentAuditPlanRoleLabel(USER_ROLE_LABELS.manager, unknown, copy), USER_ROLE_LABELS.manager);
  const freeText = buildAuditPlanRoleDisplay([standard, { id: "d", name: "RAW D", role: "waiter", positionTitle: USER_ROLE_LABELS.manager }]);
  assert.equal(presentAuditPlanRoleLabel(USER_ROLE_LABELS.manager, freeText, copy), USER_ROLE_LABELS.manager);
});

test("role provenance does not invoke user getters and conservatively preserves unproved options", () => {
  let reads = 0;
  const display = buildAuditPlanRoleDisplay([{ id: "a", role: "manager", get positionTitle() { reads++; return ""; } }]);
  assert.equal(reads, 0);
  assert.equal(presentAuditPlanRoleLabel(USER_ROLE_LABELS.manager, display, copy), USER_ROLE_LABELS.manager);
});

test("approver names/custom titles and explicit stored default-identical role keep their priority", () => {
  const config = getAuditPlanDefaultConfig(options);
  const origin = completeAuditPlanProvenance(captureAuditPlanProvenance({}), config);
  assert.equal(presentAuditPlanApproverTitle(USER_ROLE_LABELS.manager, config, [], origin, copy), copy("manager"));
  const explicit = completeAuditPlanProvenance(captureAuditPlanProvenance(config), config);
  assert.equal(presentAuditPlanApproverTitle(USER_ROLE_LABELS.manager, config, [], explicit, copy), USER_ROLE_LABELS.manager);
  const selected = { ...config, approveEmployeeId: "a" };
  assert.equal(presentAuditPlanApproverTitle(USER_ROLE_LABELS.manager, selected, [{ id: "a", role: "manager", positionTitle: USER_ROLE_LABELS.manager }], origin, copy), USER_ROLE_LABELS.manager);
});

test("approval date keeps exact Russian output and original parser fallback semantics", () => {
  for (const value of ["2026-01-15", "RAW/date", "", "2026-13-01"]) assert.equal(presentAuditPlanApprovalDate(value, "ru", copy), getAuditPlanPrintDateLabel(value));
  assert.equal(presentAuditPlanApprovalDate("RAW/date", "en", copy), "RAW/date");
  assert.equal(presentAuditPlanApprovalDate("2026-01-15", "en", copy), copy("approvalDate", { day: "15", month: "January", year: "2026" }));
  const uz = JSON.parse(presentAuditPlanApprovalDate("2026-01-15", "uz", copy));
  assert.equal(uz.key, "approvalDate"); assert.equal(uz.values.year, "2026"); assert.equal(uz.values.day, "15"); assert.ok(uz.values.month);
});
