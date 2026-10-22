import test from "node:test";
import assert from "node:assert/strict";
import {
  auditProtocolText, captureAuditProtocolConfig, captureAuditProtocolTitle,
  createAuditProtocolFailureRegistry, presentAuditProtocolTitle,
} from "./audit-protocol-presentation";
import {
  AUDIT_PROTOCOL_DOCUMENT_TITLE, fillAuditProtocolFromPlan,
  getDefaultAuditProtocolConfig, normalizeAuditProtocolConfig,
  type AuditProtocolConfig, type AuditProtocolPlanSource,
} from "./audit-protocol-document";
import { buildDocumentCopy } from "./journal-document-copy";

test("title origin is captured in one original read; identical custom titles stay raw", () => {
  let reads = 0, fallbackCalls = 0;
  const object = { get title() { reads++; return ""; } };
  const captured = captureAuditProtocolTitle(object.title, () => { fallbackCalls++; return AUDIT_PROTOCOL_DOCUMENT_TITLE; });
  assert.deepEqual(captured, { title: AUDIT_PROTOCOL_DOCUMENT_TITLE, displayTitleMissing: true });
  assert.equal(reads, 1); assert.equal(fallbackCalls, 1);
  for (const title of [AUDIT_PROTOCOL_DOCUMENT_TITLE, "Протокол внутреннего аудита — 2026", "{title}", " "]) {
    const custom = captureAuditProtocolTitle(title, () => { throw new Error("must not call"); });
    assert.equal(presentAuditProtocolTitle(custom.title, custom.displayTitleMissing, "Protocol"), title);
  }
  assert.equal(presentAuditProtocolTitle(captured.title, captured.displayTitleMissing, "Bayonnoma"), "Bayonnoma");
});

test("pre-normalization capture forwards the exact raw object once without field reads", () => {
  const order: string[] = [];
  const raw = { get basisTitle() { order.push("get"); return "CUSTOM"; } };
  const result = captureAuditProtocolConfig(raw, value => {
    order.push("normalize"); assert.equal(value, raw); return { basisTitle: value.basisTitle };
  });
  assert.deepEqual(order, ["normalize", "get"]);
  assert.deepEqual(result, { config: { basisTitle: "CUSTOM" }, displayConfigMissing: false });
  for (const missing of [null, undefined, 0, "", []]) {
    assert.equal(captureAuditProtocolConfig(missing, value => value).displayConfigMissing, true);
  }
});

test("template interpolation and unknown Error identity preserve getter/coercion semantics", () => {
  const hints: string[] = [];
  const title = { [Symbol.toPrimitive](hint: string) { hints.push(hint); return "raw"; } };
  assert.equal(auditProtocolText(title), "raw"); assert.deepEqual(hints, ["string"]);
  assert.throws(() => auditProtocolText(Symbol("raw")), TypeError);
  let reads = 0;
  const unknown = new Error("unknown");
  Object.defineProperty(unknown, "message", { get() { reads++; throw new Error("do not read"); } });
  const first = createAuditProtocolFailureRegistry(), second = createAuditProtocolFailureRegistry();
  assert.equal(first.has(unknown), false); first.mark(unknown);
  assert.equal(first.has(unknown), true); assert.equal(second.has(unknown), false);
  assert.equal(first.has("unknown"), false); assert.equal(reads, 0);
});

test("normalization keeps stored default-identical content and existing empty-signature fallback", () => {
  const raw = { documentDate: "2026-10-20", basisTitle: "Годовой план-программа внутренних аудитов",
    auditedObject: "Производственный участок", sections: [{ id: "s", title: "Общие требования СМБПП" }],
    rows: [{ id: "r", sectionId: "s", text: "{user}", note: "raw", result: "no", planRowId: "p" }],
    signatures: [{ id: "empty", name: "", role: "CUSTOM", signedAt: "2024-01-01" }],
    sourcePlanDocumentId: "plan", sourcePlanTitle: "План-программа аудитов" };
  const normalized = normalizeAuditProtocolConfig(raw);
  assert.equal(normalized.basisTitle, raw.basisTitle); assert.equal(normalized.auditedObject, raw.auditedObject);
  assert.equal(normalized.sections[0].title, raw.sections[0].title); assert.equal(normalized.rows[0].text, "{user}");
  assert.equal(normalized.rows[0].result, "no"); assert.equal(normalized.rows[0].planRowId, "p");
  assert.notEqual(normalized.signatures[0].id, "empty"); assert.equal(normalized.signatures[0].role, "Главный аудитор");
  assert.equal(normalized.sourcePlanTitle, raw.sourcePlanTitle);
});

function fixture(): AuditProtocolConfig {
  return { ...getDefaultAuditProtocolConfig(), documentDate: "2026-10-20", basisTitle: "CUSTOM basis",
    sections: [{ id: "existing", title: "  Safety  " }],
    rows: [{ id: "old", sectionId: "existing", text: "old raw", result: "no", note: "keep", planRowId: "already" }],
    signatures: [{ id: "sign", role: "CUSTOM role", name: "USER", signedAt: "2026-10-20" }] };
}

test("plan import preserves dedup/section trim-lowercase/results/raw titles and independent snapshot", () => {
  const config = fixture(); const before = JSON.stringify(config);
  const plan: AuditProtocolPlanSource = { documentId: "plan", title: "План-программа аудитов",
    sections: [{ id: "psec", title: "sAfEtY" }],
    rows: [{ id: "already", sectionId: "psec", text: "duplicate" },
      { id: "new", sectionId: "psec", text: "  copied raw  " },
      { id: "blank", sectionId: "psec", text: "  " }] };
  const result = fillAuditProtocolFromPlan(config, plan);
  assert.equal(result.addedRows, 1); assert.equal(result.skippedRows, 1);
  assert.equal(result.config.sections.length, 1); assert.equal(result.config.rows[1].sectionId, "existing");
  assert.equal(result.config.rows[1].text, "copied raw"); assert.equal(result.config.rows[1].planRowId, "new");
  assert.equal(result.config.rows[0].result, "no"); assert.equal(result.config.rows[0].note, "keep");
  assert.equal(result.config.basisTitle, "CUSTOM basis"); assert.equal(result.config.sourcePlanTitle, plan.title);
  plan.rows[1].text = "later edit"; assert.equal(result.config.rows[1].text, "copied raw");
  assert.equal(JSON.stringify(config), before);
  assert.equal(fillAuditProtocolFromPlan(result.config, plan).addedRows, 0);
});

test("copy keeps raw yearly name/structure/roles and resets only facts without mutating source", () => {
  const source = { ...fixture(), sourcePlanDocumentId: "plan", sourcePlanTitle: "raw plan", closedAt: "old" };
  const before = JSON.stringify(source);
  const copy = buildDocumentCopy({ templateCode: "audit_protocol", journalName: AUDIT_PROTOCOL_DOCUMENT_TITLE,
    sourceConfig: source, sourcePeriod: { dateFrom: "2025-03-01", dateTo: "2025-03-01" },
    today: "2026-10-20", existingTitles: [] });
  assert.equal(copy.dateFrom, "2026-01-01"); assert.equal(copy.dateTo, "2026-12-31");
  assert.ok(copy.title.includes(AUDIT_PROTOCOL_DOCUMENT_TITLE));
  const config = copy.config as typeof source;
  assert.equal(config.rows[0].text, "old raw"); assert.equal(config.rows[0].result, ""); assert.equal(config.rows[0].note, "");
  assert.equal("planRowId" in config.rows[0], false); assert.equal(config.signatures[0].role, "CUSTOM role");
  assert.equal(config.signatures[0].name, ""); assert.equal(config.signatures[0].signedAt, "");
  assert.equal("sourcePlanTitle" in config, false); assert.equal("closedAt" in config, false);
  assert.equal(JSON.stringify(source), before);
});
