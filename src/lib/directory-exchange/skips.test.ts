import assert from "node:assert/strict";
import test from "node:test";

import {
  EMPTY_SKIPS,
  isSkipCandidate,
  isSkipReason,
  parseExchangeSkips,
  planSkipSync,
  skipCandidates,
  withoutSkip,
  type ExchangeSkipRecord,
  type SkipCandidateQuery,
  type SkipCandidateRow,
} from "@/lib/directory-exchange/skips";

const record = (groupId: string, organizationId: string, extra: Partial<ExchangeSkipRecord> = {}): ExchangeSkipRecord => ({
  groupId,
  organizationId,
  sourceOrganizationId: "src",
  sourceEntityId: `e-${groupId}`,
  name: `Запись ${groupId}`,
  reason: "conflict",
  ...extra,
});

test("reasons: only limit and conflict", () => {
  assert.ok(isSkipReason("limit"));
  assert.ok(isSkipReason("conflict"));
  assert.ok(!isSkipReason("missing"));
  assert.ok(!isSkipReason(null));
});

test("skip sync: new skips are added, repeated ones only touched, changed ones updated", () => {
  const plan = planSkipSync({
    stored: [
      { id: "s1", ...record("g1", "b") },
      { id: "s2", ...record("g2", "b") },
    ],
    skipped: [record("g1", "b"), record("g2", "b", { reason: "limit" }), record("g3", "b")],
    groups: ["g1", "g2", "g3"],
  });
  assert.deepEqual(plan.touch, ["s1"]);
  assert.deepEqual(plan.change, [{ id: "s2", record: record("g2", "b", { reason: "limit" }) }]);
  assert.deepEqual(plan.add, [record("g3", "b")]);
  assert.deepEqual(plan.remove, []);
});

test("skip sync: a row the pass saw but did not skip is resolved; unseen groups are kept", () => {
  const plan = planSkipSync({
    stored: [
      { id: "created", ...record("g1", "b") },
      { id: "other-org", ...record("g1", "c") },
      { id: "unseen", ...record("g9", "b") },
    ],
    skipped: [record("g1", "c")],
    groups: new Set(["g1"]),
  });
  assert.deepEqual(plan.remove, ["created"]);
  assert.deepEqual(plan.touch, ["other-org"]);
  assert.deepEqual(plan.add, []);
});

test("skip sync: a duplicate stored row is removed, the last skip of a pair wins", () => {
  const plan = planSkipSync({
    stored: [
      { id: "first", ...record("g1", "b") },
      { id: "dup", ...record("g1", "b") },
    ],
    skipped: [record("g1", "b", { reason: "limit" }), record("g1", "b")],
    groups: [],
  });
  assert.deepEqual(plan.remove, ["dup"]);
  assert.deepEqual(plan.touch, ["first"]);
  assert.deepEqual(plan.change, []);
});

test("skip sync: an unknown stored reason is rewritten", () => {
  const plan = planSkipSync({ stored: [{ id: "s1", ...record("g1", "b"), reason: "old" }], skipped: [record("g1", "b")], groups: ["g1"] });
  assert.deepEqual(plan.change, [{ id: "s1", record: record("g1", "b") }]);
});

const row = (id: string, name: string, extra: Partial<SkipCandidateRow> = {}): SkipCandidateRow => ({
  id,
  name,
  detail: null,
  parentGroupId: null,
  linkedGroupIds: [],
  linkedShared: false,
  ...extra,
});
const query = (extra: Partial<SkipCandidateQuery> = {}): SkipCandidateQuery => ({
  entity: "product",
  groupId: "g1",
  name: "Молоко",
  parentGroupId: null,
  crossAccount: false,
  ...extra,
});

test("candidates: same name without case and extra spaces, never another name", () => {
  const rows = [row("a", "  молоко "), row("b", "МОЛОКО"), row("c", "Молоко 3,2%"), row("d", "")];
  assert.deepEqual(
    skipCandidates(query(), rows).map((item) => item.id),
    ["a", "b"],
  );
  assert.deepEqual(skipCandidates(query({ name: "  " }), rows), []);
});

test("candidates: rooms and equipment need the same building or area, areas the same building", () => {
  const rows = [row("same", "Кухня", { parentGroupId: "obj1" }), row("other", "Кухня", { parentGroupId: "obj2" }), row("none", "Кухня")];
  assert.deepEqual(skipCandidates(query({ entity: "room", name: "кухня", parentGroupId: "obj1" }), rows).map((item) => item.id), ["same"]);
  assert.deepEqual(skipCandidates(query({ entity: "equipment", name: "кухня", parentGroupId: "obj2" }), rows).map((item) => item.id), ["other"]);
  // Обязательного родителя у источника нет — связывать не с чем.
  assert.deepEqual(skipCandidates(query({ entity: "room", name: "кухня", parentGroupId: null }), rows), []);
  // У цеха объект необязателен: «без объекта» совпадает с «без объекта».
  assert.deepEqual(skipCandidates(query({ entity: "area", name: "кухня", parentGroupId: null }), rows).map((item) => item.id), ["none"]);
  // Продукту и должности родитель не важен.
  assert.equal(skipCandidates(query({ entity: "product", name: "кухня", parentGroupId: "obj1" }), rows).length, 3);
});

test("candidates: an already linked record only from its own lonely group and only without children", () => {
  const lonely = row("lonely", "Молоко", { linkedGroupIds: ["g2"] });
  const shared = row("shared", "Молоко", { linkedGroupIds: ["g3"], linkedShared: true });
  const here = row("here", "Молоко", { linkedGroupIds: ["g1"] });
  const twice = row("twice", "Молоко", { linkedGroupIds: ["g2", "g4"] });
  assert.deepEqual(skipCandidates(query(), [lonely, shared, here, twice]).map((item) => item.id), ["lonely"]);
  for (const entity of ["position", "building", "area"] as const) {
    assert.equal(isSkipCandidate(query({ entity }), lonely), false, entity);
    assert.equal(isSkipCandidate(query({ entity }), row("free", "Молоко")), true, entity);
  }
  assert.equal(isSkipCandidate(query({ entity: "staff" }), lonely), true);
});

test("candidates: people of another company are never offered", () => {
  assert.equal(isSkipCandidate(query({ entity: "staff", name: "Иванов Иван", crossAccount: true }), row("x", "Иванов Иван")), false);
  assert.equal(isSkipCandidate(query({ entity: "staff", name: "Иванов Иван" }), row("x", "иванов  иван")), true);
  // Продукты чужой компании связывать можно: у них нет владельца в ключе.
  assert.equal(isSkipCandidate(query({ crossAccount: true }), row("x", "Молоко")), true);
});

test("response parsing: bad rows dropped, candidates only for conflict, totals recounted", () => {
  const view = parseExchangeSkips({
    total: 99,
    organizations: [
      {
        organizationId: "org1",
        name: "Вторая",
        items: [
          {
            id: "s1",
            entity: "product",
            name: "Молоко",
            reason: "conflict",
            firstSeenAt: "2026-11-20T10:00:00.000Z",
            lastSeenAt: "nonsense",
            candidates: [{ id: "p1", name: "Молоко", detail: " Ферма " }, { id: "" }, null, { id: "p2", name: "молоко", detail: "" }],
          },
          { id: "s2", entity: "staff", name: "Иванов", reason: "limit", candidates: [{ id: "u1", name: "Иванов" }] },
          { id: "s3", entity: "unknown", name: "x", reason: "limit" },
          { id: "s4", entity: "room", name: "x", reason: "other" },
          { entity: "room", name: "x", reason: "limit" },
        ],
      },
      { organizationId: "org2", name: "Пустая", items: [{ id: "bad" }] },
      { name: "Без id", items: [{ id: "s5", entity: "product", name: "x", reason: "limit" }] },
    ],
  });
  assert.equal(view.total, 2);
  assert.equal(view.organizations.length, 1);
  const [first, second] = view.organizations[0].items;
  assert.deepEqual(first, {
    id: "s1",
    entity: "product",
    kind: "products",
    name: "Молоко",
    reason: "conflict",
    firstSeenAt: "2026-11-20T10:00:00.000Z",
    lastSeenAt: null,
    candidates: [
      { id: "p1", name: "Молоко", detail: "Ферма" },
      { id: "p2", name: "молоко", detail: null },
    ],
  });
  assert.equal(second.kind, "staff");
  assert.deepEqual(second.candidates, []);
  assert.deepEqual(parseExchangeSkips(null), EMPTY_SKIPS);
  assert.deepEqual(parseExchangeSkips({ organizations: "x" }), EMPTY_SKIPS);
});

test("removing a handled row drops the empty organization and recounts", () => {
  const view = parseExchangeSkips({
    organizations: [
      { organizationId: "o1", name: "A", items: [{ id: "s1", entity: "product", name: "x", reason: "limit" }] },
      {
        organizationId: "o2",
        name: "B",
        items: [
          { id: "s2", entity: "product", name: "y", reason: "limit" },
          { id: "s3", entity: "staff", name: "z", reason: "conflict" },
        ],
      },
    ],
  });
  const next = withoutSkip(view, "s1");
  assert.equal(next.total, 2);
  assert.deepEqual(next.organizations.map((organization) => organization.organizationId), ["o2"]);
  assert.equal(withoutSkip(next, "missing").total, 2);
  assert.deepEqual(withoutSkip(withoutSkip(next, "s2"), "s3"), EMPTY_SKIPS);
});
