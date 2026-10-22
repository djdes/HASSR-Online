import test from "node:test";
import assert from "node:assert/strict";
import {
  captureMailingDisplay,
  mailingDiagnostic,
  mailingDiagnosticFromResponse,
  parseMailingDiagnostic,
  withMailingDiagnostic,
} from "./diagnostic-presentation";

const reason = { version: 1, code: "message.subjectRequired", params: {} };

test("metadata leaves the original Error identity, own fields and prototype intact", () => {
  const error = new TypeError("raw diagnostic");
  const fields = Object.getOwnPropertyDescriptors(error);
  const prototype = Object.getPrototypeOf(error);
  assert.equal(withMailingDiagnostic(error, reason), error);
  assert.deepEqual(Object.getOwnPropertyDescriptors(error), fields);
  assert.equal(Object.getPrototypeOf(error), prototype);
  assert.equal(error.message, "raw diagnostic");
  assert.ok(error instanceof TypeError);
  assert.deepEqual(mailingDiagnostic(error), reason);
  assert.deepEqual(Reflect.ownKeys(error), Reflect.ownKeys(fields));
});

test("metadata follows only the same object and does not survive copying or JSON", () => {
  const result = withMailingDiagnostic({ ok: false, error: "legacy" }, reason);
  assert.deepEqual(result, { ok: false, error: "legacy" });
  assert.equal(mailingDiagnostic({ ...result }), null);
  assert.equal(mailingDiagnostic(JSON.parse(JSON.stringify(result))), null);
  assert.equal(mailingDiagnostic(new Error(result.error)), null);
  for (const value of [null, undefined, "legacy", 1, false, Symbol("x")]) assert.equal(mailingDiagnostic(value), null);
});

test("only the explicit validated presentation wire field reattaches metadata", () => {
  const body = JSON.parse(JSON.stringify({ error: "unchanged", presentation: reason }));
  const error = new Error(body.error);
  withMailingDiagnostic(error, mailingDiagnosticFromResponse(body));
  assert.equal(error.message, "unchanged");
  assert.deepEqual(mailingDiagnostic(error), reason);
  assert.equal(mailingDiagnosticFromResponse({ error: "message.subjectRequired" }), null);
  assert.equal(mailingDiagnosticFromResponse(Object.create({ presentation: reason })), null);
});

test("the finite protocol rejects version/code/prototype/parameter ambiguity", () => {
  const invalid = [
    null, [], {}, { ...reason, version: 2 }, { ...reason, code: "toString" },
    { ...reason, code: "__proto__" }, { ...reason, code: "delivery.failed" },
    { ...reason, params: { unwanted: 1 } }, { ...reason, extra: true },
    Object.create(reason), Object.assign(Object.create({ inherited: true }), reason),
    { ...reason, params: Object.create({ inherited: true }) },
    { version: 1, code: "message.subjectMax", params: { max: "150" } },
    { version: 1, code: "message.subjectMax", params: { max: 151 } },
    { version: 1, code: "kp.daysRange", params: { min: 0, max: 90 } },
    { version: 1, code: "kp.codeMissing", params: { code: "lower" } },
    { version: 1, code: "kp.codeMissing", params: { code: "AB" } },
    { version: 1, code: "kp.codeMissing", params: { code: "A".repeat(33) } },
    { version: 1, code: "kp.codeFormat", params: { code: "A".repeat(65) } },
    ...[-1, 600, 1.5, NaN, Infinity, "500", null].map((status) => ({ version: 1, code: "http.status", params: { status } })),
  ];
  for (const value of invalid) assert.equal(parseMailingDiagnostic(value), null);
  for (const status of [0, 200, 400, 599]) assert.deepEqual(parseMailingDiagnostic({ version: 1, code: "http.status", params: { status } }), { version: 1, code: "http.status", params: { status } });
});

test("accessors, symbols and revoked proxies cannot execute or become known reasons", () => {
  let calls = 0;
  const getter = () => { calls++; throw new Error("getter must not run"); };
  for (const key of ["version", "code", "params"]) {
    const value = { ...reason };
    Object.defineProperty(value, key, { get: getter });
    assert.equal(parseMailingDiagnostic(value), null);
  }
  assert.equal(parseMailingDiagnostic({ ...reason, params: Object.defineProperty({}, "max", { get: getter }) }), null);
  assert.equal(mailingDiagnosticFromResponse(Object.defineProperty({}, "presentation", { get: getter })), null);
  assert.equal(parseMailingDiagnostic({ ...reason, [Symbol("hidden")]: true }), null);
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  assert.equal(parseMailingDiagnostic(revoked.proxy), null);
  assert.equal(mailingDiagnosticFromResponse(revoked.proxy), null);
  assert.equal(calls, 0);
});

test("validated descriptor data is copied and immutable without freezing the source", () => {
  const input = { version: 1, code: "request.kindUnknown", params: { kind: "raw <kind>" } };
  const error = withMailingDiagnostic(new Error("raw"), input);
  const metadata = mailingDiagnostic(error);
  input.params.kind = "changed";
  assert.deepEqual(metadata, { version: 1, code: "request.kindUnknown", params: { kind: "raw <kind>" } });
  assert.ok(Object.isFrozen(metadata));
  assert.ok(Object.isFrozen(metadata?.params));
  assert.equal(Object.isFrozen(input), false);
  assert.equal(Object.isFrozen(error), false);
});

test("invalid metadata neither creates nor replaces an existing known attachment", () => {
  const error = withMailingDiagnostic(new Error("raw"), reason);
  assert.equal(withMailingDiagnostic(error, { version: 99 }), error);
  assert.deepEqual(mailingDiagnostic(error), reason);
  assert.equal(mailingDiagnostic(withMailingDiagnostic({}, { version: 99 })), null);
});

test("capture preserves template coercion exactly once including original Symbol throws", () => {
  let calls = 0;
  const value = { [Symbol.toPrimitive](hint: string) { assert.equal(hint, "string"); calls++; return "kept"; } };
  let captured: unknown;
  assert.equal(`prefix ${captureMailingDisplay(value, (display, raw) => { assert.equal(display, "kept"); captured = raw; })}`, "prefix kept");
  assert.equal(captured, value);
  assert.equal(calls, 1);
  let receives = 0;
  assert.throws(() => captureMailingDisplay(Symbol("bad"), () => { receives++; }), TypeError);
  assert.equal(receives, 0);
  const thrown = new Error("original coercion");
  assert.throws(() => captureMailingDisplay({ toString() { throw thrown; } }, () => { receives++; }), (error) => error === thrown);
});

test("the producer domains retain pre-normalized code display and fixed numeric limits", () => {
  const valid = [
    { version: 1, code: "kp.codeFormat", params: { code: "  строчный код  " } },
    { version: 1, code: "kp.codeMissing", params: { code: "A_3-XYZ" } },
    { version: 1, code: "request.scheduleTooFar", params: { days: 60 } },
    { version: 1, code: "kp.fixedLimit", params: { max: 100000 } },
    { version: 1, code: "kp.daysRange", params: { min: 1, max: 90 } },
  ];
  for (const value of valid) assert.deepEqual(parseMailingDiagnostic(value), value);
});
