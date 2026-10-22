import assert from "node:assert/strict";
import { test } from "node:test";
import { captureAuditReportTitle, presentAuditReportTitle, auditReportText, createAuditReportFailureRegistry } from "./audit-report-presentation";
import { importAuditReportFindingsFromProtocol, getDefaultAuditReportConfig, AUDIT_REPORT_DOCUMENT_TITLE } from "./audit-report-document";

test("title provenance preserves customer-identical strings and calls fallback only for falsey input", () => {
  let calls = 0;
  const fallback = () => { calls++; return AUDIT_REPORT_DOCUMENT_TITLE; };
  const custom = captureAuditReportTitle(AUDIT_REPORT_DOCUMENT_TITLE, fallback);
  assert.equal(calls, 0);
  assert.equal(presentAuditReportTitle(custom.title, custom.displayTitleMissing, "Internal audit report"), AUDIT_REPORT_DOCUMENT_TITLE);
  const empty = captureAuditReportTitle("", fallback);
  assert.equal(calls, 1);
  assert.equal(empty.title, AUDIT_REPORT_DOCUMENT_TITLE);
  assert.equal(presentAuditReportTitle(empty.title, empty.displayTitleMissing, "Ichki audit hisoboti"), "Ichki audit hisoboti");
  assert.equal(empty.title, AUDIT_REPORT_DOCUMENT_TITLE, "display must not rewrite the edit/payload value");
});

test("route capture reads source title once at the original property position", () => {
  const trace: string[] = [];
  const row = { get id() { trace.push("id"); return "d"; }, get title() { trace.push("title"); return ""; } };
  const result = { id: row.id, ...captureAuditReportTitle(row.title, () => { trace.push("fallback"); return "raw"; }), status: (trace.push("status"), "active") };
  assert.deepEqual(trace, ["id", "title", "fallback", "status"]);
  assert.deepEqual(result, { id: "d", title: "raw", displayTitleMissing: true, status: "active" });
});

test("template coercion keeps default hint, one call, Symbol failure and thrown sentinel", () => {
  const seen: string[] = [];
  const value = { [Symbol.toPrimitive](hint: string) { seen.push(hint); return "RAW <x> {name} 0012 Oʻz"; } };
  assert.equal(auditReportText(value), "RAW <x> {name} 0012 Oʻz");
  assert.deepEqual(seen, ["string"]);
  assert.throws(() => auditReportText(Symbol("raw")), TypeError);
  const sentinel = new Error("sentinel");
  assert.throws(() => auditReportText({ [Symbol.toPrimitive]() { throw sentinel; } }), error => error === sentinel);
});

test("error provenance is instance-owned identity without touching message getters", () => {
  const one = createAuditReportFailureRegistry(), two = createAuditReportFailureRegistry();
  const error = new Error("Не удалось сохранить документ");
  let reads = 0;
  Object.defineProperty(error, "message", { get() { reads++; throw new Error("do not read"); } });
  one.mark(error);
  assert.equal(one.has(error), true);assert.equal(two.has(error), false);
  assert.equal(one.has(new Error("Не удалось сохранить документ")), false);
  assert.equal(one.has("Не удалось сохранить документ"), false);assert.equal(one.has(null), false);
  assert.equal(reads, 0);
});

test("owned failure construction keeps original falsey branch, getter count, raw message and truthy object coercion", () => {
  const registry = createAuditReportFailureRegistry();
  for (const raw of [undefined, null, false, 0, ""]) {
    let reads = 0;
    const result = { get error() { reads++; return raw; } };
    const failure = result?.error;
    const error = new Error((failure || "Не удалось сохранить документ") as string);
    if (!failure) registry.mark(error);
    assert.equal(reads, 1);assert.equal(error.message, "Не удалось сохранить документ");assert.equal(registry.has(error), true);
  }
  const hints: string[] = [];
  const failure = { [Symbol.toPrimitive](hint: string) { hints.push(hint); return "custom-identical raw"; } };
  const error = new Error(failure as unknown as string || "Не удалось сохранить документ");
  assert.deepEqual(hints, ["string"]);assert.equal(registry.has(error), false);assert.equal(error.message, "custom-identical raw");
});

test("protocol presentation never alters the raw copied snapshot, note prefix or repeated import", () => {
  const source = { documentId: "protocol", title: "Протокол внутреннего аудита", displayTitleMissing: true, rows: [{ id: "r1", text: "  RAW <item>  ", note: "  note  " }, { id: "r2", text: " ", note: " " }] };
  assert.equal(presentAuditReportTitle(source.title, source.displayTitleMissing, "Internal audit record"), "Internal audit record");
  const result = importAuditReportFindingsFromProtocol(getDefaultAuditReportConfig(), source);
  assert.equal(result.added, 1);assert.equal(result.config.sourceProtocolTitle, source.title);
  assert.equal(result.config.findings[0].nonConformity, "RAW <item>\nПримечание: note");
  const again = importAuditReportFindingsFromProtocol(result.config, source);
  assert.equal(again.added, 0);assert.equal(again.skipped, 1);
  source.rows[0].text = "changed later";
  assert.equal(result.config.findings[0].nonConformity, "RAW <item>\nПримечание: note");
});
