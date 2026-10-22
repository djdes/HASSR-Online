import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SharedDocumentBadge } from "../components/journals/shared-document-badge";
import {
  SCAN_HEADING_KEYS, scanDateLabelKey, scanDisplayText, scanHeadingKey,
  scanResponsibleLabel, scanResponsibleLabelKey, type ScanDisplayKey, type ScanTranslate,
} from "./scan-journal-presentation";

test("scan official aliases bind exact existing canonical title messages in all locales", () => {
  for (const locale of ["ru", "en", "uz"]) {
    const catalog = JSON.parse(readFileSync(new URL(`../i18n/messages/${locale}.json`, import.meta.url), "utf8"));
    for (const [code, canonical] of Object.entries({ audit_plan_scan: "audit_plan", audit_report_scan: "audit_report", audit_protocol_scan: "audit_protocol", metal_impurity_scan: "metal_impurity" })) {
      assert.equal(catalog.journals.names[code], catalog.journals.names[canonical]);
      assert.equal(scanHeadingKey(code), `journals.names.${code}`);
    }
  }
  for (const raw of ["auditplan", "audit_report", "AUDIT_PLAN_SCAN", " audit_plan_scan", "audit_plan_scan ", "__proto__", "constructor", "unknown"]) {
    assert.equal(scanHeadingKey(raw), undefined);
  }
});

test("only explicit known metadata keys translate; raw custom-identical names remain raw", () => {
  const calls: string[] = [];
  const t: ScanTranslate = (key) => { calls.push(key); return "localized:" + key; };
  for (const raw of ["План-программа внутренних аудитов", "Должность \"Утверждаю\"", "Ответственный", "RAW/custom", "", "\u0000"]) {
    assert.equal(scanDisplayText(raw, undefined, t), raw);
    assert.equal(scanDisplayText(raw, "unknown.key" as ScanDisplayKey, t), raw);
  }
  assert.deepEqual(calls, []);
  assert.equal(scanDisplayText("RAW config title", SCAN_HEADING_KEYS.audit_plan_scan, t), "localized:journals.names.audit_plan_scan");
  assert.deepEqual(calls, ["journals.names.audit_plan_scan"]);
  assert.equal(scanResponsibleLabel("Ответственный", undefined, t), "Ответственный");
  assert.equal(scanResponsibleLabel("RAW/custom role", undefined, t), "RAW/custom role");
  for (const value of [undefined, null, ""]) assert.equal(scanResponsibleLabel(value, undefined, t), "localized:journalScan.metadata.responsible");
});

test("date and role display keys match each exact configured branch without raw string lookup", () => {
  for (const code of Object.keys(SCAN_HEADING_KEYS)) {
    assert.equal(scanDateLabelKey(code, false), "journalScan.metadata.period");
    assert.equal(scanDateLabelKey(code, true), code === "metal_impurity_scan" ? "journalScan.metadata.startDate" : "journalScan.metadata.documentDate");
  }
  assert.equal(scanDateLabelKey("unknown", true), undefined);
  assert.equal(scanDateLabelKey("unknown", false), "journalScan.metadata.period");
  assert.equal(scanResponsibleLabelKey("audit_plan_scan"), "journalScan.metadata.approverPosition");
  assert.equal(scanResponsibleLabelKey("metal_impurity_scan"), "journalScan.metadata.responsible");
  assert.equal(scanResponsibleLabelKey("audit_report_scan"), undefined);
  assert.equal(scanResponsibleLabelKey("audit_protocol_scan"), undefined);
  assert.equal(scanResponsibleLabelKey("auditplan"), undefined);
});

test("shared badge optional copy preserves old Russian defaults and falsy early return without a provider", () => {
  let reads = 0;
  const copy = { get label() { reads++; return "Shared"; }, get title() { reads++; return "Visible at every location"; } };
  for (const shared of [false, undefined, null, 0, ""] as unknown as Array<boolean | undefined>) {
    assert.equal(renderToStaticMarkup(SharedDocumentBadge({ shared, copy })), "");
  }
  assert.equal(reads, 0);
  const original = renderToStaticMarkup(SharedDocumentBadge({ shared: true }));
  assert.match(original, /title="Документ без точки: виден на каждой точке организации"/u);
  assert.match(original, />Общий<\/span>/u);
  assert.ok(original.includes('class="ml-2 inline-flex shrink-0 items-center rounded-full bg-[#f5f6ff] px-2 py-0.5 align-middle text-[11px] font-medium text-[#3848c7]"'));
  const translated = renderToStaticMarkup(SharedDocumentBadge({ shared: true, copy }));
  assert.equal(reads, 2);
  assert.match(translated, /title="Visible at every location"/u);
  assert.match(translated, />Shared<\/span>/u);
  assert.equal(translated.replace('title="Visible at every location"', 'title="Документ без точки: виден на каждой точке организации"').replace('>Shared</span>', '>Общий</span>'), original);
});
