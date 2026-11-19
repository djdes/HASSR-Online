import assert from "node:assert/strict";
import test from "node:test";

import { planEntityExchange, type ExchangeLinkRow, type ExchangeOp, type ExchangeRow } from "@/lib/directory-exchange/plan";

const T0 = new Date("2026-11-19T10:00:00.000Z").getTime();
const at = (minutes: number) => new Date(T0 + minutes * 60_000);

/** Мир в памяти: строки участников и таблица соответствий. */
type World = { participants: string[]; rows: Record<string, ExchangeRow[]>; links: ExchangeLinkRow[]; seq: number };

function world(participants: string[], rows: Record<string, ExchangeRow[]> = {}): World {
  const filled: Record<string, ExchangeRow[]> = {};
  for (const id of participants) filled[id] = rows[id] ?? [];
  for (const id of Object.keys(rows)) filled[id] = rows[id];
  return { participants, rows: filled, links: [], seq: 0 };
}

const row = (id: string, key: string | null, hash: string, updatedAt: Date | null = null): ExchangeRow => ({ id, key, hash, updatedAt });

function plan(w: World): ExchangeOp[] {
  return planEntityExchange({
    participants: w.participants,
    rows: w.rows,
    links: w.links,
    newGroupId: () => `g${(w.seq += 1)}`,
  });
}

function linkOf(w: World, groupId: string, organizationId: string): ExchangeLinkRow | undefined {
  return w.links.find((link) => link.groupId === groupId && link.organizationId === organizationId);
}

function setLink(w: World, groupId: string, organizationId: string, entityId: string | null, hash: string) {
  const existing = linkOf(w, groupId, organizationId);
  if (existing) Object.assign(existing, { entityId, hash });
  else w.links.push({ groupId, organizationId, entityId, hash });
}

/** Применить план так, как это сделал бы обмен, когда всё удалось. */
function apply(w: World, ops: ExchangeOp[]) {
  for (const op of ops) {
    if (op.type === "link" || op.type === "rehash") setLink(w, op.groupId, op.organizationId, op.entityId, op.hash);
    else if (op.type === "tombstone") setLink(w, op.groupId, op.organizationId, null, linkOf(w, op.groupId, op.organizationId)?.hash ?? "");
    else {
      const source = w.rows[op.fromOrganizationId].find((item) => item.id === op.fromEntityId);
      assert.ok(source, `source row ${op.fromEntityId} exists`);
      if (op.type === "create") {
        const id = `${op.organizationId}:${op.groupId}`;
        w.rows[op.organizationId].push({ ...source, id });
        setLink(w, op.groupId, op.organizationId, id, op.hash);
      } else {
        const target = w.rows[op.organizationId].find((item) => item.id === op.entityId);
        assert.ok(target, `target row ${op.entityId} exists`);
        Object.assign(target, { key: source.key, hash: source.hash, updatedAt: source.updatedAt });
        setLink(w, op.groupId, op.organizationId, op.entityId, op.hash);
      }
    }
  }
}

/** Обмен целиком; сразу после него план обязан быть пустым. */
function sync(w: World): ExchangeOp[] {
  const ops = plan(w);
  apply(w, ops);
  assert.deepEqual(plan(w), [], "second run right after applying the plan is empty");
  return ops;
}

const types = (ops: ExchangeOp[]) => ops.map((op) => `${op.type}:${op.organizationId}`).sort();
const edit = (w: World, organizationId: string, id: string, patch: Partial<ExchangeRow>) =>
  Object.assign(w.rows[organizationId].find((item) => item.id === id)!, patch);
const remove = (w: World, organizationId: string, id: string) => {
  w.rows[organizationId] = w.rows[organizationId].filter((item) => item.id !== id);
};

test("unlinked rows with the same natural key are matched into one group, nothing is created", () => {
  const w = world(["A", "B"], { A: [row("a1", "raw|молоко", "h1")], B: [row("b1", "raw|молоко", "h1")] });
  const ops = sync(w);
  assert.deepEqual(types(ops), ["link:A", "link:B"]);
  assert.equal(w.links.length, 2);
  assert.equal(w.links[0].groupId, w.links[1].groupId);
  assert.equal(w.rows.B.length, 1);
});

test("matched rows that differ are only linked — nothing is overwritten until one of them is edited", () => {
  const w = world(["A", "B"], {
    A: [row("a1", "k", "rich", at(0))],
    B: [row("b1", "k", "poor", at(5))],
  });
  assert.deepEqual(types(sync(w)), ["link:A", "link:B"]);
  assert.deepEqual([w.rows.A[0].hash, w.rows.B[0].hash], ["rich", "poor"]);
  assert.deepEqual(w.links.map((link) => link.hash), ["rich", "poor"]);

  // Правка одной из них доходит до другой целиком.
  edit(w, "A", "a1", { hash: "rich-2", updatedAt: at(10) });
  assert.deepEqual(types(sync(w)), ["rehash:A", "update:B"]);
  assert.equal(w.rows.B[0].hash, "rich-2");
});

test("a brand-new group is created elsewhere from the latest record, without dates — from the first participant", () => {
  const dated = world(["A", "B", "C"], { A: [row("a1", "k", "old", at(0))], B: [row("b1", "k", "new", at(5))] });
  const datedOps = sync(dated);
  assert.deepEqual(types(datedOps), ["create:C", "link:A", "link:B"]);
  assert.equal(dated.rows.C[0].hash, "new");

  const undated = world(["A", "B", "C"], { A: [row("a1", "k", "first")], B: [row("b1", "k", "second")] });
  sync(undated);
  assert.equal(undated.rows.C[0].hash, "first");
});

test("a new record is created at every other participant from the sample", () => {
  const two = world(["A", "B"], { A: [row("a1", "k1", "h1")] });
  const ops = sync(two);
  assert.deepEqual(types(ops), ["create:B", "link:A"]);
  const create = ops.find((op) => op.type === "create");
  assert.deepEqual(create, { type: "create", groupId: "g1", organizationId: "B", fromOrganizationId: "A", fromEntityId: "a1", hash: "h1" });
  assert.equal(two.rows.B.length, 1);

  const three = world(["A", "B", "C"], { B: [row("b1", "k1", "h1"), row("b2", "k2", "h2")] });
  assert.deepEqual(types(sync(three)), ["create:A", "create:A", "create:C", "create:C", "link:B", "link:B"]);
  assert.equal(three.rows.A.length, 2);
  assert.equal(three.rows.C.length, 2);
  assert.equal(three.links.length, 6);
});

test("an edit in one participant updates the others and refreshes its own hash", () => {
  const w = world(["A", "B", "C"], { A: [row("a1", "k", "h1")] });
  sync(w);
  edit(w, "B", "B:g1", { hash: "h2", key: "k2" });
  const ops = sync(w);
  assert.deepEqual(types(ops), ["rehash:B", "update:A", "update:C"]);
  assert.ok(ops.filter((op) => op.type === "update").every((op) => op.type === "update" && op.fromOrganizationId === "B" && op.hash === "h2"));
  assert.deepEqual([w.rows.A[0].hash, w.rows.C[0].hash, w.rows.A[0].key], ["h2", "h2", "k2"]);
  assert.ok(w.links.every((link) => link.hash === "h2"));
});

test("edits in two participants: the later one wins; without dates the first participant wins", () => {
  const dated = world(["A", "B", "C"], { A: [row("a1", "k", "h1", at(0))] });
  sync(dated);
  edit(dated, "A", "a1", { hash: "fromA", updatedAt: at(10) });
  edit(dated, "B", "B:g1", { hash: "fromB", updatedAt: at(20) });
  const ops = sync(dated);
  assert.deepEqual(types(ops), ["rehash:B", "update:A", "update:C"]);
  assert.deepEqual([dated.rows.A[0].hash, dated.rows.B[0].hash, dated.rows.C[0].hash], ["fromB", "fromB", "fromB"]);

  const undated = world(["A", "B"], { A: [row("a1", "k", "h1")] });
  sync(undated);
  edit(undated, "A", "a1", { hash: "fromA" });
  edit(undated, "B", "B:g1", { hash: "fromB" });
  assert.deepEqual(types(sync(undated)), ["rehash:A", "update:B"]);
  assert.equal(undated.rows.B[0].hash, "fromA");

  // Порядок участников — порядок спора: тот же случай с B первым.
  const reversed = world(["B", "A"], { A: [row("a1", "k", "h1")] });
  sync(reversed);
  edit(reversed, "A", "a1", { hash: "fromA" });
  edit(reversed, "B", "B:g1", { hash: "fromB" });
  sync(reversed);
  assert.equal(reversed.rows.A[0].hash, "fromB");
});

test("the same edit on both sides only refreshes hashes", () => {
  const w = world(["A", "B"], { A: [row("a1", "k", "h1")] });
  sync(w);
  edit(w, "A", "a1", { hash: "same" });
  edit(w, "B", "B:g1", { hash: "same" });
  assert.deepEqual(types(sync(w)), ["rehash:A", "rehash:B"]);
});

test("deletion is not propagated: no re-creation at the deleter, nothing removed elsewhere", () => {
  const w = world(["A", "B"], { A: [row("a1", "k", "h1")] });
  sync(w);
  remove(w, "A", "a1");
  const ops = sync(w);
  assert.deepEqual(ops, [{ type: "tombstone", groupId: "g1", organizationId: "A" }]);
  assert.equal(linkOf(w, "g1", "A")?.entityId, null);
  assert.equal(w.rows.A.length, 0);
  assert.equal(w.rows.B.length, 1);
  // И на следующих обменах запись не возвращается.
  assert.deepEqual(plan(w), []);
});

test("a tombstoned participant does not receive later updates, the rest do", () => {
  const w = world(["A", "B", "C"], { A: [row("a1", "k", "h1")] });
  sync(w);
  remove(w, "B", "B:g1");
  sync(w);
  edit(w, "A", "a1", { hash: "h2" });
  const ops = sync(w);
  assert.deepEqual(types(ops), ["rehash:A", "update:C"]);
  assert.equal(w.rows.B.length, 0);
  assert.equal(w.rows.C[0].hash, "h2");
  assert.equal(linkOf(w, "g1", "B")?.entityId, null);
});

test("a group whose every record is gone produces nothing", () => {
  const w = world(["A", "B"], { A: [row("a1", "k", "h1")] });
  sync(w);
  remove(w, "A", "a1");
  remove(w, "B", "B:g1");
  assert.deepEqual(types(sync(w)), ["tombstone:A", "tombstone:B"]);
  assert.deepEqual(plan(w), []);
});

test("deleted and entered again under the same key: the link comes back instead of a duplicate", () => {
  const w = world(["A", "B"], { A: [row("a1", "k", "h1")] });
  sync(w);
  remove(w, "A", "a1");
  w.rows.A.push(row("a2", "k", "mine"));
  // В одном обмене: старая запись исчезла, новая с тем же ключом уже есть.
  const ops = sync(w);
  assert.deepEqual(types(ops), ["link:A"]);
  assert.equal(linkOf(w, "g1", "A")?.entityId, "a2");
  assert.equal(w.rows.A[0].hash, "mine");
  assert.equal(w.rows.B.length, 1);

  // И когда надгробие уже записано прошлым обменом.
  const later = world(["A", "B"], { A: [row("a1", "k", "h1")] });
  sync(later);
  remove(later, "A", "a1");
  sync(later);
  later.rows.A.push(row("a2", "k", "h1"));
  assert.deepEqual(types(sync(later)), ["link:A"]);
  assert.equal(linkOf(later, "g1", "A")?.entityId, "a2");
  assert.equal(later.rows.B.length, 1);
});

test("rows without a key are not exchanged; a linked row that lost its key is left alone", () => {
  const w = world(["A", "B"], { A: [row("a1", null, "h1"), row("a2", "k", "h2")] });
  const ops = sync(w);
  assert.deepEqual(types(ops), ["create:B", "link:A"]);
  assert.equal(w.rows.B.length, 1);

  edit(w, "A", "a2", { key: null, hash: "h3" });
  assert.deepEqual(plan(w), []);
  // Правка у другого участника до записи без ключа не доходит.
  edit(w, "B", "B:g1", { hash: "h4" });
  assert.deepEqual(types(sync(w)), ["rehash:B"]);
  assert.equal(w.rows.A[1].hash, "h3");
});

test("two unlinked rows with one key in one organization: only the first is linked, no loop", () => {
  const w = world(["A", "B"], { A: [row("a1", "k", "h1"), row("a2", "k", "h1x")] });
  const ops = sync(w);
  assert.deepEqual(types(ops), ["create:B", "link:A"]);
  assert.deepEqual(ops[0], { type: "link", groupId: "g1", organizationId: "A", entityId: "a1", hash: "h1" });
  assert.equal(w.rows.B.length, 1);
  assert.equal(w.links.length, 2);
  // Сколько ни запускай — дубль не привязывается и ничего не порождает.
  assert.deepEqual(plan(w), []);
  assert.deepEqual(plan(w), []);

  // Дубли с обеих сторон: по одной записи в группе, вторые — без связи.
  const both = world(["A", "B"], {
    A: [row("a1", "k", "h"), row("a2", "k", "h")],
    B: [row("b1", "k", "h"), row("b2", "k", "h")],
  });
  assert.deepEqual(types(sync(both)), ["link:A", "link:B"]);
  assert.deepEqual(both.links.map((link) => link.entityId).sort(), ["a1", "b1"]);
});

test("a duplicate that appears next to a linked row stays unlinked", () => {
  const w = world(["A", "B"], { A: [row("a1", "k", "h1")] });
  sync(w);
  w.rows.B.push(row("b9", "k", "other"));
  assert.deepEqual(plan(w), []);
  assert.equal(w.rows.A.length, 1);
});

test("key collision between different groups: the first free group is taken, the other is created", () => {
  const w = world(["A", "B"], { A: [row("a1", "k1", "h1"), row("a2", "k2", "h2")] });
  sync(w);
  // Вторую запись переименовали — ключи двух групп совпали.
  edit(w, "A", "a2", { key: "k1", hash: "h2b" });
  sync(w);
  assert.deepEqual(w.rows.B.map((item) => item.key), ["k1", "k1"]);

  w.participants.push("C");
  w.rows.C = [row("c1", "k1", "h1")];
  const ops = sync(w);
  assert.deepEqual(types(ops), ["create:C", "link:C"]);
  const link = ops.find((op) => op.type === "link");
  const create = ops.find((op) => op.type === "create");
  assert.equal(link?.groupId, "g1");
  assert.equal(create?.groupId, "g2");
  assert.equal(w.rows.C.length, 2);
  assert.equal(new Set(w.links.filter((item) => item.organizationId === "C").map((item) => item.groupId)).size, 2);
});

test("a newcomer is linked to the established records and receives the missing ones", () => {
  const w = world(["A", "B"], { A: [row("a1", "k1", "h1", at(0)), row("a2", "k2", "h2", at(0))] });
  sync(w);
  w.participants.push("C");
  // У новичка запись с тем же ключом новее и другая: ничьи данные не меняются.
  w.rows.C = [row("c1", "k1", "mine", at(60))];
  const ops = sync(w);
  assert.deepEqual(types(ops), ["create:C", "link:C"]);
  assert.equal(w.rows.C.find((item) => item.id === "c1")?.hash, "mine");
  assert.deepEqual([w.rows.A[0].hash, w.rows.B[0].hash], ["h1", "h1"]);
  // Недостающее новичок получает от давнего участника.
  const create = ops.find((op) => op.type === "create");
  assert.ok(create?.type === "create" && create.fromOrganizationId === "A" && create.hash === "h2");
  assert.equal(w.rows.C.length, 2);

  // Правка новичка расходится по всем, правка давнего участника — доходит до новичка.
  edit(w, "C", "c1", { hash: "mine-2", updatedAt: at(90) });
  assert.deepEqual(types(sync(w)), ["rehash:C", "update:A", "update:B"]);
  edit(w, "A", "a1", { hash: "h1-3", updatedAt: at(120) });
  assert.deepEqual(types(sync(w)), ["rehash:A", "update:B", "update:C"]);
});

test("an edit and a first link in one run: the edit also reaches the record linked just now", () => {
  const w = world(["A", "B"], { A: [row("a1", "k", "h1")] });
  sync(w);
  w.participants.push("C");
  w.rows.C = [row("c1", "k", "mine")];
  edit(w, "A", "a1", { hash: "h2" });
  const ops = sync(w);
  assert.deepEqual(types(ops), ["link:C", "rehash:A", "update:B", "update:C"]);
  assert.deepEqual([w.rows.B[0].hash, w.rows.C[0].hash], ["h2", "h2"]);
});

test("links of organizations outside the run are ignored, a lone participant exchanges nothing", () => {
  const w = world(["A", "B"], { A: [row("a1", "k", "h1")] });
  sync(w);
  // B временно не участвует: его записи не считаются удалёнными и не создаются заново.
  w.participants = ["A", "C"];
  w.rows.C = [];
  const ops = sync(w);
  assert.deepEqual(types(ops), ["create:C"]);
  assert.equal(linkOf(w, "g1", "B")?.entityId, "B:g1");

  w.participants = ["A"];
  edit(w, "A", "a1", { hash: "h2" });
  assert.deepEqual(plan(w), []);
  assert.deepEqual(planEntityExchange({ participants: [], rows: {}, links: [], newGroupId: () => "x" }), []);
});

test("established records that differ without an edit are not rewritten", () => {
  // Запись у получателя сохранилась иначе, чем образец (например, телефон
  // привели к формату): отпечаток связи равен её собственному.
  const w = world(["A", "B"], { A: [row("a1", "k", "h1")], B: [row("b1", "k", "h1-normalized")] });
  w.links.push(
    { groupId: "g1", organizationId: "A", entityId: "a1", hash: "h1" },
    { groupId: "g1", organizationId: "B", entityId: "b1", hash: "h1-normalized" },
  );
  assert.deepEqual(plan(w), []);
  // А настоящая правка доходит.
  edit(w, "A", "a1", { hash: "h2" });
  assert.deepEqual(types(plan(w)), ["rehash:A", "update:B"]);
});

test("operations come in a safe order: tombstones, links, then changes", () => {
  const w = world(["A", "B"], { A: [row("a1", "k1", "h1"), row("a2", "k2", "h2")] });
  sync(w);
  remove(w, "A", "a1");
  edit(w, "A", "a2", { hash: "h2b" });
  w.rows.B.push(row("b3", "k3", "h3"));
  const ops = plan(w);
  assert.deepEqual(ops.map((op) => op.type), ["tombstone", "link", "update", "rehash", "create"]);
});
