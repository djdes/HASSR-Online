import assert from "node:assert/strict";
import test from "node:test";

process.env.EQUIPMENT_QR_TOKEN_SECRET ||= "test-secret-for-qr-pin-pass-0123456789";

import { mintQrPass, newQrFlowId, verifyQrPass, QR_PASS_TTL_MS } from "@/lib/qr-pin-pass";

/**
 * Пропуск после шага PIN привязан к сотруднику, организации и визиту
 * (`flow` в адресе). Новый скан плаката — новый визит, значит PIN снова:
 * «PIN вводится каждый раз», запоминается только сотрудник.
 */
const base = { employeeId: "emp1", orgId: "org1", flow: "flowA" };
const now = 1_700_000_000_000;

test("пропуск действует для своего сотрудника, организации и визита", () => {
  const pass = mintQrPass({ ...base, now });
  assert.equal(verifyQrPass(pass, { ...base, now: now + 60_000 }), true);
});

test("чужой сотрудник, организация или визит — пропуск не действует", () => {
  const pass = mintQrPass({ ...base, now });
  assert.equal(verifyQrPass(pass, { ...base, employeeId: "emp2", now }), false);
  assert.equal(verifyQrPass(pass, { ...base, orgId: "org2", now }), false);
  assert.equal(verifyQrPass(pass, { ...base, flow: "flowB", now }), false);
  assert.equal(verifyQrPass(pass, { ...base, flow: "any", now }), true);
});

test("просроченный или подделанный пропуск не действует", () => {
  const pass = mintQrPass({ ...base, now });
  assert.equal(verifyQrPass(pass, { ...base, now: now + QR_PASS_TTL_MS + 1 }), false);
  assert.equal(verifyQrPass(pass.replace("emp1", "emp2"), { ...base, employeeId: "emp2", now }), false);
  assert.equal(verifyQrPass(`${pass}x`, { ...base, now }), false);
  assert.equal(verifyQrPass(null, { ...base, now }), false);
});

test("идентификатор визита — без точек и достаточно длинный", () => {
  const flow = newQrFlowId();
  assert.match(flow, /^[A-Za-z0-9_-]{12,}$/);
  assert.notEqual(flow, newQrFlowId());
});
