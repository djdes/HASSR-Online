import test from "node:test";
import assert from "node:assert/strict";
import {
  capturePpeSource, capturePpeTitle, ppePositionOption, ppeRecipient,
  ppeRole, ppeSourceIdentity, ppeDocumentSourceIdentity, ppeLegacyPositionOption, presentPpeError, tagPpeError,
} from "./ppe-issuance-presentation";
import { createPpeIssuanceRow, normalizePpeIssuanceConfig } from "@/lib/ppe-issuance-document";

const users = [
  { id: "a", name: "Person A", role: "owner" },
  { id: "b", name: "Person B", role: "cook", positionTitle: "Повар" },
  { id: "c", name: "Person C", role: "cook" },
];
const copy = (key: string) => `localized:${key}`;


test("role presentation follows live enum provenance and preserves explicit-identical/custom titles", () => {
  assert.equal(ppeRole("Управляющий", users[0], copy), "localized:manager");
  assert.equal(ppeRole("Повар", users[1], copy), "Повар");
  assert.equal(ppeRole("Повар", undefined, copy), "Повар");
  assert.equal(ppeRole("Custom", { ...users[2], role: "Custom" }, copy), "Custom");
  assert.equal(ppeRole("Повар", { ...users[2], jobPosition: { name: "Повар" } }, copy), "Повар");
  assert.equal(ppePositionOption("Повар", users, copy), "Повар");
  assert.equal(ppePositionOption("Повар", [users[2]], copy), "localized:cook");
  assert.equal(ppePositionOption("orphan title", users, copy), "orphan title");
  assert.equal(ppeLegacyPositionOption("Повар", [{ ...users[2], positionTitle: "Custom position" }], copy), "localized:cook");
  assert.equal(ppeLegacyPositionOption("Повар", users, copy), "Повар");
});

test("recipient presentation retains custom-identical and orphan historical labels and never mutates rows", () => {
  const managed = createPpeIssuanceRow({ id: "r", recipientUserId: "a", recipientTitle: "Other", recipientName: "Snapshot" });
  const serialized = JSON.stringify(managed);
  assert.equal(ppeRecipient(managed, users, copy), "localized:manager, Person A");
  assert.equal(ppeRecipient({ ...managed, recipientUserId: "b" }, users, copy), "Повар, Person B");
  assert.equal(ppeRecipient({ ...managed, recipientUserId: "gone", recipientTitle: "Повар" }, users, copy), "Повар, Snapshot");
  assert.equal(JSON.stringify(managed), serialized);
});

test("raw source identity stays stable when null/partial/invalid sources allocate fresh normalized row IDs", () => {
  for (const source of [null, [], "invalid", {}, { rows: [{}] }, { rows: [false, { issueDate: "2026-10-21" }] }]) {
    let calls = 0, identities = 0;
    const normalize = (raw: unknown) => { calls++; return normalizePpeIssuanceConfig(raw, users); };
    const identity = (raw: unknown) => { identities++; return ppeSourceIdentity(raw); };
    const before = JSON.stringify(source);
    const a = capturePpeSource(source, normalize, identity);
    const b = capturePpeSource(structuredClone(source), normalize, identity);
    assert.equal(a.sourceIdentity, b.sourceIdentity);
    assert.equal(calls, 2);
    assert.equal(identities, 2);
    assert.equal(JSON.stringify(source), before);
  }
  assert.equal(ppeSourceIdentity({ x: 1, y: { a: 2, b: 3 } }), ppeSourceIdentity({ y: { b: 3, a: 2 }, x: 1 }));
  assert.notEqual(ppeSourceIdentity({ rows: [] }), ppeSourceIdentity({ rows: [{}] }));
});

test("capture preserves original read/normalizer ordering and original generated config object", () => {
  const events: string[] = [], config = { rows: [{ id: "factory-id" }] };
  const object = { get config() { events.push("read"); return { rows: [{}] }; } };
  const captured = capturePpeSource(object.config, raw => { events.push("normalize"); assert.deepEqual(raw, { rows: [{}] }); return config; }, () => { events.push("identity"); return "hash"; });
  assert.deepEqual(events, ["read", "normalize", "identity"]);
  assert.equal(captured.config, config);
  assert.equal(captured.sourceIdentity, "hash");
});

test("document revision ignores regenerated IDs but includes genuine employee-directory normalizer dependencies", () => {
  const raw = { rows: [{}] };
  const first = { documentId: "doc", title: "Raw", dateFrom: "2026-10-21", status: "active", ...capturePpeSource(raw, value => normalizePpeIssuanceConfig(value, users), ppeSourceIdentity), users };
  const equal = { ...first, ...capturePpeSource(structuredClone(raw), value => normalizePpeIssuanceConfig(value, structuredClone(users)), ppeSourceIdentity), users: structuredClone(users) };
  assert.notEqual(first.config.rows[0].id, equal.config.rows[0].id);
  assert.equal(ppeDocumentSourceIdentity(first), ppeDocumentSourceIdentity(equal));
  const changedUsers = [{ id: "new", name: "Changed", role: "manager", positionTitle: "Custom" }];
  const changed = { ...first, ...capturePpeSource(raw, value => normalizePpeIssuanceConfig(value, changedUsers), ppeSourceIdentity), users: changedUsers };
  assert.equal(first.sourceIdentity, changed.sourceIdentity);
  assert.notEqual(first.config.defaultIssuerUserId, changed.config.defaultIssuerUserId);
  assert.notEqual(ppeDocumentSourceIdentity(first), ppeDocumentSourceIdentity(changed));
  assert.notEqual(ppeDocumentSourceIdentity(first), ppeDocumentSourceIdentity({ ...first, documentId: "other" }));
  assert.notEqual(ppeDocumentSourceIdentity(first), ppeDocumentSourceIdentity({ ...first, titleIsFallback: true }));
});

test("fallback title provenance preserves user titles identical to the application default", () => {
  assert.deepEqual(capturePpeTitle("", "Журнал учета выдачи СИЗ"), { title: "Журнал учета выдачи СИЗ", titleIsFallback: true });
  assert.deepEqual(capturePpeTitle("Журнал учета выдачи СИЗ", "Журнал учета выдачи СИЗ"), { title: "Журнал учета выдачи СИЗ", titleIsFallback: false });
});

test("only tagged app fallbacks localize; raw exceptions/messages retain identity and text", () => {
  const raw = new Error("Не удалось сохранить документ");
  const stack = raw.stack;
  assert.equal(presentPpeError(raw, "error", copy), raw.message);
  assert.equal(tagPpeError(raw, "saveDocumentFailed"), raw);
  assert.equal(raw.message, "Не удалось сохранить документ");
  assert.equal(raw.stack, stack);
  assert.equal(presentPpeError(raw, "error", copy), "localized:saveDocumentFailed");
  assert.equal(presentPpeError(new Error("Custom server message"), "error", copy), "Custom server message");
  assert.equal(presentPpeError(new TypeError("Failed to fetch"), "error", copy), "localized:networkError");
  assert.equal(presentPpeError(null, "error", copy), "localized:error");
});
