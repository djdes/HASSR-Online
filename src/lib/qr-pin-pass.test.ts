import assert from "node:assert/strict";
import test from "node:test";

process.env.EQUIPMENT_QR_TOKEN_SECRET ||= "test-secret-for-qr-pin-pass-0123456789";

import {
  mintQrPass,
  newQrFlowId,
  qrPassClearCookie,
  qrPassCookieName,
  qrPassSetCookie,
  qrPinFingerprint,
  readQrPass,
  verifyQrPass,
  QR_PASS_MAX_AGE_SEC,
  QR_PASS_TTL_MS,
} from "@/lib/qr-pin-pass";

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

/**
 * Наклейки объектов (2026-09-23): пропуск на 30 минут в cookie организации,
 * F5 и соседняя наклейка — без PIN. Сброс PIN руководителем гасит пропуск:
 * в подписи — отпечаток текущего хэша PIN.
 */
test("срок пропуска — 30 минут", () => {
  assert.equal(QR_PASS_TTL_MS, 30 * 60 * 1000);
  assert.equal(QR_PASS_MAX_AGE_SEC, 1800);
});

test("отпечаток PIN: короткий, без точек, меняется вместе с хэшем", () => {
  const a = qrPinFingerprint("$2a$10$hashA");
  assert.match(a, /^[A-Za-z0-9_-]{8}$/);
  assert.equal(a, qrPinFingerprint("$2a$10$hashA"));
  assert.notEqual(a, qrPinFingerprint("$2a$10$hashB"));
  assert.equal(qrPinFingerprint(null), "");
});

test("пропуск с отпечатком PIN: старый PIN — не действует", () => {
  const pinFp = qrPinFingerprint("hash-old");
  const pass = mintQrPass({ employeeId: "emp1", orgId: "org1", flow: "any", pinFp, now });
  assert.equal(verifyQrPass(pass, { employeeId: "emp1", orgId: "org1", flow: "any", pinFp, now }), true);
  assert.equal(verifyQrPass(pass, { employeeId: "emp1", orgId: "org1", flow: "any", pinFp: qrPinFingerprint("hash-new"), now }), false);
  // Пропуск без отпечатка там, где отпечаток требуется, — не действует.
  const legacy = mintQrPass({ employeeId: "emp1", orgId: "org1", flow: "any", now });
  assert.equal(verifyQrPass(legacy, { employeeId: "emp1", orgId: "org1", flow: "any", pinFp, now }), false);
  // Подмена отпечатка ломает подпись.
  const forged = pass.replace(`.${pinFp}.`, `.${qrPinFingerprint("hash-new")}.`);
  assert.equal(verifyQrPass(forged, { employeeId: "emp1", orgId: "org1", flow: "any", pinFp: qrPinFingerprint("hash-new"), now }), false);
});

test("cookie пропуска: имя на организацию, HttpOnly, SameSite=Lax, 30 минут", () => {
  assert.equal(qrPassCookieName("org1"), "wesetup.qr.pass.org1");
  const set = qrPassSetCookie("org1", "VALUE", { secure: true });
  assert.match(set, /^wesetup\.qr\.pass\.org1=VALUE; /);
  assert.match(set, /Path=\//);
  assert.match(set, /Max-Age=1800/);
  assert.match(set, /HttpOnly/);
  assert.match(set, /SameSite=Lax/);
  assert.match(set, /Secure/);
  assert.doesNotMatch(qrPassSetCookie("org1", "V", { secure: false }), /Secure/);
  assert.match(qrPassClearCookie("org1", { secure: false }), /^wesetup\.qr\.pass\.org1=; Path=\/; Max-Age=0/);
});

test("readQrPass: своя организация, flow any, в сроке, подпись цела", () => {
  const pinFp = qrPinFingerprint("h");
  const pass = mintQrPass({ employeeId: "emp1", orgId: "org1", flow: "any", pinFp, now });
  assert.deepEqual(readQrPass("org1", pass, now + 60_000), { employeeId: "emp1", pinFp });
  assert.equal(readQrPass("org2", pass, now), null, "пропуск одной организации не открывает другую");
  assert.equal(readQrPass("org1", pass, now + QR_PASS_TTL_MS + 1), null);
  assert.equal(readQrPass("org1", `${pass}x`, now), null);
  assert.equal(readQrPass("org1", mintQrPass({ employeeId: "emp1", orgId: "org1", flow: "flowA", pinFp, now }), now), null, "пропуск визита журнала — не пропуск наклеек");
  assert.equal(readQrPass("org1", mintQrPass({ employeeId: "emp1", orgId: "org1", flow: "any", now }), now), null, "без отпечатка PIN — не принимаем");
  assert.equal(readQrPass("org1", undefined, now), null);
});
