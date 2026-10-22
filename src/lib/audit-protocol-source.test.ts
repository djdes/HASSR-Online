import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { captureAuditProtocolConfig } from "./audit-protocol-presentation";
import { normalizeAuditProtocolConfig } from "@/lib/audit-protocol-document";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("./audit-protocol-source.server.ts", import.meta.url), "utf8");
const mod = { exports: {} };
// The marker remains in production. Only this isolated server-module fixture stubs it.
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
  module: mod, exports: mod.exports, Object, Array, JSON, Number, Reflect, Set,
  require: (id: string) => id === "server-only" ? {} : require(id),
});
const identity = (mod.exports as { auditProtocolConfigSourceIdentity: (value: unknown) => string | undefined }).auditProtocolConfigSourceIdentity;

test("raw JSON identity covers null, partial/invalid factories, arrays and exact stored data independently of generated IDs", () => {
  for (const raw of [null, {}, [], "", 0, false,
    { basisTitle: "RAW/partial basis", auditedObject: "RAW/partial object" },
    { sections: [], signatures: [] },
    { sections: [{ title: "" }], signatures: [{ name: "" }] },
    { sections: "invalid", signatures: 12 },
  ]) {
    const before = JSON.stringify(raw);
    const first = captureAuditProtocolConfig(raw, normalizeAuditProtocolConfig, identity);
    const second = captureAuditProtocolConfig(JSON.parse(before), normalizeAuditProtocolConfig, identity);
    assert.match(first.configSourceIdentity!, /^raw-json-sha256:[a-f0-9]{64}$/);
    assert.equal(first.configSourceIdentity, second.configSourceIdentity);
    assert.notEqual(first.config.sections[0].id, second.config.sections[0].id);
    assert.notEqual(first.config.signatures[0].id, second.config.signatures[0].id);
    assert.equal(JSON.stringify(raw), before);
    assert.equal("configSourceIdentity" in first.config, false);
  }
  assert.equal(identity({ b: [1, null, "x"], a: { z: false } }), identity({ a: { z: false }, b: [1, null, "x"] }));
  const distinct = [null, {}, [], 0, "0", false, { basisTitle: "" }, { basisTitle: "Годовой план-программа внутренних аудитов" }, { sections: [] }, { signatures: [] }];
  assert.equal(new Set(distinct.map(identity)).size, distinct.length);
  assert.notEqual(identity({ rows: [{ id: "a" }, { id: "b" }] }), identity({ rows: [{ id: "b" }, { id: "a" }] }));
  assert.notEqual(identity({ sections: [{ id: "a", title: "same" }] }), identity({ sections: [{ id: "b", title: "same" }] }));
});

test("source witness adds no raw getter/toJSON/proxy reads and preserves normalize call and capture order", () => {
  const events: string[] = [];
  const raw = { get basisTitle() { events.push("basis"); return "RAW"; }, get toJSON() { throw Error("toJSON getter"); } };
  const result = captureAuditProtocolConfig(raw, value => {
    events.push("normalize"); assert.equal(value, raw); return { basisTitle: value.basisTitle };
  }, value => { events.push("identity"); return identity(value); });
  assert.deepEqual(events, ["normalize", "basis", "identity"]);
  assert.deepEqual(result, { config: { basisTitle: "RAW" }, displayConfigMissing: false });
  let proxyTraps = 0;
  const proxy = new Proxy({}, { get() { proxyTraps++; throw Error("get"); }, ownKeys() { proxyTraps++; throw Error("keys"); }, getPrototypeOf() { proxyTraps++; throw Error("prototype"); } });
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  for (const value of [undefined, NaN, Infinity, BigInt(1), Symbol("x"), () => {}, new Date(), new Map(), proxy, revoked.proxy, cycle,
    { nested: raw }, { toJSON() { throw Error("toJSON call"); } }, Object.create({ inherited: true }), { unknown: undefined }, { [Symbol("key")]: true }, new Array(2)]) {
    assert.equal(identity(value), undefined);
  }
  assert.equal(proxyTraps, 0);
  assert.deepEqual(captureAuditProtocolConfig(null, value => value), { config: null, displayConfigMissing: true });
  let called = false;
  assert.throws(() => captureAuditProtocolConfig(raw, () => { throw Error("normalizer original failure"); }, () => { called = true; return "ignored"; }), /normalizer original failure/);
  assert.equal(called, false);
});

test("actual normalizer field-read trace is unchanged and computed metadata stays outside config payload", () => {
  function fixture(events: string[]) {
    const values = { documentDate: "2026-10-21", basisTitle: "RAW basis", auditedObject: "RAW object",
      sections: [{ id: "s", title: "RAW section" }], rows: [{ id: "r", sectionId: "s", text: "RAW row", result: "yes", note: "RAW note" }],
      signatures: [{ id: "sig", name: "RAW name", role: "RAW role", signedAt: "2026-10-21" }], sourcePlanDocumentId: "plan", sourcePlanTitle: "RAW plan" };
    return Object.defineProperties({}, Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { enumerable: true, get() { events.push(key); return value; } }])));
  }
  const baseline: string[] = [], current: string[] = [];
  const first = captureAuditProtocolConfig(fixture(baseline), normalizeAuditProtocolConfig);
  const second = captureAuditProtocolConfig(fixture(current), normalizeAuditProtocolConfig, identity);
  assert.deepEqual(current, baseline);
  assert.deepEqual(second, first);
  const safe = captureAuditProtocolConfig({ basisTitle: "RAW persisted" }, normalizeAuditProtocolConfig, identity);
  assert.ok(safe.configSourceIdentity);
  const request = { config: safe.config };
  assert.equal(JSON.stringify(request).includes("configSourceIdentity"), false);
});

function guardHarness() {
  const client = readFileSync(new URL("../components/journals/audit-protocol-document-client.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("client.tsx", client, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const effects: ts.ArrowFunction[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && ts.isArrowFunction(node.arguments[0]) && node.arguments[0].body.getText(ast).includes("previousServerConfig.current")) effects.push(node.arguments[0]);
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.equal(effects.length, 1);
  const previousServerConfig = { current: null };
  let state: unknown, normalizations = 0, setters = 0;
  const normalize = (value: unknown) => { normalizations++; return normalizeAuditProtocolConfig(value); };
  // Execute the actual client guard body, not a rewritten model of its comparison.
  const run = vm.runInNewContext(`(initialConfig, configSourceIdentity, documentId) => ${effects[0].body.getText(ast)}`, {
    JSON, previousServerConfig, normalizeAuditProtocolConfig: normalize,
    setConfig: (value: unknown) => { setters++; state = value; },
  }) as (config: unknown, identity: string | undefined, documentId: string) => void;
  return { run, dirty: (value: unknown) => { state = value; }, state: () => state, counts: () => ({ normalizations, setters }) };
}

test("actual client guard retains null/partial drafts, synchronizes genuine raw/document changes and keeps legacy omitted-prop semantics", () => {
  for (const raw of [null, { basisTitle: "RAW/partial basis", auditedObject: "RAW/partial object" }, { sections: [], signatures: [{ name: "" }] }]) {
    const harness = guardHarness();
    const first = captureAuditProtocolConfig(raw, normalizeAuditProtocolConfig, identity);
    const fresh = captureAuditProtocolConfig(raw, normalizeAuditProtocolConfig, identity);
    harness.run(first.config, first.configSourceIdentity, "doc");
    const dirty = { basisTitle: "DIRTY", rows: ["preserved"], signatures: ["preserved"] };
    harness.dirty(dirty);
    harness.run(fresh.config, fresh.configSourceIdentity, "doc");
    assert.equal(harness.state(), dirty);
    assert.deepEqual(harness.counts(), { normalizations: 1, setters: 1 });
    const changed = captureAuditProtocolConfig({ basisTitle: "GENUINE incoming raw", sections: [] }, normalizeAuditProtocolConfig, identity);
    harness.run(changed.config, changed.configSourceIdentity, "doc");
    assert.equal((harness.state() as { basisTitle: string }).basisTitle, "GENUINE incoming raw");
    harness.dirty(dirty);
    harness.run(changed.config, changed.configSourceIdentity, "other-doc");
    assert.notEqual(harness.state(), dirty);
    assert.deepEqual(harness.counts(), { normalizations: 3, setters: 3 });
  }
  const legacy = guardHarness(), normalized = normalizeAuditProtocolConfig(null);
  legacy.run(normalized, undefined, "doc");
  const dirty = { basisTitle: "LEGACY DIRTY" }; legacy.dirty(dirty);
  legacy.run(JSON.parse(JSON.stringify(normalized)), undefined, "doc");
  assert.equal(legacy.state(), dirty);
  legacy.run({ ...normalized, basisTitle: "LEGACY changed" }, undefined, "doc");
  assert.equal((legacy.state() as { basisTitle: string }).basisTitle, "LEGACY changed");
  assert.deepEqual(legacy.counts(), { normalizations: 2, setters: 2 });
});
