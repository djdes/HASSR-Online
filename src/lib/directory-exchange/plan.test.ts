import assert from "node:assert/strict";
import test from "node:test";

import {
  hashFields,
  hashScope,
  isCurrentHash,
  rowHash,
  rowHashLike,
  type ExchangeEntity,
  type ExchangeFields,
  type ExchangeScope,
} from "@/lib/directory-exchange/kinds";
import {
  MIXED_ORIGIN,
  companyReceivesGroup,
  legacyGroupOrigin,
  pendingGroupOrigins,
  planEntityExchange,
  rebaseLinks,
  unmarkedGroupRecords,
  type DatedLinkRow,
  type ExchangeCompanies,
  type ExchangeLinkRow,
  type ExchangeOp,
  type ExchangeRow,
} from "@/lib/directory-exchange/plan";

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

function plan(w: World, passive: string[] = [], companies?: ExchangeCompanies): ExchangeOp[] {
  return planEntityExchange({
    participants: w.participants,
    rows: w.rows,
    links: w.links,
    passive,
    companies,
    newGroupId: () => `g${(w.seq += 1)}`,
  });
}

function linkOf(w: World, groupId: string, organizationId: string): ExchangeLinkRow | undefined {
  return w.links.find((link) => link.groupId === groupId && link.organizationId === organizationId);
}

/** Новая связь группы получает её отметку (Р6.2), как в run.server.ts; правка отметку не трогает. */
function setLink(w: World, groupId: string, organizationId: string, entityId: string | null, hash: string, origin?: string) {
  const existing = linkOf(w, groupId, organizationId);
  if (existing) Object.assign(existing, { entityId, hash });
  else {
    const originOrganizationId = origin ?? w.links.find((link) => link.groupId === groupId && link.originOrganizationId)?.originOrganizationId;
    w.links.push({ groupId, organizationId, entityId, hash, ...(originOrganizationId ? { originOrganizationId } : {}) });
  }
}

/** Применить план так, как это сделал бы обмен, когда всё удалось. */
function apply(w: World, ops: ExchangeOp[]) {
  for (const op of ops) {
    if (op.type === "link") setLink(w, op.groupId, op.organizationId, op.entityId, op.hash, op.originOrganizationId);
    else if (op.type === "rehash") setLink(w, op.groupId, op.organizationId, op.entityId, op.hash);
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
  // Запись, основавшая группу, — её отметка (Р6.2).
  assert.deepEqual(ops[0], { type: "link", groupId: "g1", organizationId: "A", entityId: "a1", hash: "h1", originOrganizationId: "A" });
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

/* ── rule Р5: the staff field set changes when a foreign organization joins or leaves ── */

type Person = ExchangeRow & { fields: ExchangeFields; parentGroupId: string };

/** An employee as the exchange reads it in the given field set: between accounts the phone and days off are not read at all. */
function person(id: string, scope: ExchangeScope, fields: { name: string; phone?: string | null; weeklyDaysOff?: number[] }): Person {
  const read: ExchangeFields = scope === "foreign" ? { name: fields.name } : { name: fields.name, phone: fields.phone ?? null, weeklyDaysOff: fields.weeklyDaysOff ?? [] };
  return { id, key: fields.name.toLowerCase(), hash: rowHash("staff", read, "g-cook", scope), updatedAt: null, fields: read, parentGroupId: "g-cook" };
}

/** What `run.server.ts` does before planning: links taken in another field set are re-based, not treated as edits. */
function alignedPlan(scope: ExchangeScope, participants: string[], rows: Record<string, Person[]>, links: ExchangeLinkRow[]) {
  const aligned = rebaseLinks({
    rows,
    links,
    isCurrent: (hash) => hashScope("staff", hash) === scope,
    hashLike: (row, linkHash) => (scope === "account" ? rowHash("staff", row.fields, row.parentGroupId, hashScope("staff", linkHash)) : null),
  });
  let seq = 0;
  const ops = planEntityExchange({ participants, rows, links: aligned.links, newGroupId: () => `n${(seq += 1)}` });
  return { ops, rebased: aligned.rebased };
}

const IVANOV_A = { name: "Иванов Иван", phone: "+79850000001", weeklyDaysOff: [5, 6] };
const IVANOV_B = { name: "Иванов Иван", phone: "+79850000002", weeklyDaysOff: [0] };

test("Р5: a foreign organization joins — nobody's employee is rewritten, the newcomer gets a create", () => {
  // A and B exchanged inside the account and each kept its own phone (linked by name).
  const links: ExchangeLinkRow[] = [
    { groupId: "g1", organizationId: "A", entityId: "a1", hash: person("a1", "account", IVANOV_A).hash },
    { groupId: "g1", organizationId: "B", entityId: "b1", hash: person("b1", "account", IVANOV_B).hash },
  ];
  // Now R (another account) shares the list: everybody is read in the restricted set.
  const rows = { A: [person("a1", "foreign", IVANOV_A)], B: [person("b1", "foreign", IVANOV_B)], R: [] };

  // Without the alignment every stored fingerprint differs from the new one — the trap the alignment exists for.
  const naive = planEntityExchange({ participants: ["A", "B", "R"], rows, links, newGroupId: () => "x" });
  assert.ok(naive.some((op) => op.type === "rehash"), "naive plan sees every record as edited");

  const { ops, rebased } = alignedPlan("foreign", ["A", "B", "R"], rows, links);
  assert.deepEqual(types(ops), ["create:R"]);
  assert.ok(!ops.some((op) => op.type === "update"));
  // Both old links move to the restricted fingerprint — the next run compares like with like.
  assert.deepEqual(rebased.map((link) => `${link.organizationId}:${link.entityId}`).sort(), ["A:a1", "B:b1"]);
  assert.ok(rebased.every((link) => link.hash.startsWith("f:")));
});

test("Р5: with a foreign member a phone edit moves nothing, a rename moves the name only", () => {
  const stored = (id: string, fields: Parameters<typeof person>[2]) => person(id, "foreign", fields).hash;
  const links: ExchangeLinkRow[] = [
    { groupId: "g1", organizationId: "A", entityId: "a1", hash: stored("a1", IVANOV_A) },
    { groupId: "g1", organizationId: "B", entityId: "b1", hash: stored("b1", IVANOV_B) },
    { groupId: "g1", organizationId: "R", entityId: "r1", hash: stored("r1", { ...IVANOV_A, phone: null }) },
  ];
  // The phone changed in A: in the restricted set the record is the same record.
  const phoneEdit = { A: [person("a1", "foreign", { ...IVANOV_A, phone: "+79859999999" })], B: [person("b1", "foreign", IVANOV_B)], R: [person("r1", "foreign", IVANOV_A)] };
  const quiet = alignedPlan("foreign", ["A", "B", "R"], phoneEdit, links);
  assert.deepEqual(quiet.ops, []);
  assert.deepEqual(quiet.rebased, []);
  // The name changed in A: the others get an update (applied as name + position only).
  const rename = { ...phoneEdit, A: [person("a1", "foreign", { ...IVANOV_A, name: "Иванов Иван Петрович" })] };
  const renamed = alignedPlan("foreign", ["A", "B", "R"], rename, links);
  assert.deepEqual(types(renamed.ops), ["rehash:A", "update:B", "update:R"]);
});

test("Р5: the foreign organization leaves — different phones stay where they are, no update", () => {
  const links: ExchangeLinkRow[] = [
    { groupId: "g1", organizationId: "A", entityId: "a1", hash: person("a1", "foreign", IVANOV_A).hash },
    { groupId: "g1", organizationId: "B", entityId: "b1", hash: person("b1", "foreign", IVANOV_B).hash },
  ];
  // Back inside the account the phone and days off are read again and differ between A and B.
  const rows = { A: [person("a1", "account", IVANOV_A)], B: [person("b1", "account", IVANOV_B)] };

  // The trap: every record looks edited, and the first participant's phone would overwrite the other's.
  const naive = planEntityExchange({ participants: ["A", "B"], rows, links, newGroupId: () => "x" });
  assert.ok(naive.some((op) => op.type === "update"), "naive plan pushes one organization's phone to the other");

  const { ops, rebased } = alignedPlan("account", ["A", "B"], rows, links);
  assert.deepEqual(ops, []);
  assert.deepEqual(rebased.map((link) => link.hash).sort(), [rows.A[0].hash, rows.B[0].hash].sort());
  assert.ok(rebased.every((link) => !link.hash.startsWith("f:")));

  // Once re-based, a later phone edit is an ordinary edit again.
  const after: ExchangeLinkRow[] = links.map((link) => ({ ...link, hash: rebased.find((item) => item.organizationId === link.organizationId)!.hash }));
  const edited = { ...rows, A: [person("a1", "account", { ...IVANOV_A, phone: "+79857777777" })] };
  assert.deepEqual(types(alignedPlan("account", ["A", "B"], edited, after).ops), ["rehash:A", "update:B"]);
});

test("Р5: a rename made just before the foreign organization left is still delivered", () => {
  const links: ExchangeLinkRow[] = [
    { groupId: "g1", organizationId: "A", entityId: "a1", hash: person("a1", "foreign", IVANOV_A).hash },
    { groupId: "g1", organizationId: "B", entityId: "b1", hash: person("b1", "foreign", IVANOV_B).hash },
  ];
  const rows = { A: [person("a1", "account", { ...IVANOV_A, name: "Иванов Иван Петрович" })], B: [person("b1", "account", IVANOV_B)] };
  const { ops, rebased } = alignedPlan("account", ["A", "B"], rows, links);
  // A really changed (its restricted fingerprint differs from the stored one): only B is re-based.
  assert.deepEqual(rebased.map((link) => link.organizationId), ["B"]);
  assert.deepEqual(types(ops), ["rehash:A", "update:B"]);
});

test("rebaseLinks: tombstones, missing rows and current links are left alone", () => {
  const rows = { A: [person("a1", "foreign", IVANOV_A)], B: [] as Person[] };
  const links: ExchangeLinkRow[] = [
    { groupId: "g1", organizationId: "A", entityId: "a1", hash: person("a1", "foreign", IVANOV_A).hash },
    { groupId: "g1", organizationId: "B", entityId: null, hash: "" },
    { groupId: "g2", organizationId: "B", entityId: "gone", hash: person("gone", "account", IVANOV_B).hash },
    { groupId: "g3", organizationId: "C", entityId: "c1", hash: person("c1", "account", IVANOV_B).hash },
  ];
  const aligned = rebaseLinks({ rows, links, isCurrent: (hash) => hashScope("staff", hash) === "foreign", hashLike: () => null });
  assert.deepEqual(aligned.rebased, []);
  assert.deepEqual(aligned.links, links);
});

/* ── Р8.0: a new version of the field set (rooms with schedules, positions with journals) ── */

type Versioned = ExchangeRow & { fields: ExchangeFields; parentGroupId: string | null };

/** A record as the exchange reads it now (current version, given scope). */
function versioned(entity: ExchangeEntity, id: string, fields: ExchangeFields, parentGroupId: string | null, scope: ExchangeScope = "account"): Versioned {
  const name = String(fields.name).toLowerCase();
  return { id, key: name, hash: rowHash(entity, fields, parentGroupId, scope), updatedAt: null, fields, parentGroupId };
}

/** What `run.server.ts` does: version- and scope-aware alignment, then the plan. */
function versionedPlan(entity: ExchangeEntity, scope: ExchangeScope, rows: Record<string, Versioned[]>, links: ExchangeLinkRow[], passive: string[] = []) {
  const aligned = rebaseLinks({
    rows,
    links,
    isCurrent: (hash) => isCurrentHash(entity, hash, scope),
    hashLike: (item, linkHash) => rowHashLike(entity, item.fields, item.parentGroupId, linkHash, scope),
  });
  let seq = 0;
  const ops = planEntityExchange({ participants: Object.keys(rows), rows, links: aligned.links, passive, newGroupId: () => `n${(seq += 1)}` });
  return { ops, rebased: aligned.rebased, links: aligned.links };
}

/** A stored version-1 fingerprint, as the exchange wrote it before versions existed. */
const roomV1Hash = (fields: ExchangeFields, parent: string) =>
  hashFields({ name: fields.name ?? null, kind: fields.kind ?? null, sortOrder: fields.sortOrder ?? null, "#parent": parent });
const positionV1Hash = (name: string) => hashFields({ name, "#parent": null });

const KITCHEN = {
  name: "Кухня",
  kind: "kitchen",
  sortOrder: 1,
  currentScope: JSON.stringify([{ label: "Полы" }, { label: "Столы" }]),
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
} satisfies ExchangeFields;
// The same room elsewhere: another schedule, another detergent, climate norms set.
const KITCHEN_B = {
  ...KITCHEN,
  currentScope: JSON.stringify([{ label: "Пол" }]),
  generalScope: JSON.stringify([{ label: "Окна" }]),
  generalScheduleType: "monthly",
  generalMonthDays: JSON.stringify(["1", "last"]),
  detergent: "Ника",
  requirePhoto: true,
  climateNorms: JSON.stringify({ temperature: { enabled: true, min: 18, max: 22 }, humidity: { enabled: false, min: null, max: null } }),
} satisfies ExchangeFields;

test("Р8.0: version-1 links of unchanged rooms — only re-based, zero updates, each room keeps its schedule", () => {
  const rows = { A: [versioned("room", "a1", KITCHEN, "g-cafe")], B: [versioned("room", "b1", KITCHEN_B, "g-cafe")], C: [versioned("room", "c1", KITCHEN, "g-cafe")] };
  const links: ExchangeLinkRow[] = ["A", "B", "C"].map((org) => ({ groupId: "g1", organizationId: org, entityId: `${org.toLowerCase()}1`, hash: roomV1Hash(KITCHEN, "g-cafe") }));

  // The trap without versions: every link differs from the new fingerprint and A's schedule would overwrite B's.
  const naive = planEntityExchange({ participants: ["A", "B", "C"], rows, links, newGroupId: () => "x" });
  assert.ok(naive.some((op) => op.type === "update"), "a naive plan rewrites the neighbours");

  const { ops, rebased, links: aligned } = versionedPlan("room", "account", rows, links);
  assert.deepEqual(ops, []);
  assert.deepEqual(rebased.map((link) => `${link.organizationId}:${link.hash}`).sort(), [`A:${rows.A[0].hash}`, `B:${rows.B[0].hash}`, `C:${rows.C[0].hash}`].sort());
  assert.ok(rebased.every((link) => link.hash.startsWith("v2:")));
  // The next run compares like with like: nothing to do.
  assert.deepEqual(versionedPlan("room", "account", rows, aligned).ops, []);
  assert.deepEqual(versionedPlan("room", "account", rows, aligned).rebased, []);
});

test("Р8.0: a room renamed before the first versioned run — the edit propagates with its schedule", () => {
  const renamed = { ...KITCHEN, name: "Кухня горячая" };
  const rows = { A: [versioned("room", "a1", renamed, "g-cafe")], B: [versioned("room", "b1", KITCHEN_B, "g-cafe")] };
  const links: ExchangeLinkRow[] = [
    { groupId: "g1", organizationId: "A", entityId: "a1", hash: roomV1Hash(KITCHEN, "g-cafe") },
    { groupId: "g1", organizationId: "B", entityId: "b1", hash: roomV1Hash(KITCHEN, "g-cafe") },
  ];
  const { ops, rebased } = versionedPlan("room", "account", rows, links);
  // A really changed (its version-1 fingerprint differs): only B is re-based, B gets the update.
  assert.deepEqual(rebased.map((link) => link.organizationId), ["B"]);
  assert.deepEqual(types(ops), ["rehash:A", "update:B"]);
  const update = ops.find((op) => op.type === "update");
  assert.ok(update && update.type === "update" && update.fromEntityId === "a1" && update.hash === rows.A[0].hash);
});

test("Р8.0: after re-basing, a schedule or climate edit is an ordinary edit", () => {
  const rows = { A: [versioned("room", "a1", KITCHEN, "g-cafe")], B: [versioned("room", "b1", KITCHEN_B, "g-cafe")] };
  const links: ExchangeLinkRow[] = [
    { groupId: "g1", organizationId: "A", entityId: "a1", hash: rows.A[0].hash },
    { groupId: "g1", organizationId: "B", entityId: "b1", hash: rows.B[0].hash },
  ];
  assert.deepEqual(versionedPlan("room", "account", rows, links).ops, []);
  const climate = { ...rows, B: [versioned("room", "b1", { ...KITCHEN_B, climateNorms: JSON.stringify({ temperature: { enabled: true, min: 16, max: 20 }, humidity: { enabled: false, min: null, max: null } }) }, "g-cafe")] };
  assert.deepEqual(types(versionedPlan("room", "account", climate, links).ops), ["rehash:B", "update:A"]);
  const schedule = { ...rows, A: [versioned("room", "a1", { ...KITCHEN, currentDays: 31 }, "g-cafe")] };
  assert.deepEqual(types(versionedPlan("room", "account", schedule, links).ops), ["rehash:A", "update:B"]);
});

test("Р8.0: version-1 position links — different journals stay, zero updates; a rename carries the journals", () => {
  const cookA = { name: "Повар", journals: JSON.stringify(["cleaning", "hygiene"]) };
  const cookB = { name: "Повар", journals: JSON.stringify(["hygiene"]) };
  const rows = { A: [versioned("position", "a1", cookA, null)], B: [versioned("position", "b1", cookB, null)] };
  const links: ExchangeLinkRow[] = [
    { groupId: "g1", organizationId: "A", entityId: "a1", hash: positionV1Hash("Повар") },
    { groupId: "g1", organizationId: "B", entityId: "b1", hash: positionV1Hash("Повар") },
  ];
  const quiet = versionedPlan("position", "account", rows, links);
  assert.deepEqual(quiet.ops, []);
  assert.equal(quiet.rebased.length, 2);

  const renamed = { ...rows, B: [versioned("position", "b1", { ...cookB, name: "Повар-универсал" }, null)] };
  assert.deepEqual(types(versionedPlan("position", "account", renamed, links).ops), ["rehash:B", "update:A"]);
});

test("Р8.0, foreign scope: version-1 position links move to the restricted version 2, nothing else happens", () => {
  // Before versions a position had one field set (its name) in any exchange.
  const rows = {
    A: [versioned("position", "a1", { name: "Повар" }, null, "foreign")],
    B: [versioned("position", "b1", { name: "Повар" }, null, "foreign")],
    F: [versioned("position", "f1", { name: "Повар" }, null, "foreign")],
  };
  const links: ExchangeLinkRow[] = ["A", "B", "F"].map((org) => ({ groupId: "g1", organizationId: org, entityId: `${org.toLowerCase()}1`, hash: positionV1Hash("Повар") }));
  const { ops, rebased } = versionedPlan("position", "foreign", rows, links, ["F"]);
  assert.deepEqual(ops, []);
  assert.equal(rebased.length, 3);
  assert.ok(rebased.every((link) => link.hash.startsWith("f:v2:")));

  // A rename by the owner's organization still reaches everyone (name only).
  const renamed = { ...rows, A: [versioned("position", "a1", { name: "Повар цеха" }, null, "foreign")] };
  assert.deepEqual(types(versionedPlan("position", "foreign", renamed, links, ["F"]).ops), ["rehash:A", "update:B", "update:F"]);
});

test("Р8.0, foreign scope: rooms have one field set — version-1 links of unchanged rooms are re-based, an edit propagates", () => {
  const rows = { A: [versioned("room", "a1", KITCHEN, "g-cafe")], F: [versioned("room", "f1", KITCHEN_B, "g-cafe")] };
  const links: ExchangeLinkRow[] = [
    { groupId: "g1", organizationId: "A", entityId: "a1", hash: roomV1Hash(KITCHEN, "g-cafe") },
    { groupId: "g1", organizationId: "F", entityId: "f1", hash: roomV1Hash(KITCHEN, "g-cafe") },
  ];
  const quiet = versionedPlan("room", "foreign", rows, links, ["F"]);
  assert.deepEqual(quiet.ops, []);
  assert.equal(quiet.rebased.length, 2);
  const sorted = { ...rows, A: [versioned("room", "a1", { ...KITCHEN, sortOrder: 5 }, "g-cafe")] };
  assert.deepEqual(types(versionedPlan("room", "foreign", sorted, links, ["F"]).ops), ["rehash:A", "update:F"]);
});

test("Р8.0: the foreign organization leaves — restricted position links are compared by name, journals are not pushed", () => {
  const cookA = { name: "Повар", journals: JSON.stringify(["cleaning"]) };
  const cookB = { name: "Повар", journals: JSON.stringify(["hygiene"]) };
  const rows = { A: [versioned("position", "a1", cookA, null)], B: [versioned("position", "b1", cookB, null)] };
  const links: ExchangeLinkRow[] = [
    { groupId: "g1", organizationId: "A", entityId: "a1", hash: rowHash("position", cookA, null, "foreign") },
    { groupId: "g1", organizationId: "B", entityId: "b1", hash: rowHash("position", cookB, null, "foreign") },
  ];
  const { ops, rebased } = versionedPlan("position", "account", rows, links);
  assert.deepEqual(ops, []);
  assert.ok(rebased.every((link) => link.hash.startsWith("v2:")));
});

test("Р8.0: a link of a version newer than the code is treated as unchanged, never as an edit", () => {
  const rows = { A: [versioned("room", "a1", KITCHEN, "g-cafe")], B: [versioned("room", "b1", KITCHEN_B, "g-cafe")] };
  const links: ExchangeLinkRow[] = [
    { groupId: "g1", organizationId: "A", entityId: "a1", hash: "v3:0123456789abcdef0123456789ab" },
    { groupId: "g1", organizationId: "B", entityId: "b1", hash: "v3:fedcba9876543210fedcba987654" },
  ];
  const { ops, rebased } = versionedPlan("room", "account", rows, links);
  assert.deepEqual(ops, []);
  assert.equal(rebased.length, 2);
});

/* ── passive participant: an organization of another company (part 3, 2026-11-20) ── */

/** Owner's organization A and the other company's organization F, one linked product each. */
function linkedPair() {
  const w = world(["A", "F"], { A: [row("a1", "milk", "h0", at(0))], F: [] });
  apply(w, plan(w, ["F"]));
  const f1 = w.rows.F[0];
  assert.ok(f1, "F received the owner's product");
  return { w, f1 };
}

test("passive: an edit of the other company alone is not an edit — empty plan, twice in a row", () => {
  const { w, f1 } = linkedPair();
  Object.assign(f1, { hash: "hF", updatedAt: at(5) });
  assert.deepEqual(plan(w, ["F"]), []);
  assert.deepEqual(plan(w, ["F"]), [], "nothing builds up on later runs");
  assert.equal(w.rows.A[0].hash, "h0", "the owner's record is untouched");
});

test("passive: an edit of the owner reaches the other company even when its own edit is later", () => {
  const { w, f1 } = linkedPair();
  Object.assign(f1, { hash: "hF", updatedAt: at(9) });
  Object.assign(w.rows.A[0], { hash: "hA", updatedAt: at(5) });
  const ops = plan(w, ["F"]);
  assert.deepEqual(
    ops.filter((op) => op.type === "update").map((op) => [op.organizationId, op.type === "update" ? op.fromOrganizationId : ""]),
    [["F", "A"]],
  );
  apply(w, ops);
  assert.equal(f1.hash, "hA");
  assert.deepEqual(plan(w, ["F"]), []);
});

test("passive: a new record of the other company is still created at the owner", () => {
  const { w } = linkedPair();
  w.rows.F.push(row("f2", "cream", "hC", at(7)));
  const ops = plan(w, ["F"]);
  assert.deepEqual(
    ops.filter((op) => op.type === "create").map((op) => [op.organizationId, op.type === "create" ? op.fromEntityId : ""]),
    [["A", "f2"]],
  );
  apply(w, ops);
  assert.deepEqual(plan(w, ["F"]), []);
});

test("passive: a record the other company deleted is not re-created there, the owner keeps it", () => {
  const { w } = linkedPair();
  w.rows.F = [];
  const ops = plan(w, ["F"]);
  assert.deepEqual(ops.map((op) => [op.type, op.organizationId]), [["tombstone", "F"]]);
  apply(w, ops);
  assert.deepEqual(plan(w, ["F"]), []);
  assert.equal(w.rows.A.length, 1);
});

test("passive: two owner organizations and the other company — the owner's edit wins over both", () => {
  const w = world(["A", "B", "F"], { A: [row("a1", "milk", "h0", at(0))], B: [], F: [] });
  apply(w, plan(w, ["F"]));
  const b1 = w.rows.B[0];
  const f1 = w.rows.F[0];
  Object.assign(f1, { hash: "hF", updatedAt: at(10) });
  Object.assign(b1, { hash: "hB", updatedAt: at(3) });
  apply(w, plan(w, ["F"]));
  assert.deepEqual([w.rows.A[0].hash, b1.hash, f1.hash], ["hB", "hB", "hB"]);
  assert.deepEqual(plan(w, ["F"]), []);
});

/* ── several companies at one cabinet, no access to each other («star», series C1, Р6.3–Р6.4) ── */

/** O1, O2 — the cabinet owner's organizations; A, A2 — company A; B — company B; C — company C. */
const COMPANY: Record<string, string> = { O1: "own", O2: "own", A: "ca", A2: "ca", B: "cb", C: "cc" };
const companies: ExchangeCompanies = { owner: "own", of: (id) => COMPANY[id] ?? `missing:${id}` };
const FOREIGN = ["A", "A2", "B", "C"];

/** A full exchange of several companies; right after it the plan is empty. */
function syncStar(w: World): ExchangeOp[] {
  const passive = w.participants.filter((id) => FOREIGN.includes(id));
  const ops = plan(w, passive, companies);
  apply(w, ops);
  assert.deepEqual(plan(w, passive, companies), [], "second run right after applying the plan is empty");
  return ops;
}

const keysOf = (w: World, organizationId: string) => w.rows[organizationId].map((item) => item.key).sort();
const originsOf = (w: World, organizationId: string) =>
  w.links
    .filter((link) => link.organizationId === organizationId && link.entityId)
    .map((link) => link.originOrganizationId)
    .sort();

test("C1: two companies both get the owner's records and never each other's new records", () => {
  const w = world(["O1", "O2", "A", "B"], {
    O1: [row("o1", "milk", "hm", at(0))],
    A: [row("a1", "cheese", "hc", at(1))],
    B: [row("b1", "bread", "hb", at(2))],
  });
  const ops = syncStar(w);
  assert.deepEqual(keysOf(w, "O1"), ["bread", "cheese", "milk"]);
  assert.deepEqual(keysOf(w, "O2"), ["bread", "cheese", "milk"]);
  assert.deepEqual(keysOf(w, "A"), ["cheese", "milk"]);
  assert.deepEqual(keysOf(w, "B"), ["bread", "milk"]);
  // Every new group remembers its founder, and every copy carries it.
  assert.deepEqual(
    ops.filter((op) => op.type === "link").map((op) => [op.organizationId, op.type === "link" ? op.originOrganizationId : null]),
    [["O1", "O1"], ["A", "A"], ["B", "B"]],
  );
  assert.deepEqual(originsOf(w, "O2"), ["A", "B", "O1"]);
});

test("C1: an owner's edit of a company's record reaches that company only; company edits move nothing", () => {
  const w = world(["O1", "O2", "A", "B"], {
    O1: [row("o1", "milk", "hm", at(0))],
    A: [row("a1", "cheese", "hc", at(1))],
    B: [row("b1", "bread", "hb", at(2))],
  });
  syncStar(w);
  // A edits its own record and the owner's: passive — nobody gets anything.
  edit(w, "A", "a1", { hash: "hc-A", updatedAt: at(5) });
  edit(w, "A", w.rows.A.find((item) => item.key === "milk")!.id, { hash: "hm-A", updatedAt: at(5) });
  assert.deepEqual(syncStar(w), []);
  assert.equal(w.rows.O1.find((item) => item.key === "milk")!.hash, "hm");
  // The owner edits A's cheese: O2 and A get it, B — nothing (no create, no update).
  const ownerCheese = w.rows.O1.find((item) => item.key === "cheese")!;
  edit(w, "O1", ownerCheese.id, { hash: "hc-O", updatedAt: at(9) });
  const ops = syncStar(w);
  assert.deepEqual(types(ops), ["rehash:O1", "update:A", "update:O2"]);
  assert.deepEqual(keysOf(w, "B"), ["bread", "milk"]);
  // The owner's edit of its own milk reaches everybody.
  edit(w, "O1", "o1", { hash: "hm-O", updatedAt: at(12) });
  assert.deepEqual(types(syncStar(w)), ["rehash:O1", "update:A", "update:B", "update:O2"]);
});

test("C1: a name match with another company's group founds a group of its own; a match with the owner joins", () => {
  const w = world(["O1", "O2", "A", "B"], {
    O1: [row("o1", "milk", "hm-O", at(0))],
    A: [row("a1", "cheese", "hc-A", at(1)), row("a2", "milk", "hm-A", at(1))],
    B: [row("b1", "cheese", "hc-B", at(2)), row("b2", "milk", "hm-B", at(2))],
  });
  syncStar(w);
  const groupOf = (organizationId: string, id: string) => w.links.find((link) => link.organizationId === organizationId && link.entityId === id)!.groupId;
  // Milk: one owner's group, both companies joined it, nobody's data overwritten.
  assert.equal(groupOf("A", "a2"), groupOf("O1", "o1"));
  assert.equal(groupOf("B", "b2"), groupOf("O1", "o1"));
  assert.deepEqual([w.rows.A[1].hash, w.rows.B[1].hash], ["hm-A", "hm-B"]);
  // Cheese: two groups — A's and B's; A and B never share one.
  assert.notEqual(groupOf("A", "a1"), groupOf("B", "b1"));
  const groupsOfA = new Set(w.links.filter((link) => link.organizationId === "A").map((link) => link.groupId));
  assert.ok(w.links.filter((link) => link.organizationId === "B").every((link) => !groupsOfA.has(link.groupId) || link.originOrganizationId === "O1"));
  assert.equal(w.rows.A.length, 2);
  assert.equal(w.rows.B.length, 2);
});

test("C1: the owner's records are matched first — a company listed earlier does not take a shared name", () => {
  const w = world(["A", "O1", "B"], {
    A: [row("a1", "milk", "hA")],
    O1: [row("o1", "milk", "hO")],
    B: [row("b1", "milk", "hB")],
  });
  const ops = syncStar(w);
  assert.deepEqual(types(ops), ["link:A", "link:B", "link:O1"]);
  assert.equal(new Set(w.links.map((link) => link.groupId)).size, 1);
  assert.deepEqual(originsOf(w, "B"), ["O1"]);
});

test("C1: a second organization of the same company gets its company's records", () => {
  const w = world(["O1", "A", "A2", "B"], { A: [row("a1", "cheese", "hc")] });
  syncStar(w);
  assert.deepEqual(keysOf(w, "A2"), ["cheese"]);
  assert.deepEqual(keysOf(w, "O1"), ["cheese"]);
  assert.deepEqual(keysOf(w, "B"), []);
});

test("C1: a create to a company comes only from the owner or its own company", () => {
  // The owner's group lives on only in A's copy (with A's own edit): B does not get A's version, O2 does.
  const w = world(["O1", "O2", "A", "B"], { A: [row("a1", "milk", "hm-A")] });
  w.links.push(
    { groupId: "g0", organizationId: "O1", entityId: null, hash: "hm", originOrganizationId: "O1" },
    { groupId: "g0", organizationId: "A", entityId: "a1", hash: "hm", originOrganizationId: "O1" },
  );
  assert.deepEqual(types(plan(w, FOREIGN, companies)), ["create:O2", "rehash:A"]);
});

test("C1: a mixed group (before C1) — the owner still gets it, companies get neither creates nor updates", () => {
  const w = world(["O1", "O2", "A", "B", "C"], {
    O1: [row("o1", "milk", "h1", at(0))],
    A: [row("a1", "milk", "h1", at(0))],
    B: [row("b1", "milk", "h1", at(0))],
  });
  w.links.push(
    { groupId: "g0", organizationId: "O1", entityId: "o1", hash: "h1", originOrganizationId: null },
    { groupId: "g0", organizationId: "A", entityId: "a1", hash: "h1", originOrganizationId: null },
    { groupId: "g0", organizationId: "B", entityId: "b1", hash: "h1", originOrganizationId: null },
  );
  edit(w, "O1", "o1", { hash: "h2", updatedAt: at(5) });
  const ops = plan(w, FOREIGN, companies);
  assert.deepEqual(types(ops), ["create:O2", "rehash:O1"]);
  // C's own milk does not join the mixed group either: it founds its own.
  w.rows.C.push(row("c1", "milk", "hC"));
  const withC = plan(w, FOREIGN, companies);
  assert.ok(withC.some((op) => op.type === "link" && op.organizationId === "C" && op.groupId !== "g0" && op.originOrganizationId === "C"));
  assert.ok(!withC.some((op) => op.organizationId === "C" && op.groupId === "g0"));
});

test("C1: legacy origin by link time — whoever was in the group earlier; one run — record dates, cautiously", () => {
  /** A link written at minute `linked`; its record created at minute `created` (undefined — unreadable). */
  const records: Record<string, Date> = {};
  let seq = 0;
  const rec = (organizationId: string, linked: number, created?: number, live = true) => {
    const entityId = `${organizationId.toLowerCase()}${(seq += 1)}`;
    if (created !== undefined) records[entityId] = at(created);
    return { organizationId, entityId: live ? entityId : null, createdAt: at(linked) };
  };
  const createdAt = (entityId: string) => records[entityId] ?? null;
  const origin = (...links: ReturnType<typeof rec>[]) => legacyGroupOrigin(links, companies, createdAt);

  // The owner was linked in an earlier run → the owner's group, even though A's record is older.
  assert.equal(origin(rec("O1", 0, 5), rec("A", 60, -100)), "O1");
  // A was linked earlier → A's group.
  assert.equal(origin(rec("A", 0, -10), rec("O1", 60, 30)), "A");
  // A deleted and re-created its record (newer than everything) under its old link: still decided by links.
  assert.equal(origin(rec("A", 0, 500), rec("O1", 60, 30)), "A");
  assert.equal(origin(rec("O1", 0, -10), rec("A", 60, 500)), "O1");
  // One run linked both: the owner only when its oldest record is strictly older than every record of A…
  assert.equal(origin(rec("O1", 0, -10), rec("A", 0, -5)), "O1");
  // …A's record is older, or a record cannot be read → A.
  assert.equal(origin(rec("O1", 0, -5), rec("A", 0, -10)), "A");
  assert.equal(origin(rec("O1", 0, -10), rec("A", 0)), "A");
  assert.equal(origin(rec("O1", 0), rec("A", 0, -5)), "A");
  // …A's record was re-created after its link (A founded the group, the owner got a copy in that run) → A.
  assert.equal(origin(rec("A", 0, 500), rec("O1", 0, -1)), "A");
  // A record hard-deleted while its link is live: decided by links; in one run — A.
  assert.equal(origin(rec("O1", 0, -10), rec("A", 60)), "O1");
  assert.equal(origin(rec("O1", 0, -10), rec("A", 0)), "A");
  // A company that only has a tombstone is still present, at its link time.
  assert.equal(origin(rec("A", 0, undefined, false), rec("O1", 60, 30)), "A");
  assert.equal(origin(rec("O1", 0, -10), rec("A", 60, undefined, false)), "O1");
  // Two companies → mixed, whatever the dates; no company → the owner's earliest link (equal — smaller id).
  assert.equal(origin(rec("O1", 0, -10), rec("A", 60, 5), rec("B", 90, 6)), MIXED_ORIGIN);
  assert.equal(origin(rec("O2", 0, 1), rec("O1", 0, 2)), "O1");
  assert.equal(origin(rec("O2", 10, 1), rec("O1", 20, 2)), "O2");

  const links: DatedLinkRow[] = [
    { groupId: "g1", organizationId: "O1", entityId: "o3", hash: "h", originOrganizationId: null, createdAt: at(0) },
    { groupId: "g1", organizationId: "A", entityId: "a2", hash: "h", originOrganizationId: null, createdAt: at(0) },
    { groupId: "g2", organizationId: "O1", entityId: "o1", hash: "h", originOrganizationId: "O1", createdAt: at(0) },
    { groupId: "g2", organizationId: "B", entityId: "b9", hash: "h", originOrganizationId: null, createdAt: at(0) },
  ];
  // Only records of groups with no origin at all may need a date.
  assert.deepEqual(unmarkedGroupRecords(links), ["o3", "a2"]);
  const dates: Record<string, Date> = { o3: at(-10), a2: at(-5) };
  assert.deepEqual([...pendingGroupOrigins(links, companies, (id) => dates[id] ?? null)], [["g1", "O1"], ["g2", "O1"]]);
  assert.deepEqual([...pendingGroupOrigins(links, companies)], [["g1", "A"], ["g2", "O1"]]);
});

test("C1: legacy origin without any dates — one company → it (cautious), several → mixed, none → the owner's first", () => {
  const live = (organizationId: string, entityId: string | null = "x") => ({ organizationId, entityId });
  assert.equal(legacyGroupOrigin([live("O1"), live("A2"), live("A"), live("O2")], companies), "A2");
  assert.equal(legacyGroupOrigin([live("O1"), live("A"), live("B")], companies), MIXED_ORIGIN);
  assert.equal(legacyGroupOrigin([live("O2"), live("O1")], companies), "O2");
  // A company that only has a tombstone still counts: with another company — mixed.
  assert.equal(legacyGroupOrigin([live("B", null), live("O1"), live("A")], companies), MIXED_ORIGIN);
  assert.equal(legacyGroupOrigin([live("B", null), live("O1", null)], companies), "B");
  assert.equal(legacyGroupOrigin([], companies), null);
  // An organization that no longer exists is a company of its own.
  assert.equal(legacyGroupOrigin([live("O1"), live("gone")], companies), "gone");

  const links: ExchangeLinkRow[] = [
    { groupId: "g1", organizationId: "O1", entityId: "o1", hash: "h", originOrganizationId: null },
    { groupId: "g1", organizationId: "A", entityId: "a1", hash: "h", originOrganizationId: null },
    { groupId: "g2", organizationId: "O1", entityId: "o2", hash: "h" },
    { groupId: "g2", organizationId: "A", entityId: "a2", hash: "h" },
    { groupId: "g2", organizationId: "B", entityId: "b2", hash: "h" },
    { groupId: "g3", organizationId: "O2", entityId: "o3", hash: "h", originOrganizationId: null },
    { groupId: "g3", organizationId: "O1", entityId: "o4", hash: "h", originOrganizationId: null },
    { groupId: "g4", organizationId: "O1", entityId: "o5", hash: "h", originOrganizationId: "B" },
    { groupId: "g4", organizationId: "O2", entityId: null, hash: "", originOrganizationId: null },
    { groupId: "g5", organizationId: "O1", entityId: "o6", hash: "h", originOrganizationId: "O1" },
  ];
  assert.deepEqual(
    [...pendingGroupOrigins(links, companies)],
    [["g1", "A"], ["g2", MIXED_ORIGIN], ["g3", "O2"], ["g4", "B"]],
  );
  // Marked everywhere — nothing to write the second time.
  const marked = links.map((link) => ({ ...link, originOrganizationId: pendingGroupOrigins(links, companies).get(link.groupId) ?? link.originOrganizationId }));
  assert.deepEqual([...pendingGroupOrigins(marked, companies)], []);
});

test("C1: who receives a group — the owner everything, a company the owner's and its own", () => {
  assert.equal(companyReceivesGroup("A", "own", companies), true);
  assert.equal(companyReceivesGroup(MIXED_ORIGIN, "own", companies), true);
  assert.equal(companyReceivesGroup(null, "own", companies), true);
  assert.equal(companyReceivesGroup("O2", "cb", companies), true);
  assert.equal(companyReceivesGroup("A2", "ca", companies), true);
  assert.equal(companyReceivesGroup("A", "cb", companies), false);
  assert.equal(companyReceivesGroup(MIXED_ORIGIN, "ca", companies), false);
  assert.equal(companyReceivesGroup(null, "ca", companies), false);
  assert.equal(companyReceivesGroup("gone", "ca", companies), false);
});
