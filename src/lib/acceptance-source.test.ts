import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { normalizeAcceptanceDocumentConfig, type AcceptanceDocumentConfig } from "@/lib/acceptance-document";
import {
  acceptanceServerRevision, bindAcceptanceSummaryRows, bindAcceptanceSummarySource,
  captureAcceptanceSummarySource,
} from "./acceptance-document-presentation";

const require = createRequire(import.meta.url);
function loadServer(file: URL) {
  const source = readFileSync(file, "utf8"), mod = { exports: {} };
  // Production markers remain untouched. This isolated native server fixture stubs only the marker.
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module: mod, exports: mod.exports, Object, Array, JSON, Number, Reflect, Set,
    require: (id: string) => id === "server-only" ? {} : require(id),
  });
  return mod.exports;
}
const capture = (loadServer(new URL("./acceptance-source.server.ts", import.meta.url)) as {
  captureAcceptanceSource: <T>(source: unknown, normalize: (source: unknown) => T, identity: (source: unknown) => string | undefined) => { config: T; sourceIdentity?: string };
}).captureAcceptanceSource;
const referenceDirectory = process.env.ACCEPTANCE_SOURCE_REFERENCE_DIRECTORY;
const identityFile = referenceDirectory ? new URL("file:///" + referenceDirectory.replaceAll("\\", "/") + "/audit-protocol-source.server.ts") : new URL("./audit-protocol-source.server.ts", import.meta.url);
const identity = (loadServer(identityFile) as { auditProtocolConfigSourceIdentity: (source: unknown) => string | undefined }).auditProtocolConfigSourceIdentity;
const users = [{ id: "cook-1", name: "RAW/Cook", role: "cook" }, { id: "manager-1", name: "RAW/Manager", role: "manager" }];
function propsFor(raw: unknown, directory = users, code = "incoming_control") {
  const source = captureAcceptanceSummarySource(raw);
  const value = capture(raw, data => normalizeAcceptanceDocumentConfig(data, directory), data => identity([data, directory, source]));
  return { ...value, documentId: "doc-1", routeCode: code, users: directory, generatedSummaries: bindAcceptanceSummarySource(source, value.config) };
}
type Incoming = ReturnType<typeof propsFor>;
const revision = (props: Incoming) => acceptanceServerRevision(props.documentId, props.config, props.users, props.generatedSummaries, props.sourceIdentity);

function actualGuard(first: Incoming) {
  const source = readFileSync(new URL("../components/journals/acceptance-document-client.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("client.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const effects: ts.ArrowFunction[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && ts.isArrowFunction(node.arguments[0]) && node.arguments[0].body.getText(ast).includes("lastIncomingConfig.current")) effects.push(node.arguments[0]);
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.equal(effects.length, 1);
  let config = normalizeAcceptanceDocumentConfig(first.config, first.users);
  let editing = config.rows[0] ?? null, selection = config.rows.map(row => row.id), writes = 0, normalizations = 0, cancelled = 0;
  let bindings = bindAcceptanceSummaryRows(config, first.generatedSummaries);
  const lastIncomingConfig = { current: revision(first) };
  // Execute the current staged editor's actual effect body, without rewriting its comparison/control flow.
  const run = vm.runInNewContext(`(props, editingRow, incomingConfig) => ${effects[0].body.getText(ast)}`, {
    lastIncomingConfig,
    normalizeAcceptanceDocumentConfig(value: unknown, directory: typeof users) { normalizations++; return normalizeAcceptanceDocumentConfig(value, directory); },
    bindAcceptanceSummaryRows,
    setDocumentState(next: { config: AcceptanceDocumentConfig; summaryBindings: typeof bindings }) { writes++; config = next.config; bindings = next.summaryBindings; },
    setEditingRow(next: typeof editing) { editing = next; },
    setSelectedRowIds(update: (current: string[]) => string[]) { selection = update(selection); },
    cancelSequentialEdit() { cancelled++; },
  });
  return {
    refresh(next: Incoming) { run(next, editing, revision(next)); },
    snapshot: () => ({ config, editing, selection, writes, normalizations, cancelled, bindings }),
  };
}

test("both product/raw guards retain actual row object/selection with regenerated server IDs and equal raw/directory inputs", () => {
  for (const code of ["incoming_control", "incoming_raw_materials_control"]) for (const withId of [false, true]) {
    const raw = { rows: [{ ...(withId ? { id: "stored-ID" } : {}), productName: "RAW/product", deliveryDate: "2026-10-21", note: "RAW/note", transportCondition: "satisfactory" }] };
    const first = propsFor(raw, users, code), equal = propsFor(structuredClone(raw), structuredClone(users), code);
    assert(first.sourceIdentity); assert.equal(first.sourceIdentity, equal.sourceIdentity);
    if (!withId) { assert.notEqual(first.config.rows[0].id, equal.config.rows[0].id); assert.notEqual(first.generatedSummaries[0].id, equal.generatedSummaries[0].id); }
    const guard = actualGuard(first), before = guard.snapshot();
    guard.refresh(equal);
    const after = guard.snapshot();
    assert.equal(after.config, before.config); assert.equal(after.editing, before.editing); assert.equal(after.bindings, before.bindings);
    assert.deepEqual(after.selection, before.selection); assert.equal(after.writes, 0); assert.equal(after.normalizations, 0); assert.equal(after.cancelled, 0);
    assert.equal(Object.hasOwn(first.config, "sourceIdentity"), false);
    assert.equal(JSON.stringify({ config: first.config }).includes("sourceIdentity"), false);
  }
});

test("null/invalid/partial factories and legacy ID-less rows compare equal without duplicate normalization or raw mutation", () => {
  for (const raw of [null, false, 0, "invalid", [], {}, { rows: [] }, { rows: [null, 7, {}] }, { rows: [{ productName: "Legacy" }] }]) {
    const before = JSON.stringify(raw);
    let calls = 0;
    const source = captureAcceptanceSummarySource(raw);
    const first = capture(raw, value => { calls++; return normalizeAcceptanceDocumentConfig(value, users); }, value => identity([value, users, source]));
    assert.equal(calls, 1);
    const initial = propsFor(raw), equal = propsFor(structuredClone(raw));
    assert.equal(first.sourceIdentity, initial.sourceIdentity); assert.equal(revision(initial), revision(equal));
    const guard = actualGuard(initial); guard.refresh(equal); assert.equal(guard.snapshot().writes, 0);
    assert.equal(JSON.stringify(raw), before);
  }
});

test("real raw/plan-list/summary-source/directory differences still trigger actual editor synchronization", () => {
  const raw = { rows: [{ id: "r", productName: "RAW", note: "Original" }], products: ["RAW"] };
  const first = propsFor(raw);
  for (const changed of [
    { ...raw, rows: [{ ...raw.rows[0], note: "Changed" }] },
    { ...raw, products: ["RAW", "New"] },
    { ...raw, rows: [{ ...raw.rows[0], transportCondition: "satisfactory" }] },
  ]) {
    const next = propsFor(changed), guard = actualGuard(first);
    assert.notEqual(revision(first), revision(next)); guard.refresh(next);
    assert.equal(guard.snapshot().writes, 1); assert.equal(guard.snapshot().normalizations, 1); assert.deepEqual(guard.snapshot().config, next.config);
  }
  const changedDirectory = [{ id: "different-cook", name: "RAW/Other", role: "cook" }];
  const next = propsFor(raw, changedDirectory);
  assert.notEqual(first.config.defaultResponsibleUserId, next.config.defaultResponsibleUserId);
  assert.notEqual(first.sourceIdentity, next.sourceIdentity);
  const guard = actualGuard(first); guard.refresh(next); assert.equal(guard.snapshot().config.defaultResponsibleUserId, "different-cook"); assert.equal(guard.snapshot().writes, 1);
  const renamed = propsFor(raw, users.map(user => ({ ...user, name: user.name + " Changed" })));
  assert.notEqual(first.sourceIdentity, renamed.sourceIdentity); const renameGuard = actualGuard(first); renameGuard.refresh(renamed); assert.equal(renameGuard.snapshot().writes, 1);
  const summary = captureAcceptanceSummarySource(raw), config = normalizeAcceptanceDocumentConfig(raw, users);
  const a = capture(raw, () => config, value => identity([value, users, summary]));
  const b = capture(raw, () => config, value => identity([value, users, [{ index: 0, transportCondition: "satisfactory" }]]));
  assert.notEqual(a.sourceIdentity, b.sourceIdentity, "Earlier captured summary-source provenance remains a genuine dependency");
});

test("actual guard synchronizes removed editing rows/selection and the unchanged document-keyed wrapper stays present", () => {
  const first = propsFor({ rows: [{ id: "a", productName: "A" }, { id: "b", productName: "B" }] });
  const guard = actualGuard(first), removed = propsFor({ rows: [{ id: "b", productName: "B" }] });
  guard.refresh(removed); assert.equal(guard.snapshot().editing, null); assert.equal(guard.snapshot().cancelled, 1); assert.deepEqual([...guard.snapshot().selection], ["b"]);
  const another = { ...first, documentId: "doc-2" }; assert.notEqual(revision(first), revision(another)); const documentGuard = actualGuard(first); documentGuard.refresh(another); assert.equal(documentGuard.snapshot().writes, 1);
  const source = readFileSync(new URL("../components/journals/acceptance-document-client.tsx", import.meta.url), "utf8");
  assert(source.includes('return <AcceptanceDocumentEditor key={props.documentId} {...props} />;'));
});

test("omitted/unsupported witnesses retain the exact legacy normalized/users/summary guard", () => {
  const raw = { rows: [{ productName: "Legacy" }] }, a = propsFor(raw), b = propsFor(structuredClone(raw));
  const omittedA = { ...a, sourceIdentity: undefined }, omittedB = { ...b, sourceIdentity: undefined };
  assert.equal(revision(omittedA), JSON.stringify([a.documentId, a.config, a.users, a.generatedSummaries]));
  assert.notEqual(revision(omittedA), revision(omittedB));
  const guard = actualGuard(omittedA); guard.refresh(omittedB); assert.equal(guard.snapshot().writes, 1);
  let reads = 0;
  const exotic = { get rows() { reads++; return [{ id: "stored", productName: "RAW" }]; }, get toJSON() { throw Error("Must not read toJSON"); } };
  const normalized = capture(exotic, value => normalizeAcceptanceDocumentConfig(value, users), value => identity([value, users, []]));
  assert.equal(normalized.sourceIdentity, undefined); assert.equal(reads, 2, "Only original normalizer reads rows; identity reads descriptors");
  assert.equal(acceptanceServerRevision("d", normalized.config, users, [], normalized.sourceIdentity), JSON.stringify(["d", normalized.config, users, []]));
});

test("capture retains original Error identity and stops before witness/summary binding when normalization fails", () => {
  const original = new TypeError("RAW/native Russian Не удалось сохранить документ"), events: string[] = [];
  const raw = { get rows() { events.push("rows"); throw original; } };
  captureAcceptanceSummarySource(raw);
  assert.throws(() => capture(raw, value => { events.push("normalize"); return normalizeAcceptanceDocumentConfig(value, users); }, () => { events.push("identity"); return "never"; }), error => error === original);
  assert.deepEqual(events, ["normalize", "rows"]);
});
