import assert from "node:assert/strict";
import { test } from "node:test";

import {
  exchangeParticipants,
  isEmptyResult,
  linkMembers,
  parseState,
  parseSummary,
  parseTransferItems,
  summaryTotals,
  togglePicked,
  transferSelection,
  type ExchangeMember,
  type TransferItem,
  type TransferItems,
} from "./exchange-api";

const member = (organizationId: string, kinds: ExchangeMember["kinds"]): ExchangeMember => ({
  organizationId,
  name: organizationId,
  kinds,
  lastSyncedAt: null,
});

const stateOf = (members: ExchangeMember[]) => ({ organization: { id: "new", name: "Новая" }, members });

test("link: the current organisation and every selected sibling carry the chosen lists", () => {
  assert.deepEqual(linkMembers(stateOf([]), ["a", "b", "a"], ["staff", "products"]), [
    { organizationId: "new", kinds: ["products", "staff"] },
    { organizationId: "a", kinds: ["products", "staff"] },
    { organizationId: "b", kinds: ["products", "staff"] },
  ]);
});

test("link: joining an existing exchange does not cut the lists other organisations share", () => {
  const members = [member("a", ["products", "staff"]), member("b", ["products", "staff"])];
  assert.deepEqual(linkMembers(stateOf(members), ["a"], ["equipment"]), [
    { organizationId: "new", kinds: ["equipment"] },
    { organizationId: "a", kinds: ["products", "staff", "equipment"] },
  ]);
});

test("link: a list left with a single participant is dropped from the linked sibling", () => {
  const members = [member("new", ["products", "staff"]), member("a", ["products", "staff"])];
  assert.deepEqual(linkMembers(stateOf(members), ["a"], ["products"]), [
    { organizationId: "new", kinds: ["products"] },
    { organizationId: "a", kinds: ["products"] },
  ]);
});

test("link: no lists means the current organisation leaves and nobody else is touched", () => {
  const members = [member("new", ["products"]), member("a", ["products"])];
  assert.deepEqual(linkMembers(stateOf(members), ["a"], []), [{ organizationId: "new", kinds: [] }]);
});

const items: TransferItems = {
  products: [
    { id: "p1", name: "Молоко", detail: null, exists: false, parentId: null },
    { id: "p2", name: "Сыр", detail: "Молочная продукция", exists: true, parentId: null },
    { id: "p3", name: "Хлеб", detail: null, exists: false, parentId: null },
  ],
  staff: [{ id: "s1", name: "Иванова Мария", detail: "Повар", exists: false, parentId: null }],
  objects: [{ id: "o1", name: "Кафе", detail: null, exists: true, parentId: null }],
  equipment: [],
};

test("transfer: everything available goes as «all», a part goes by id, empty lists are not sent", () => {
  const picked = { products: ["p1", "p2", "p3"], staff: ["s1"], objects: ["o1"], equipment: [] };
  assert.deepEqual(transferSelection(items, ["products", "staff", "objects", "equipment"], picked), {
    products: "all",
    staff: "all",
  });
  assert.deepEqual(transferSelection(items, ["products", "staff"], { ...picked, products: ["p3"] }), {
    products: ["p3"],
    staff: "all",
  });
  // Список не отмечен галочкой — его позиции не едут, даже если выбраны.
  assert.deepEqual(transferSelection(items, ["staff"], picked), { staff: "all" });
});

test("transfer: a record brings its parent, a parent takes its records along", () => {
  // Должность «Повар» уже есть у получателя, «Бармен» — нет.
  const staff: TransferItem[] = [
    { id: "cook", name: "Повар", detail: null, exists: true, parentId: null },
    { id: "ivanova", name: "Иванова", detail: "Повар", exists: false, parentId: "cook" },
    { id: "barman", name: "Бармен", detail: null, exists: false, parentId: null },
    { id: "petrov", name: "Петров", detail: "Бармен", exists: false, parentId: "barman" },
    { id: "sidorov", name: "Сидоров", detail: "Бармен", exists: true, parentId: "barman" },
  ];
  // Запись тянет родителя, которого ещё нет; существующий родитель не отмечается.
  assert.deepEqual(togglePicked(staff, [], "petrov"), ["barman", "petrov"]);
  assert.deepEqual(togglePicked(staff, [], "ivanova"), ["ivanova"]);
  // Родитель отмечает свои записи (кроме тех, что уже есть) и снимает их вместе с собой.
  assert.deepEqual(togglePicked(staff, ["ivanova"], "barman"), ["ivanova", "barman", "petrov"]);
  assert.deepEqual(togglePicked(staff, ["ivanova", "barman", "petrov"], "barman"), ["ivanova"]);
  // Снятая запись родителя не снимает: должность можно перенести и без людей.
  assert.deepEqual(togglePicked(staff, ["barman", "petrov"], "petrov"), ["barman"]);
  // То, что у получателя уже есть, и неизвестный id выбор не меняют.
  assert.deepEqual(togglePicked(staff, ["ivanova"], "cook"), ["ivanova"]);
  assert.deepEqual(togglePicked(staff, ["ivanova"], "missing"), ["ivanova"]);
});

test("responses are parsed defensively and totals are summed per organisation", () => {
  assert.equal(parseState(null), null);
  assert.equal(parseState({ canManage: true }), null);
  const state = parseState({
    canManage: true,
    organization: { id: "new", name: "Новая" },
    counts: { products: 3, staff: "7" },
    siblings: [{ id: "a", name: "Кафе", counts: { equipment: 2 }, locked: true }, { name: "без id" }],
    cabinet: null,
    members: [
      { organizationId: "a", name: "Кафе", kinds: ["staff", "unknown", "products"], lastSyncedAt: "2026-11-19T01:00:00.000Z" },
      { organizationId: "b", name: "Вышла", kinds: [] },
    ],
    lastSync: { organizations: [], notes: ["  ", "Заметка"] },
  });
  if (!state) throw new Error("a complete response must be parsed");
  assert.deepEqual(state.counts, { products: 3, staff: 0, objects: 0, equipment: 0 });
  assert.deepEqual(state.siblings, [
    { id: "a", name: "Кафе", counts: { products: 0, staff: 0, objects: 0, equipment: 2 }, locked: true },
  ]);
  assert.deepEqual(state.members[0].kinds, ["products", "staff"]);
  assert.deepEqual(exchangeParticipants(state).map((entry) => entry.organizationId), ["a"]);
  assert.deepEqual(state.lastSync, { organizations: [], notes: ["Заметка"] });

  const parsed = parseTransferItems({
    items: {
      staff: [
        { id: "cook", name: "Повар", detail: " ", exists: 1, entity: "position", parentId: null },
        { id: "s1", name: "Иванова", detail: "Повар", exists: true, entity: "staff", parentId: "cook" },
        { name: "без id" },
      ],
    },
  });
  assert.deepEqual(parsed, {
    products: [],
    staff: [
      { id: "cook", name: "Повар", detail: null, exists: false, parentId: null },
      { id: "s1", name: "Иванова", detail: "Повар", exists: true, parentId: "cook" },
    ],
    objects: [],
    equipment: [],
  });

  const summary = parseSummary({
    organizations: [
      { organizationId: "a", name: "Кафе", kinds: { staff: { created: 2, updated: 1, skippedLimit: 3, skippedConflict: 0 } } },
      { organizationId: "new", name: "Новая", kinds: { products: { created: 5 }, objects: null } },
    ],
  });
  assert.deepEqual(summaryTotals(summary), { created: 7, updated: 1, skippedLimit: 3, skippedConflict: 0 });
  assert.deepEqual(summaryTotals(summary, "new"), { created: 5, updated: 0, skippedLimit: 0, skippedConflict: 0 });
  assert.equal(isEmptyResult(summaryTotals(summary, "missing")), true);
  assert.equal(isEmptyResult(summaryTotals(null)), true);
});
