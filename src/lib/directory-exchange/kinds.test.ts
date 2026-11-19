import assert from "node:assert/strict";
import test from "node:test";

import {
  ENTITY_FIELDS,
  ENTITY_KIND,
  ENTITY_PARENT,
  EXCHANGE_ENTITIES,
  EXCHANGE_KINDS,
  KIND_ENTITIES,
  hashFields,
  naturalKey,
  normalizeExchangeKinds,
  normalizeExchangeName,
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
