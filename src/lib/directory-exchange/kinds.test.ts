import assert from "node:assert/strict";
import test from "node:test";

import {
  ENTITY_FIELDS,
  ENTITY_KIND,
  ENTITY_PARENT,
  EXCHANGE_ENTITIES,
  EXCHANGE_KINDS,
  FOREIGN_ENTITY_FIELDS,
  FOREIGN_HASH_PREFIX,
  KIND_ENTITIES,
  entityScope,
  exchangedFields,
  hashFields,
  ENTITY_FIELD_VERSIONS,
  currentFieldVersion,
  hashScope,
  hashTag,
  isCurrentHash,
  naturalKey,
  normalizeExchangeKinds,
  normalizeExchangeName,
  pickExchangeFields,
  rowHash,
  rowHashLike,
} from "@/lib/directory-exchange/kinds";
import { emptySummary, parseExchangeSummary, summaryTotals } from "@/lib/directory-exchange/summary";

test("lists and entities: every entity belongs to one list, parents come first", () => {
  assert.deepEqual([...EXCHANGE_KINDS], ["products", "staff", "objects", "equipment"]);
  assert.deepEqual(EXCHANGE_KINDS.flatMap((kind) => [...KIND_ENTITIES[kind]]).sort(), [...EXCHANGE_ENTITIES].sort());
  for (const entity of EXCHANGE_ENTITIES) {
    assert.ok(KIND_ENTITIES[ENTITY_KIND[entity]].includes(entity), entity);
    const parent = ENTITY_PARENT[entity];
    if (parent) assert.ok(EXCHANGE_ENTITIES.indexOf(parent.entity) < EXCHANGE_ENTITIES.indexOf(entity), `${parent.entity} before ${entity}`);
  }
  // Помещение заводит цех-зеркало — цеха обмениваются после помещений.
  assert.ok(EXCHANGE_ENTITIES.indexOf("room") < EXCHANGE_ENTITIES.indexOf("area"));
  assert.deepEqual(normalizeExchangeKinds(["staff", "nope", "products", "staff", 5]), ["products", "staff"]);
  assert.deepEqual(normalizeExchangeKinds("staff"), []);
});

test("rule Р4: nothing private is among the exchanged fields", () => {
  const all = Object.values(ENTITY_FIELDS).flat() as string[];
  for (const forbidden of ["email", "passwordHash", "role", "telegramChatId", "tuyaDeviceId", "fillerUserIds", "cleanerUserIds", "verifierUserIds", "isRoot"]) {
    assert.ok(!all.includes(forbidden), forbidden);
  }
});

test("name in a key: trimmed, spaces collapsed, lower case", () => {
  assert.equal(normalizeExchangeName("  Молоко   3,2%  "), "молоко 3,2%");
  assert.equal(normalizeExchangeName("СЫР"), "сыр");
  assert.equal(normalizeExchangeName(null), "");
});

test("natural keys by entity", () => {
  assert.equal(naturalKey("product", { name: " Сыр ", kind: "raw" }), "raw|сыр");
  assert.equal(naturalKey("product", { name: "Сыр", kind: "semi" }), "semi|сыр");
  assert.equal(naturalKey("product", { name: "Сыр" }), "raw|сыр");
  assert.equal(naturalKey("position", { name: "Повар" }), "повар");
  assert.equal(naturalKey("building", { name: "Кафе  на Ленина" }), "кафе на ленина");
  assert.equal(naturalKey("staff", { name: "Иванов Иван" }, "g-pos"), "иванов иван");
  assert.equal(naturalKey("room", { name: "Кухня" }, "g1"), "g1|кухня");
  assert.equal(naturalKey("area", { name: "Склад" }, "g1"), "g1|склад");
  assert.equal(naturalKey("area", { name: "Склад" }), "-|склад");
  assert.equal(naturalKey("equipment", { name: "Холодильник №1", type: "refrigerator" }, "g2"), "g2|refrigerator|холодильник №1");
  // Одинаковые названия в разных объектах и цехах — разные записи.
  assert.notEqual(naturalKey("room", { name: "Кухня" }, "g1"), naturalKey("room", { name: "Кухня" }, "g2"));
});

test("no key — no exchange: empty name or a required parent outside the exchange", () => {
  assert.equal(naturalKey("product", { name: "   " }), null);
  assert.equal(naturalKey("room", { name: "Кухня" }), null);
  assert.equal(naturalKey("equipment", { name: "Печь", type: "oven" }), null);
  assert.equal(naturalKey("staff", { name: "Иванов Иван" }), null);
});

test("hash: same content gives the same hash, any exchanged change gives another", () => {
  const base = { name: "Сыр", supplier: null, unit: "kg" };
  assert.equal(hashFields(base), hashFields({ unit: "kg", name: "Сыр", supplier: "" }));
  assert.equal(hashFields(base), hashFields({ name: "Сыр", unit: "kg" }));
  assert.notEqual(hashFields(base), hashFields({ ...base, name: "сыр" }));
  assert.notEqual(hashFields(base), hashFields({ ...base, supplier: "Ферма" }));
  assert.equal(hashFields({ days: [6, 5] }), hashFields({ days: [5, 6] }));
  assert.notEqual(hashFields({ days: [5] }), hashFields({ days: [5, 6] }));
  assert.notEqual(hashFields({ value: 0 }), hashFields({ value: null }));
  assert.match(hashFields(base), /^[0-9a-f]{28}$/);
});

test("row hash: only exchanged fields and the parent group count", () => {
  const fields = { name: "Иванов Иван", phone: "+79850000000", weeklyDaysOff: [5, 6] };
  const hash = rowHash("staff", fields, "g-cook");
  assert.equal(hash, rowHash("staff", { ...fields, email: "a@b.c", telegramChatId: "1" }, "g-cook"));
  assert.notEqual(hash, rowHash("staff", fields, "g-waiter"));
  assert.notEqual(hash, rowHash("staff", { ...fields, phone: null }, "g-cook"));
  assert.equal(rowHash("equipment", { name: "Печь", type: "oven" }, "g"), rowHash("equipment", { name: "Печь", type: "oven", tuyaDeviceId: "x" }, "g"));
});

test("summary: totals and reading the stored result", () => {
  assert.deepEqual(emptySummary(), { organizations: [], notes: [] });
  assert.equal(parseExchangeSummary(null), null);
  assert.equal(parseExchangeSummary({ notes: [] }), null);
  const parsed = parseExchangeSummary({
    organizations: [
      { organizationId: "o1", name: "Первая", kinds: { products: { created: 2, updated: 1, skippedLimit: 0, skippedConflict: 3 }, staff: { created: "x" } } },
      { name: "без id" },
    ],
    notes: ["раз", 5],
  });
  assert.equal(parsed?.organizations.length, 1);
  assert.deepEqual(parsed?.organizations[0].kinds.products, { created: 2, updated: 1, skippedLimit: 0, skippedConflict: 3 });
  assert.deepEqual(parsed?.organizations[0].kinds.staff, { created: 0, updated: 0, skippedLimit: 0, skippedConflict: 0 });
  assert.deepEqual(parsed?.notes, ["раз"]);
  assert.deepEqual(summaryTotals(parsed!), { created: 2, updated: 1, skippedLimit: 0, skippedConflict: 3 });
});

test("rowHash: a workshop's object is not part of its fingerprint, other parents are", () => {
  const area = { name: "Кухня", description: "Горячий цех" };
  // Ticking «Объекты» later gives every workshop a building group at once — none of them may look edited.
  assert.equal(rowHash("area", area, null), rowHash("area", area, "building-group"));
  assert.notEqual(rowHash("area", area, null), rowHash("area", { ...area, name: "Склад" }, null));
  // Moving an employee to another position or equipment to another workshop is still an edit.
  assert.notEqual(rowHash("staff", { name: "Иванов Иван" }, "cook"), rowHash("staff", { name: "Иванов Иван" }, "baker"));
  assert.notEqual(rowHash("equipment", { name: "Плита", type: "oven" }, "a1"), rowHash("equipment", { name: "Плита", type: "oven" }, "a2"));
});

test("rule Р5: between accounts an employee is a name and a position, a position is its name only", () => {
  assert.deepEqual(FOREIGN_ENTITY_FIELDS, { position: ["name"], staff: ["name"] });
  assert.deepEqual([...exchangedFields("staff", "foreign")], ["name"]);
  assert.deepEqual([...exchangedFields("staff", "account")], ["name", "phone", "weeklyDaysOff"]);
  assert.deepEqual([...exchangedFields("staff")], ["name", "phone", "weeklyDaysOff"]);
  // Р8.2: the position's journals stay inside the account, like the phones.
  assert.deepEqual([...exchangedFields("position", "foreign")], ["name"]);
  assert.deepEqual([...exchangedFields("position")], ["name", "journals"]);
  // Every other entity has one field set, whoever takes part (rooms with their schedules too, Р8.3).
  for (const entity of EXCHANGE_ENTITIES) {
    if (entity === "staff" || entity === "position") continue;
    assert.deepEqual([...exchangedFields(entity, "foreign")], [...ENTITY_FIELDS[entity]], entity);
    assert.equal(entityScope(entity, "foreign"), "account", entity);
  }
  assert.equal(entityScope("staff", "foreign"), "foreign");
  assert.equal(entityScope("position", "foreign"), "foreign");
  assert.equal(entityScope("staff", "account"), "account");
  assert.equal(entityScope("staff"), "account");
  // The restricted set is a subset of the full one and holds nothing private.
  for (const [entity, fields] of Object.entries(FOREIGN_ENTITY_FIELDS)) {
    for (const field of fields) assert.ok((ENTITY_FIELDS[entity as keyof typeof ENTITY_FIELDS] as readonly string[]).includes(field), field);
    for (const forbidden of ["phone", "weeklyDaysOff", "email", "telegramChatId"]) assert.ok(!(fields as readonly string[]).includes(forbidden), forbidden);
  }
});

test("rule Р5: the phone and days off never reach the picked fields or the fingerprint", () => {
  const person = { name: "Иванов Иван", phone: "+79850000000", weeklyDaysOff: [5, 6] };
  assert.deepEqual(pickExchangeFields("staff", person, "foreign"), { name: "Иванов Иван" });
  assert.deepEqual(pickExchangeFields("staff", person), { name: "Иванов Иван", phone: "+79850000000", weeklyDaysOff: [5, 6] });

  const hash = rowHash("staff", person, "g-cook", "foreign");
  assert.equal(hash, rowHash("staff", { name: "Иванов Иван" }, "g-cook", "foreign"));
  assert.equal(hash, rowHash("staff", { ...person, phone: "+79851112233" }, "g-cook", "foreign"));
  assert.equal(hash, rowHash("staff", { ...person, phone: null, weeklyDaysOff: [] }, "g-cook", "foreign"));
  // The name and the position still count.
  assert.notEqual(hash, rowHash("staff", { ...person, name: "Иванов И." }, "g-cook", "foreign"));
  assert.notEqual(hash, rowHash("staff", person, "g-waiter", "foreign"));
});

test("rule Р5: the restricted fingerprint is marked, the fingerprint inside an account is unchanged", () => {
  const person = { name: "Иванов Иван", phone: "+79850000000", weeklyDaysOff: [5, 6] };
  const full = rowHash("staff", person, "g-cook");
  const foreign = rowHash("staff", person, "g-cook", "foreign");
  // Inside an account nothing changed: the same value as before the foreign exchange existed.
  assert.equal(full, hashFields({ ...person, "#parent": "g-cook" }));
  assert.equal(full, rowHash("staff", person, "g-cook", "account"));
  assert.match(full, /^[0-9a-f]{28}$/);
  assert.match(foreign, /^f:[0-9a-f]{28}$/);
  assert.ok(foreign.startsWith(FOREIGN_HASH_PREFIX));
  assert.notEqual(foreign, full);
  // Even an employee without a phone and days off has two different fingerprints:
  // a change of the field set is always visible, never mistaken for «nothing changed».
  assert.notEqual(rowHash("staff", { name: "Петров Пётр" }, "g", "foreign"), rowHash("staff", { name: "Петров Пётр" }, "g"));
  assert.equal(hashScope("staff", foreign), "foreign");
  assert.equal(hashScope("staff", full), "account");
  // Other entities have no restricted variant: the same fingerprint, no mark.
  const product = { name: "Сыр", kind: "raw", unit: "kg" };
  assert.equal(rowHash("product", product, null, "foreign"), rowHash("product", product));
  assert.equal(hashScope("product", rowHash("product", product, null, "foreign")), "account");
  assert.equal(hashScope("product", "f:whatever"), "account");
  // A position has one since Р8.2 (version 2): name only, marked.
  assert.match(rowHash("position", { name: "Повар", journals: '["cleaning"]' }, null, "foreign"), /^f:v2:[0-9a-f]{28}$/);
  assert.equal(
    rowHash("position", { name: "Повар", journals: '["cleaning"]' }, null, "foreign"),
    rowHash("position", { name: "Повар" }, null, "foreign"),
  );
});

test("naturalKey: with an owner, people of two companies never share a key; other records still match by name", () => {
  const person = { name: "Иванов Иван" };
  assert.equal(naturalKey("staff", person, "cook"), naturalKey("staff", { name: " иванов  иван " }, "cook"));
  assert.notEqual(naturalKey("staff", person, "cook", "account-1"), naturalKey("staff", person, "cook", "account-2"));
  assert.equal(naturalKey("staff", person, "cook", "account-1"), naturalKey("staff", person, "cook", "account-1"));
  for (const entity of ["position", "building", "product"] as const) {
    assert.equal(naturalKey(entity, { name: "Кухня" }, null, "account-1"), naturalKey(entity, { name: "Кухня" }, null, "account-2"), entity);
  }
});

/* ── Р8.0: field-set versions in the fingerprint ── */

const ROOM_V1 = { name: "Кухня", kind: "kitchen", sortOrder: 1 };
const ROOM_V2 = {
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

test("Р8.0: versions — the current list is the last version, an earlier version is never dropped, fields are only added", () => {
  for (const entity of EXCHANGE_ENTITIES) {
    const versions = ENTITY_FIELD_VERSIONS[entity] as readonly { account: readonly string[]; foreign?: readonly string[] }[];
    assert.equal(currentFieldVersion(entity), versions.length, entity);
    assert.deepEqual([...ENTITY_FIELDS[entity]], [...versions[versions.length - 1].account], entity);
    // A later version keeps every field of the earlier ones: the old fingerprint can be computed from what is read now.
    for (let index = 1; index < versions.length; index += 1) {
      for (const field of versions[index - 1].account) assert.ok(versions[index].account.includes(field), `${entity} v${index + 1} keeps ${field}`);
    }
  }
  assert.equal(currentFieldVersion("room"), 2);
  assert.equal(currentFieldVersion("position"), 2);
  for (const entity of ["product", "staff", "building", "area", "equipment"] as const) assert.equal(currentFieldVersion(entity), 1, entity);
  // Р4/Р8.3: the people of a room are never among the exchanged fields.
  for (const forbidden of ["cleanerUserIds", "fillerUserIds", "verifierUserIds"]) assert.ok(!ENTITY_FIELDS.room.includes(forbidden), forbidden);
});

test("Р8.0: the version is a mark after the scope mark; version 1 and unchanged entities keep the old unmarked fingerprint", () => {
  const room = rowHash("room", ROOM_V2, "g-cafe");
  assert.match(room, /^v2:[0-9a-f]{28}$/);
  assert.deepEqual(hashTag(room), { scope: "account", version: 2 });
  assert.deepEqual(hashTag(`f:${room}`), { scope: "foreign", version: 2 });
  assert.deepEqual(hashTag("0123456789abcdef0123456789ab"), { scope: "account", version: 1 });
  assert.deepEqual(hashTag("f:0123456789abcdef0123456789ab"), { scope: "foreign", version: 1 });
  assert.deepEqual(hashTag(""), { scope: "account", version: 1 });
  // Products, staff and the rest: the same value as before versions existed.
  assert.equal(rowHash("product", { name: "Сыр", unit: "kg" }), hashFields({ name: "Сыр", unit: "kg", "#parent": null }));
  // A room of version 2 with the same name, kind and order is a different fingerprint from version 1.
  const v1 = rowHashLike("room", ROOM_V2, "g-cafe", hashFields({ ...ROOM_V1, "#parent": "g-cafe" }));
  assert.equal(v1, hashFields({ ...ROOM_V1, "#parent": "g-cafe" }));
  assert.notEqual(v1, room);
});

test("Р8.0: isCurrentHash — only the current version in the current scope", () => {
  const roomV1 = hashFields({ ...ROOM_V1, "#parent": "g" });
  assert.equal(isCurrentHash("room", rowHash("room", ROOM_V2, "g")), true);
  assert.equal(isCurrentHash("room", roomV1), false);
  assert.equal(isCurrentHash("room", rowHash("room", ROOM_V2, "g"), "foreign"), true, "rooms have one field set");
  const positionV1 = hashFields({ name: "Повар", "#parent": null });
  assert.equal(isCurrentHash("position", positionV1), false);
  assert.equal(isCurrentHash("position", rowHash("position", { name: "Повар" })), true);
  assert.equal(isCurrentHash("position", rowHash("position", { name: "Повар" }), "foreign"), false);
  assert.equal(isCurrentHash("position", rowHash("position", { name: "Повар" }, null, "foreign"), "foreign"), true);
  // Staff are unchanged: both scopes of version 1 are current in their own scope.
  assert.equal(isCurrentHash("staff", rowHash("staff", { name: "И" }, "g")), true);
  assert.equal(isCurrentHash("staff", rowHash("staff", { name: "И" }, "g", "foreign"), "foreign"), true);
  assert.equal(isCurrentHash("staff", rowHash("staff", { name: "И" }, "g"), "foreign"), false);
});

test("Р8.0: rowHashLike — the row's fingerprint in the link's version and scope, null when it cannot be computed", () => {
  // An unedited room: its version-1 fingerprint equals the stored one, whatever its schedule now.
  const stored = hashFields({ ...ROOM_V1, "#parent": "g" });
  assert.equal(rowHashLike("room", ROOM_V2, "g", stored), stored);
  assert.equal(rowHashLike("room", { ...ROOM_V2, detergent: "Другое", climateNorms: "{}" }, "g", stored), stored);
  // A renamed room: the version-1 fingerprint differs — a real edit.
  assert.notEqual(rowHashLike("room", { ...ROOM_V2, name: "Кухня 2" }, "g", stored), stored);
  // A current link: the same as rowHash.
  assert.equal(rowHashLike("room", ROOM_V2, "g", rowHash("room", ROOM_V2, "g")), rowHash("room", ROOM_V2, "g"));

  // Positions: version 1 (name) from rows read inside the account or between accounts.
  const cook = { name: "Повар", journals: '["cleaning","hygiene"]' };
  const positionV1 = hashFields({ name: "Повар", "#parent": null });
  assert.equal(rowHashLike("position", cook, null, positionV1), positionV1);
  assert.equal(rowHashLike("position", { name: "Повар" }, null, positionV1, "foreign"), positionV1);
  // Between accounts the journals are not read: a full version-2 fingerprint cannot be computed.
  assert.equal(rowHashLike("position", { name: "Повар" }, null, rowHash("position", cook), "foreign"), null);
  // Back inside the account the restricted one can.
  const restricted = rowHash("position", cook, null, "foreign");
  assert.equal(rowHashLike("position", cook, null, restricted), restricted);

  // Staff keep the Р5 behaviour: full from restricted rows — no; restricted from full rows — yes.
  const person = { name: "Иванов Иван", phone: "+79850000000", weeklyDaysOff: [5, 6] };
  assert.equal(rowHashLike("staff", { name: person.name }, "g", rowHash("staff", person, "g"), "foreign"), null);
  assert.equal(rowHashLike("staff", person, "g", rowHash("staff", person, "g", "foreign")), rowHash("staff", person, "g", "foreign"));

  // A version this code does not know (a newer fingerprint after a rollback) — null, never «edited».
  assert.equal(rowHashLike("room", ROOM_V2, "g", "v3:0123456789abcdef0123456789ab"), null);
  // A scope mark the version never had — null.
  assert.equal(rowHashLike("room", ROOM_V2, "g", "f:v2:0123456789abcdef0123456789ab"), null);
});
