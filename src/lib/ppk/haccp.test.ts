import test from "node:test";
import assert from "node:assert/strict";

import {
  PPK_SIGNIFICANCE_THRESHOLD,
  TEAM_ROLE_DUTIES,
  decisionSuggestion,
  hazardRisk,
  isSignificantHazard,
  nextControlNumber,
  policyTemplate,
} from "./haccp";

test("риск = вероятность × тяжесть", () => {
  assert.equal(hazardRisk(2, 3), 6);
  assert.equal(hazardRisk(4, 4), 16);
});

test("порог значимости — 6, значения 1..4", () => {
  assert.equal(PPK_SIGNIFICANCE_THRESHOLD, 6);
  assert.equal(isSignificantHazard(2, 3), true);
  assert.equal(isSignificantHazard(3, 2), true);
  assert.equal(isSignificantHazard(1, 4), false);
  assert.equal(isSignificantHazard(2, 2), false);
});

test("дерево решений: q1 «нет» → не ККТ", () => {
  assert.equal(decisionSuggestion({ q1: false, q2: null, q3: null, q4: null }), "none");
  assert.equal(decisionSuggestion({ q1: false, q2: true, q3: true, q4: true }), "none");
});

test("дерево решений: q2 «да» → ККТ", () => {
  assert.equal(decisionSuggestion({ q1: true, q2: true, q3: null, q4: null }), "ccp");
});

test("дерево решений: q3 «нет» → ПРП", () => {
  assert.equal(decisionSuggestion({ q1: true, q2: false, q3: false, q4: null }), "prp");
});

test("дерево решений: q4 «да» → ОПП, q4 «нет» → ККТ", () => {
  assert.equal(decisionSuggestion({ q1: true, q2: false, q3: true, q4: true }), "oprp");
  assert.equal(decisionSuggestion({ q1: true, q2: false, q3: true, q4: false }), "ccp");
});

test("дерево решений: нужного ответа ещё нет → null", () => {
  assert.equal(decisionSuggestion({ q1: null, q2: null, q3: null, q4: null }), null);
  assert.equal(decisionSuggestion({ q1: true, q2: null, q3: null, q4: null }), null);
  assert.equal(decisionSuggestion({ q1: true, q2: false, q3: null, q4: null }), null);
  assert.equal(decisionSuggestion({ q1: true, q2: false, q3: true, q4: null }), null);
});

test("номера ККТ и ОПП — максимум + 1 по своему префиксу", () => {
  assert.equal(nextControlNumber([], "ccp"), "ККТ-1");
  assert.equal(nextControlNumber(["ККТ-1", "ККТ-3"], "ccp"), "ККТ-4");
  assert.equal(nextControlNumber(["ОПП-7", "ККТ-1"], "ccp"), "ККТ-2");
  assert.equal(nextControlNumber(["ККТ-2", "ОПП-5"], "oprp"), "ОПП-6");
  assert.equal(nextControlNumber(["ККТ-9"], "oprp"), "ОПП-1");
});

test("роли группы имеют обязанности по-русски", () => {
  for (const role of ["leader", "deputy", "member", "secretary"] as const) {
    assert.ok(TEAM_ROLE_DUTIES[role].length > 20, role);
  }
});

test("политика содержит название организации и 6–8 абзацев", () => {
  const text = policyTemplate("ООО «Вкусно»");
  assert.ok(text.includes("ООО «Вкусно»"));
  const paragraphs = text.split("\n\n").filter((p) => p.trim().length > 0);
  assert.ok(paragraphs.length >= 6 && paragraphs.length <= 8, String(paragraphs.length));
  assert.ok(text.includes("ТР ТС 021/2011"));
});
