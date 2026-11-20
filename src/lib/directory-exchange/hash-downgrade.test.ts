import assert from "node:assert/strict";
import test from "node:test";

import {
  downgradeEntities,
  needsDowngrade,
  planCabinetDowngrade,
  planLinkDowngrade,
  targetHashTag,
  type DowngradeLink,
  type DowngradeRow,
} from "@/lib/directory-exchange/hash-downgrade";
import { hashFields, hashTag, rowHash, rowHashLike } from "@/lib/directory-exchange/kinds";

const ROOM_V1 = { name: "Кухня", kind: "kitchen", sortOrder: 1 };
const ROOM = {
  ...ROOM_V1,
  currentScope: JSON.stringify([{ label: "Полы" }]),
  generalScope: null,
  currentDays: 127,
  generalDays: 0,
  currentScheduleType: "weekly",
  generalScheduleType: "weekly",
  currentMonthDays: null,
  generalMonthDays: null,
  detergent: "Хлорамин",
  requirePhoto: false,
  climateNorms: null,
};
const COOK = { name: "Повар", journals: '["cleaning","hygiene"]' };

/**
 * The fingerprint the code before C2 computed (`rowHash` of 3e7e077), written out independently:
 * room {name, kind, sortOrder} + the building's group; position {name} without a scope mark —
 * positions had no «between accounts» field list then.
 */
const preC2Room = (fields: typeof ROOM, parent: string | null) =>
  hashFields({ name: fields.name, kind: fields.kind, sortOrder: fields.sortOrder, "#parent": parent });
const preC2Position = (name: string) => hashFields({ name, "#parent": null });

test("Р1: only entities whose field list has a newer version are rolled back — rooms and positions", () => {
  assert.deepEqual(downgradeEntities(), ["position", "room"]);
  assert.deepEqual(downgradeEntities(2), []);
});

test("Р1: target tags — the link's scope only where the target version had it", () => {
  assert.equal(targetHashTag("room", rowHash("room", ROOM, "g")), "");
  assert.equal(targetHashTag("position", rowHash("position", COOK)), "");
  // Version 1 of positions had no «between accounts» list: the old code hashed them without «f:».
  assert.equal(targetHashTag("position", rowHash("position", COOK, null, "foreign")), "");
  assert.equal(targetHashTag("position", rowHash("position", COOK, null, "foreign"), 2), "f:v2:");
  // Staff had «f:» in version 1 — kept (generic rule; staff are not rolled back now).
  assert.equal(targetHashTag("staff", "f:0123456789abcdef0123456789ab"), "f:");
  assert.equal(targetHashTag("room", "v2:x", 3), null);
  assert.equal(targetHashTag("room", "v2:x", 0), null);
});

test("Р1: an unedited room — the version-1 fingerprint the code before C2 computes", () => {
  const link = { entityId: "r1", hash: rowHash("room", ROOM, "g-cafe") };
  assert.match(link.hash, /^v2:/);
  const decision = planLinkDowngrade("room", link, { fields: ROOM, parentGroupId: "g-cafe" });
  assert.deepEqual(decision, { status: "rewrite", hash: preC2Room(ROOM, "g-cafe") });
  // The old code sees «unchanged»: the link equals the row's old fingerprint.
  assert.equal(hashTag(preC2Room(ROOM, "g-cafe")).version, 1);
  // The current code moves it back to version 2 without an edit (rebaseLinks compares by rowHashLike).
  assert.equal(rowHashLike("room", ROOM, "g-cafe", preC2Room(ROOM, "g-cafe")), preC2Room(ROOM, "g-cafe"));
  // A second run: nothing to do.
  assert.deepEqual(planLinkDowngrade("room", { entityId: "r1", hash: preC2Room(ROOM, "g-cafe") }, { fields: ROOM, parentGroupId: "g-cafe" }), {
    status: "skip",
    reason: "already",
  });
});

test("Р1: positions — inside the account and between accounts both become the unmarked version 1", () => {
  const account = planLinkDowngrade("position", { entityId: "p1", hash: rowHash("position", COOK) }, { fields: COOK, parentGroupId: null });
  assert.deepEqual(account, { status: "rewrite", hash: preC2Position("Повар") });
  const foreignLink = { entityId: "p1", hash: rowHash("position", COOK, null, "foreign") };
  assert.match(foreignLink.hash, /^f:v2:/);
  assert.deepEqual(planLinkDowngrade("position", foreignLink, { fields: COOK, parentGroupId: null }), { status: "rewrite", hash: preC2Position("Повар") });
  // Rows read between accounts (no journals) are enough for the restricted link.
  assert.deepEqual(planLinkDowngrade("position", foreignLink, { fields: { name: "Повар" }, parentGroupId: null }, { readScope: "foreign" }), {
    status: "rewrite",
    hash: preC2Position("Повар"),
  });
  // …but not for a full version-2 link: its journals are not read.
  assert.deepEqual(
    planLinkDowngrade("position", { entityId: "p1", hash: rowHash("position", COOK) }, { fields: { name: "Повар" }, parentGroupId: null }, { readScope: "foreign" }),
    { status: "skip", reason: "unreadable" },
  );
});

test("Р1: links left as they are — tombstones, old versions, unknown versions, missing rows", () => {
  const row = { fields: ROOM, parentGroupId: "g" };
  const v2 = rowHash("room", ROOM, "g");
  assert.deepEqual(planLinkDowngrade("room", { entityId: null, hash: v2 }, row), { status: "skip", reason: "tombstone" });
  assert.deepEqual(planLinkDowngrade("room", { entityId: "r", hash: preC2Room(ROOM, "g") }, row), { status: "skip", reason: "already" });
  assert.deepEqual(planLinkDowngrade("room", { entityId: "r", hash: "" }, row), { status: "skip", reason: "already" });
  assert.deepEqual(planLinkDowngrade("room", { entityId: "r", hash: "v3:0123456789abcdef0123456789ab" }, row), { status: "skip", reason: "unknown_version" });
  assert.deepEqual(planLinkDowngrade("room", { entityId: "r", hash: v2 }, null), { status: "skip", reason: "missing_row" });
  // A scope mark rooms never had — cannot be recomputed, never guessed.
  assert.deepEqual(planLinkDowngrade("room", { entityId: "r", hash: `f:${v2}` }, row), { status: "skip", reason: "unreadable" });
});

test("Р1: a row edited after the last exchange keeps its link — the old code sees the edit and carries it", () => {
  const v2 = rowHash("room", ROOM, "g");
  // A new-field edit (schedule) and an old-field edit (name) — both are edits, neither is hidden.
  assert.deepEqual(planLinkDowngrade("room", { entityId: "r", hash: v2 }, { fields: { ...ROOM, detergent: "Ника" }, parentGroupId: "g" }), {
    status: "skip",
    reason: "edited",
  });
  assert.deepEqual(planLinkDowngrade("room", { entityId: "r", hash: v2 }, { fields: { ...ROOM, name: "Кухня 2" }, parentGroupId: "g" }), {
    status: "skip",
    reason: "edited",
  });
  // Moved to another object (parent group) — an edit too.
  assert.deepEqual(planLinkDowngrade("room", { entityId: "r", hash: v2 }, { fields: ROOM, parentGroupId: "g2" }), { status: "skip", reason: "edited" });
  // The kept version-2 link differs from the row's old fingerprint: the old code treats it as changed.
  assert.notEqual(v2, preC2Room({ ...ROOM, detergent: "Ника" }, "g"));
});

test("Р1: a cabinet plan — rewrites and counts by entity and reason", () => {
  const links: DowngradeLink[] = [
    { id: "l1", entity: "room", organizationId: "a", entityId: "r1", hash: rowHash("room", ROOM, "g") },
    { id: "l2", entity: "room", organizationId: "b", entityId: "r2", hash: rowHash("room", ROOM, "g") },
    { id: "l3", entity: "room", organizationId: "b", entityId: null, hash: rowHash("room", ROOM, "g") },
    { id: "l4", entity: "position", organizationId: "a", entityId: "p1", hash: rowHash("position", COOK, null, "foreign") },
    { id: "l5", entity: "position", organizationId: "b", entityId: "p2", hash: preC2Position("Повар") },
    { id: "l6", entity: "position", organizationId: "b", entityId: "gone", hash: rowHash("position", COOK) },
  ];
  const rows: Record<string, DowngradeRow> = {
    r1: { fields: ROOM, parentGroupId: "g" },
    r2: { fields: { ...ROOM, detergent: "Ника" }, parentGroupId: "g" },
    p1: { fields: COOK, parentGroupId: null },
    p2: { fields: COOK, parentGroupId: null },
  };
  const { rewrites, counts } = planCabinetDowngrade(links, (link) => rows[link.entityId!] ?? null);
  assert.deepEqual(
    rewrites.map((rewrite) => [rewrite.id, rewrite.to]),
    [
      ["l1", preC2Room(ROOM, "g")],
      ["l4", preC2Position("Повар")],
    ],
  );
  assert.equal(rewrites[0].from, links[0].hash);
  assert.deepEqual(counts, { rewrite: 2, byEntity: { room: 1, position: 1 }, left: { edited: 1, tombstone: 1, missing_row: 1 } });
  // Applying the plan and planning again: nothing left to rewrite.
  const applied = links.map((link) => ({ ...link, hash: rewrites.find((rewrite) => rewrite.id === link.id)?.to ?? link.hash }));
  assert.equal(planCabinetDowngrade(applied, (link) => rows[link.entityId!] ?? null).rewrites.length, 0);
});

test("Р1: needsDowngrade — a row read is needed only for a versioned link with a record", () => {
  assert.equal(needsDowngrade({ entityId: "r", hash: rowHash("room", ROOM, "g") }), true);
  assert.equal(needsDowngrade({ entityId: null, hash: rowHash("room", ROOM, "g") }), false);
  assert.equal(needsDowngrade({ entityId: "r", hash: preC2Room(ROOM, "g") }), false);
  assert.equal(needsDowngrade({ entityId: "r", hash: rowHash("room", ROOM, "g") }, 2), false);
});
