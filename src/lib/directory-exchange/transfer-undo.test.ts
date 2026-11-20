import assert from "node:assert/strict";
import test from "node:test";

import {
  TRANSFER_EXPIRED_MESSAGE,
  TRANSFER_UNDONE_MESSAGE,
  TRANSFER_UNDO_DAYS,
  UNDO_ACTION,
  canUndoTransfer,
  decideUndo,
  editedAfter,
  editedByHash,
  emptyTransferBefore,
  emptyTransferCreated,
  emptyTransferHashes,
  fixedTransferKinds,
  keepMirrorPartners,
  mirrorPairs,
  parseTransferBefore,
  parseTransferCreated,
  parseTransferHashes,
  parseUndoResult,
  replacedTransferKinds,
  transferCreatedCount,
  transferCreatedJson,
  transferUndoDeadline,
  undoableCreatedCount,
  type UndoDecision,
} from "@/lib/directory-exchange/transfer-undo";

const DAY = 24 * 60 * 60 * 1000;
const AT = new Date("2026-11-20T10:00:00.000Z");
const later = (ms: number) => new Date(AT.getTime() + ms);

test("createdJson: ids by entity, no duplicates, garbage dropped", () => {
  const created = parseTransferCreated({
    product: ["p1", "p1", "p2", 3, ""],
    staff: "s1",
    room: ["r1"],
    unknown: ["x"],
  });
  assert.deepEqual(created, { ...emptyTransferCreated(), product: ["p1", "p2"], room: ["r1"] });
  assert.equal(transferCreatedCount(created), 3);
  assert.deepEqual(parseTransferCreated(null), emptyTransferCreated());
  assert.deepEqual(parseTransferCreated(["p1"]), emptyTransferCreated());
});

test("createdJson with fingerprints: ids read as before, hashes by entity, old rows have none", () => {
  const created = { ...emptyTransferCreated(), equipment: ["e1", "e2"], area: ["a1"] };
  const hashes = { ...emptyTransferHashes(), equipment: { e1: "h-e1", e2: "h-e2" }, area: { a1: "h-a1" } };
  const json = JSON.parse(JSON.stringify(transferCreatedJson(created, hashes)));
  // Старый разбор id не видит `hashes` — формат совместим.
  assert.deepEqual(parseTransferCreated(json), created);
  assert.deepEqual(parseTransferHashes(json), hashes);
  // Запись до отпечатков и мусор — пусто.
  assert.deepEqual(parseTransferHashes({ equipment: ["e1"] }), emptyTransferHashes());
  assert.deepEqual(parseTransferHashes(null), emptyTransferHashes());
  assert.deepEqual(
    parseTransferHashes({ hashes: { equipment: { e1: "h", e2: 5, "": "x", e3: "" }, nope: { x: "h" }, area: ["a1"] } }),
    { ...emptyTransferHashes(), equipment: { e1: "h" } },
  );
});

test("edited by fingerprint: a different or missing current hash; no stored hash — unknown", () => {
  const stored = { ...emptyTransferHashes(), equipment: { e1: "h1", e2: "h2", e3: "h3" }, area: { a1: "ha" } };
  const current = { ...emptyTransferHashes(), equipment: { e1: "h1", e2: "h2-tempMax", e4: "h4" }, area: { a1: "ha-renamed" } };
  assert.equal(editedByHash(stored, current, "equipment", "e1"), false);
  assert.equal(editedByHash(stored, current, "equipment", "e2"), true);
  assert.equal(editedByHash(stored, current, "area", "a1"), true);
  // Запись выпала из строк обмена (ушла в офис, сотруднику дали вход) — правка.
  assert.equal(editedByHash(stored, current, "equipment", "e3"), true);
  // Отпечатка с переноса нет (старая запись) — решают прежние признаки.
  assert.equal(editedByHash(stored, current, "equipment", "e4"), false);
  assert.equal(editedByHash(emptyTransferHashes(), current, "equipment", "e2"), false);
  assert.equal(editedByHash(stored, current, "equipment", "constructor"), false);
});

test("undo window: 7 days, once", () => {
  assert.equal(TRANSFER_UNDO_DAYS, 7);
  assert.equal(transferUndoDeadline(AT).getTime(), AT.getTime() + 7 * DAY);
  assert.deepEqual(canUndoTransfer({ createdAt: AT, undoneAt: null, now: later(DAY) }), { ok: true });
  assert.deepEqual(canUndoTransfer({ createdAt: AT, undoneAt: null, now: later(7 * DAY) }), { ok: true });
  assert.deepEqual(canUndoTransfer({ createdAt: AT, undoneAt: null, now: later(7 * DAY + 1) }), {
    ok: false,
    status: 409,
    reason: "expired",
    message: TRANSFER_EXPIRED_MESSAGE,
  });
  // Повторная отмена — 409, даже внутри срока.
  assert.deepEqual(canUndoTransfer({ createdAt: AT, undoneAt: later(60_000), now: later(DAY) }), {
    ok: false,
    status: 409,
    reason: "undone",
    message: TRANSFER_UNDONE_MESSAGE,
  });
});

test("edited after the transfer: updatedAt later than the transfer", () => {
  assert.equal(editedAfter(later(1), AT), true);
  assert.equal(editedAfter(AT, AT), false);
  assert.equal(editedAfter(later(-1000), AT), false);
  assert.equal(editedAfter(null, AT), false);
  assert.equal(editedAfter(undefined, AT), false);
});

test("decision: products off, staff archived, the rest deleted", () => {
  assert.deepEqual(UNDO_ACTION, {
    product: "deactivated",
    staff: "archived",
    position: "deleted",
    building: "deleted",
    room: "deleted",
    area: "deleted",
    equipment: "deleted",
    journal_settings: null,
    checklist_template: "deleted",
  });
  assert.deepEqual(decideUndo("product", {}), { kind: "undo", action: "deactivated" });
  assert.deepEqual(decideUndo("checklist_template", {}), { kind: "undo", action: "deleted" });
  assert.deepEqual(decideUndo("staff", {}), { kind: "undo", action: "archived" });
  assert.deepEqual(decideUndo("equipment", { hasChildren: false, used: false, edited: false }), { kind: "undo", action: "deleted" });
});

test("decision: missing or already off — nothing to do", () => {
  assert.deepEqual(decideUndo("product", { missing: true, edited: true }), { kind: "skip" });
  assert.deepEqual(decideUndo("staff", { inactive: true, used: true }), { kind: "skip" });
});

test("decision: edited, used and non-empty records stay, with the first reason", () => {
  assert.deepEqual(decideUndo("product", { edited: true }), { kind: "keep", reason: "edited" });
  assert.deepEqual(decideUndo("staff", { edited: true, used: true }), { kind: "keep", reason: "edited" });
  assert.deepEqual(decideUndo("staff", { used: true }), { kind: "keep", reason: "used" });
  assert.deepEqual(decideUndo("equipment", { used: true, hasChildren: true }), { kind: "keep", reason: "used" });
  assert.deepEqual(decideUndo("building", { hasChildren: true }), { kind: "keep", reason: "not_empty" });
  assert.deepEqual(decideUndo("area", { hasChildren: true }), { kind: "keep", reason: "not_empty" });
  assert.deepEqual(decideUndo("position", { hasChildren: true }), { kind: "keep", reason: "has_staff" });
});

test("Р8.1: replaced journal settings are never undone; a checklist template follows the usual rules", () => {
  assert.deepEqual(decideUndo("journal_settings", {}), { kind: "keep", reason: "not_undoable" });
  assert.deepEqual(decideUndo("journal_settings", { edited: true, used: true }), { kind: "keep", reason: "not_undoable" });
  assert.deepEqual(decideUndo("checklist_template", { used: true }), { kind: "keep", reason: "used" });
  assert.deepEqual(decideUndo("checklist_template", { inactive: true }), { kind: "skip" });
  const created = emptyTransferCreated();
  created.journal_settings.push("org-1");
  assert.equal(transferCreatedCount(created), 1);
  assert.equal(undoableCreatedCount(created), 0);
  assert.deepEqual(fixedTransferKinds(created), ["journals"]);
  created.checklist_template.push("tpl-1");
  assert.equal(undoableCreatedCount(created), 1);
  assert.deepEqual(fixedTransferKinds(created), ["journals"]);
  assert.deepEqual(fixedTransferKinds(emptyTransferCreated()), []);
  // Старые записи переноса без новых сущностей читаются как прежде.
  assert.deepEqual(parseTransferCreated({ product: ["p1"] }).journal_settings, []);
  assert.deepEqual(parseTransferHashes({ hashes: { journal_settings: { "org-1": "abc" } } }).journal_settings, { "org-1": "abc" });
  assert.equal(parseUndoResult({ undone: [], kept: [{ entity: "journal_settings", id: "org-1", name: "", reason: "not_undoable" }] })?.kept.length, 1);
});

test("Р10: journal settings with a snapshot are restored unless edited; old transfers without one stay not undoable", () => {
  assert.deepEqual(decideUndo("journal_settings", { snapshot: true }), { kind: "undo", action: "restored" });
  assert.deepEqual(decideUndo("journal_settings", { snapshot: true, edited: true }), { kind: "keep", reason: "edited" });
  assert.deepEqual(decideUndo("journal_settings", { snapshot: true, missing: true }), { kind: "skip" });
  assert.deepEqual(decideUndo("journal_settings", { snapshot: false, edited: true }), { kind: "keep", reason: "not_undoable" });
  // Снимок — только у заменённых записей: созданное отменяется как раньше.
  assert.deepEqual(decideUndo("product", { snapshot: true }), { kind: "undo", action: "deactivated" });

  const created = emptyTransferCreated();
  created.journal_settings.push("org-1");
  const before = emptyTransferBefore();
  before.journal_settings["org-1"] = { disabledJournalCodes: "[\"hygiene\"]", autoJournalCodes: null, automation: "{}" };
  assert.equal(undoableCreatedCount(created, before), 1);
  assert.deepEqual(fixedTransferKinds(created, before), []);
  assert.deepEqual(replacedTransferKinds(created, before), ["journals"]);
  // Без снимка — по-старому.
  assert.equal(undoableCreatedCount(created), 0);
  assert.deepEqual(fixedTransferKinds(created), ["journals"]);
  assert.deepEqual(replacedTransferKinds(created, emptyTransferBefore()), []);

  // createdJson: снимок рядом с id и отпечатками; прежний разбор его не видит.
  const json = JSON.parse(JSON.stringify(transferCreatedJson(created, { ...emptyTransferHashes(), journal_settings: { "org-1": "h1" } }, before)));
  assert.deepEqual(parseTransferCreated(json), created);
  assert.deepEqual(parseTransferBefore(json), before);
  assert.equal(parseTransferHashes(json).journal_settings["org-1"], "h1");
  // Без снимков ключа `before` нет — запись как до серии D.
  assert.equal(Object.hasOwn(transferCreatedJson(created, emptyTransferHashes()), "before"), false);
  // Мусор в снимке отбрасывается, числа-массивы (дни недели) остаются.
  assert.deepEqual(
    parseTransferBefore({ before: { journal_settings: { "org-1": { a: "x", b: { nested: 1 }, c: [1, 2], d: Number.NaN }, "": { a: "y" } }, nope: { x: {} } } }),
    { ...emptyTransferBefore(), journal_settings: { "org-1": { a: "x", c: [1, 2] } } },
  );
  assert.deepEqual(parseTransferBefore(null), emptyTransferBefore());
  assert.deepEqual(parseUndoResult({ undone: [{ entity: "journal_settings", id: "org-1", name: "", action: "restored" }], kept: [] })?.undone[0]?.action, "restored");
});

test("mirror pairs: same name on the same object, case and ё insensitive", () => {
  const rooms = [
    { id: "r1", name: "Склад ", buildingId: "b1" },
    { id: "r2", name: "Кухня", buildingId: "b1" },
    { id: "r3", name: "Ёмкости", buildingId: "b2" },
  ];
  const areas = [
    { id: "a1", name: "склад", buildingId: "b1" },
    { id: "a2", name: "Кухня", buildingId: "b2" },
    { id: "a3", name: "Емкости", buildingId: "b2" },
  ];
  assert.deepEqual(mirrorPairs(rooms, areas), [
    { roomId: "r1", areaId: "a1" },
    { roomId: "r3", areaId: "a3" },
  ]);
  assert.deepEqual(mirrorPairs([{ id: "r1", name: "Склад", buildingId: null }], areas), []);
});

test("mirror partners stay together", () => {
  const undo: UndoDecision = { kind: "undo", action: "deleted" };
  const decisions = new Map<string, UndoDecision>([
    ["r1", { kind: "keep", reason: "edited" }],
    ["a1", undo],
    ["r2", undo],
    ["a2", { kind: "keep", reason: "not_empty" }],
    ["r3", undo],
    ["a3", undo],
    ["r4", { kind: "skip" }],
    ["a4", undo],
  ]);
  const next = keepMirrorPartners(decisions, [
    { roomId: "r1", areaId: "a1" },
    { roomId: "r2", areaId: "a2" },
    { roomId: "r3", areaId: "a3" },
    { roomId: "r4", areaId: "a4" },
  ]);
  assert.deepEqual(next.get("a1"), { kind: "keep", reason: "linked" });
  assert.deepEqual(next.get("r2"), { kind: "keep", reason: "linked" });
  assert.deepEqual(next.get("r3"), undo);
  assert.deepEqual(next.get("a3"), undo);
  // Помещения уже нет — цех-зеркало удаляется по своим правилам.
  assert.deepEqual(next.get("a4"), undo);
  // Исходная карта не меняется.
  assert.deepEqual(decisions.get("a1"), undo);
});

test("undo result: parsed back, garbage rows dropped", () => {
  assert.equal(parseUndoResult(null), null);
  assert.equal(parseUndoResult([]), null);
  assert.deepEqual(
    parseUndoResult({
      undone: [
        { entity: "product", id: "p1", name: "Молоко", action: "deactivated" },
        { entity: "product", id: "p2", name: "Сыр", action: "burnt" },
        { entity: "nope", id: "x", action: "deleted" },
      ],
      kept: [
        { entity: "staff", id: "s1", name: "Иванов", reason: "used" },
        { entity: "equipment", id: "e1", reason: "edited" },
        { entity: "staff", id: "s2", name: "Петрова", reason: "bored" },
      ],
    }),
    {
      undone: [{ entity: "product", id: "p1", name: "Молоко", action: "deactivated" }],
      kept: [
        { entity: "staff", id: "s1", name: "Иванов", reason: "used" },
        { entity: "equipment", id: "e1", name: "", reason: "edited" },
      ],
    },
  );
});
