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
  hashScope,
  naturalKey,
  normalizeExchangeKinds,
  normalizeExchangeName,
  pickExchangeFields,
  rowHash,
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

test("rule Р5: between accounts an employee is a name and a position, nothing else", () => {
  assert.deepEqual(FOREIGN_ENTITY_FIELDS, { staff: ["name"] });
  assert.deepEqual([...exchangedFields("staff", "foreign")], ["name"]);
  assert.deepEqual([...exchangedFields("staff", "account")], ["name", "phone", "weeklyDaysOff"]);
  assert.deepEqual([...exchangedFields("staff")], ["name", "phone", "weeklyDaysOff"]);
  // Every other entity has one field set, whoever takes part.
  for (const entity of EXCHANGE_ENTITIES) {
    if (entity === "staff") continue;
    assert.deepEqual([...exchangedFields(entity, "foreign")], [...ENTITY_FIELDS[entity]], entity);
    assert.equal(entityScope(entity, "foreign"), "account", entity);
  }
  assert.equal(entityScope("staff", "foreign"), "foreign");
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
  assert.equal(rowHash("position", { name: "Повар" }, null, "foreign"), rowHash("position", { name: "Повар" }));
  assert.equal(hashScope("product", rowHash("product", product, null, "foreign")), "account");
  assert.equal(hashScope("product", "f:whatever"), "account");
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
