import assert from "node:assert/strict";
import test from "node:test";
import { auditActionKey, auditActionLabel, formatAuditDate } from "./audit-presentation";

test("only own canonical action codes translate; stored unknown/custom values are literal", () => {
  const calls: string[] = [];
  const t = (key: NonNullable<ReturnType<typeof auditActionKey>>) => { calls.push(key); return `copy:${key}`; };
  for (const value of ["constructor", "__proto__", "toString", "unknown.code", "", "Промокод создан", "mailing.optin "]) {
    assert.equal(auditActionKey(value), undefined);
    assert.equal(auditActionLabel(value, t), value);
  }
  assert.deepEqual(calls, []);
  assert.equal(auditActionLabel("mailing.optin", t), "copy:actionMailingOptin");
  assert.deepEqual(calls, ["actionMailingOptin"]);
});

test("date presentation is this explicit Moscow native profile, preserving RU/EN/invalid", () => {
  for (const date of [new Date("2026-10-16T23:59:59Z"), new Date(-1), new Date(-8640000000000000), new Date(8640000000000000), new Date(NaN)]) {
    assert.equal(formatAuditDate(date, "ru"), date.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }));
    assert.equal(formatAuditDate(date, "en"), date.toLocaleString("en-GB", { timeZone: "Europe/Moscow" }));
    assert.equal(formatAuditDate(date, "uz"), date.toLocaleString(Number.isFinite(date.getTime()) ? "en-GB" : "uz-Latn-UZ", { timeZone: "Europe/Moscow" }));
  }
});
