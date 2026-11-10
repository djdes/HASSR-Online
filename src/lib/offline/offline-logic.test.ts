import assert from "node:assert/strict";
import { test } from "node:test";

import type { TaskFormSchema } from "@/lib/tasksflow-adapters/task-form";

import {
  journalTodayMark,
  objectTodayMark,
  offlineTodaySummary,
  fieldsNeedingCorrection,
  isOutOfRange,
  offlineEditableDays,
  offlineRowState,
  offlineSigners,
  offlineSignerStep,
  parseTypedNumber,
  rangeText,
  resolveOfflineQr,
  summarizeValues,
} from "./offline-logic";
import { parseOfflineQr } from "./qr-url";
import type { OfflinePack, OfflinePackDocument, OfflinePackEmployee, OfflineQueueItem } from "./types";

const verifier = { salt: "s", hash: "h", iterations: 1000 };
const employee = (id: string, extra: Partial<OfflinePackEmployee> = {}): OfflinePackEmployee => ({
  id,
  name: id,
  positionTitle: null,
  hasPin: false,
  pin: null,
  pinFp: null,
  isManagement: false,
  ...extra,
});

const schema: TaskFormSchema = {
  fields: [
    { type: "number", key: "temp", label: "Температура (°C)", unit: "°C", normalRange: { min: 2, max: 6 }, required: true },
    { type: "boolean", key: "clean", label: "Чисто", defaultValue: true },
    { type: "text", key: "note", label: "Примечание" },
    { type: "photo", key: "photo", label: "Фото" },
  ],
};

const document: OfflinePackDocument = {
  id: "doc1",
  title: "Ноябрь",
  building: null,
  buildingId: null,
  dateFrom: "2026-11-01",
  dateTo: "2026-11-30",
  perEmployee: false,
  rows: [{ rowKey: "r1", label: "Зал", responsibleUserId: null }],
  forms: { r1: schema },
  employeeIds: ["u1", "u2"],
  history: { r1: { "2026-11-05": { temp: 4, clean: true, note: null } } },
  todayCount: 0,
};

const pack = (mode: OfflinePack["organization"]["qrFillMode"] = "public"): OfflinePack => ({
  version: 1,
  generatedAt: "2026-11-10T05:00:00.000Z",
  user: { id: "u1", name: "Анна" },
  organization: { id: "org1", name: "Кафе", timeZone: "Europe/Moscow", qrFillMode: mode },
  todayKey: "2026-11-10",
  employees: [employee("u2"), employee("u1"), employee("u3", { hasPin: true, pin: verifier, pinFp: "fp3" }), employee("u4", { hasPin: true })],
  journals: [{ code: "cleaning", name: "Уборка", append: false, token: "tok", documents: [document] }],
  objects: [
    { kind: "equipment", id: "eq1", name: "Холодильник №2", place: "Кухня", buildingId: null, token: "t", fill: "temperature", temperature: { min: 2, max: 6 }, humidity: null, photo: "optional", employeeIds: ["u1"], today: null },
  ],
});

const qr = (text: string) => {
  const parsed = parseOfflineQr(text);
  assert.equal(parsed.ok, true);
  return parsed.ok ? parsed.target : (null as never);
};

test("a scanned fridge sticker opens that fridge; an unknown one is reported", () => {
  const found = resolveOfflineQr(pack(), qr("https://wesetup.ru/equipment-fill/eq1?token=x"));
  assert.equal(found.kind === "object" && found.object.name, "Холодильник №2");
  assert.deepEqual(resolveOfflineQr(pack(), qr("https://wesetup.ru/equipment-fill/other?token=x")), { kind: "missing", what: "object" });
  // A room id is not looked up among equipment.
  assert.deepEqual(resolveOfflineQr(pack(), qr("https://wesetup.ru/room-fill/eq1?token=x")), { kind: "missing", what: "object" });
});

test("journal posters: own journal, hub, another organization, short QR", () => {
  const own = resolveOfflineQr(pack(), qr("https://wesetup.ru/journal-fill/org1/cleaning?token=x"));
  assert.equal(own.kind === "journal" && own.journal.code, "cleaning");
  assert.deepEqual(resolveOfflineQr(pack(), qr("https://wesetup.ru/journal-fill/org1/all?token=x")), { kind: "hub" });
  assert.deepEqual(resolveOfflineQr(pack(), qr("https://wesetup.ru/journal-fill/org2/cleaning?token=x")), { kind: "foreign-org" });
  assert.deepEqual(resolveOfflineQr(pack(), qr("https://wesetup.ru/journal-fill/org1/hygiene?token=x")), { kind: "missing", what: "journal" });
  const short = resolveOfflineQr(pack(), qr("https://wesetup.ru/qj/building7/cleaning/sig"));
  assert.equal(short.kind, "journal");
});

test("who may sign without network", () => {
  const publicPack = pack("public");
  const [u2, u1, u3, u4] = publicPack.employees;
  assert.deepEqual(offlineSignerStep(publicPack, u1, false), { step: "ready", auth: "self" });
  assert.deepEqual(offlineSignerStep(publicPack, u2, false), { step: "ready", auth: "list" });
  assert.deepEqual(offlineSignerStep(publicPack, u3, false), { step: "pin" });
  assert.deepEqual(offlineSignerStep(publicPack, u3, true), { step: "ready", auth: "pin" });
  assert.equal(offlineSignerStep(publicPack, u4, false).step, "denied");
  // PIN mode: no PIN — no record; own account still signs as itself.
  assert.equal(offlineSignerStep(pack("pin"), u2, false).step, "denied");
  assert.deepEqual(offlineSignerStep(pack("pin"), u1, false), { step: "ready", auth: "self" });
  assert.equal(offlineSignerStep(pack("auth"), u2, false).step, "denied");
});

test("signer list: allowed only, own account first, 'auth' mode shows only it", () => {
  assert.deepEqual(offlineSigners(pack(), ["u2", "u1"]).map((item) => item.id), ["u1", "u2"]);
  assert.deepEqual(offlineSigners(pack("auth"), ["u2", "u1", "u3"]).map((item) => item.id), ["u1"]);
});

test("editable days stay inside the document period and the 31-day window", () => {
  const days = offlineEditableDays(document, "2026-11-10");
  assert.equal(days[0], "2026-11-10");
  assert.equal(days[days.length - 1], "2026-11-01");
  assert.equal(offlineEditableDays({ ...document, dateFrom: "2026-01-01", dateTo: "2099-12-31" }, "2026-11-10").length, 32);
});

const queued = (values: Record<string, unknown>, day: string | null, status: OfflineQueueItem["status"] = "pending"): OfflineQueueItem => ({
  id: "q1",
  ownerUserId: "u1",
  organizationId: "org1",
  employeeId: "u1",
  employeeName: "Анна",
  auth: "self",
  pinFp: null,
  recordedAt: "2026-11-10T06:00:00.000Z",
  target: { kind: "journal", code: "cleaning", documentId: "doc1", rowKey: "r1", day },
  url: "/api/journal-fill/org1/cleaning",
  body: { values },
  label: "",
  sublabel: "",
  status,
  attempts: 0,
  nextAttemptAt: 0,
  lastError: null,
  lastCode: null,
});

test("row form starts from saved values, an unsent edit on top, defaults for an empty day", () => {
  const empty = offlineRowState({ document, schema, rowKey: "r1", day: null, todayKey: "2026-11-10", queue: [] });
  assert.deepEqual(empty, { values: { temp: null, clean: true, note: null }, base: {}, filled: false, unsent: false });

  const past = offlineRowState({ document, schema, rowKey: "r1", day: "2026-11-05", todayKey: "2026-11-10", queue: [] });
  assert.deepEqual(past.values, { temp: 4, clean: true, note: null });
  assert.deepEqual(past.base, { temp: 4, clean: true, note: null });
  assert.equal(past.filled, true);

  const edited = offlineRowState({ document, schema, rowKey: "r1", day: "2026-11-05", todayKey: "2026-11-10", queue: [queued({ temp: 5 }, "2026-11-05")] });
  assert.deepEqual(edited.values, { temp: 5, clean: true, note: null });
  // The merge base stays what the journal held, not the unsent edit.
  assert.deepEqual(edited.base, { temp: 4, clean: true, note: null });
  assert.equal(edited.unsent, true);

  // A refused record does not pretend the row is filled.
  const refused = offlineRowState({ document, schema, rowKey: "r1", day: null, todayKey: "2026-11-10", queue: [queued({ temp: 5 }, null, "rejected")] });
  assert.equal(refused.filled, false);
});

test("norms, typed numbers and summaries", () => {
  assert.equal(isOutOfRange(7, { min: 2, max: 6 }), true);
  assert.equal(isOutOfRange("4,5", { min: 2, max: 6 }), false);
  assert.equal(isOutOfRange("", { min: 2, max: 6 }), false);
  assert.equal(isOutOfRange(1, null), false);
  assert.equal(rangeText({ min: 2, max: 6 }, "°C"), "+2…+6 °C");
  assert.equal(rangeText({ min: -18, max: null }, "°C"), "от -18 °C");
  assert.equal(rangeText({ min: null, max: 75 }, "%"), "до 75 %");
  assert.equal(parseTypedNumber("4,5"), 4.5);
  assert.equal(parseTypedNumber("+3"), 3);
  assert.equal(parseTypedNumber("-18"), -18);
  assert.equal(parseTypedNumber("abc"), null);
  assert.equal(parseTypedNumber(""), null);
  assert.deepEqual(fieldsNeedingCorrection(schema, { temp: 9 }).map((field) => field.key), ["temp"]);
  assert.equal(summarizeValues(schema, { temp: 4, clean: true, note: "ок" }), "Температура: 4 °C · Чисто · Примечание: ок");
});

test("today marks: objects", () => {
  const fridge = pack().objects[0];
  assert.deepEqual(objectTodayMark(fridge, []), { state: "todo", summary: null });
  assert.deepEqual(objectTodayMark({ ...fridge, today: { done: true, summary: "+4 °C · Анна" } }, []), { state: "done", summary: "+4 °C · Анна" });
  const reading: OfflineQueueItem = { ...queued({}, null), target: { kind: "equipment", objectId: "eq1", action: "temperature" } };
  assert.equal(objectTodayMark(fridge, [reading]).state, "queued");
  // A refused record does not make the fridge look filled.
  assert.equal(objectTodayMark(fridge, [{ ...reading, status: "rejected" }]).state, "todo");
});

test("today marks: journals with rows, per-employee and append journals", () => {
  const rows = pack().journals[0];
  assert.deepEqual(journalTodayMark(rows, [], "2026-11-10"), { state: "todo", rows: { done: 0, total: 1 }, count: 0 });
  assert.deepEqual(journalTodayMark(rows, [], "2026-11-05"), { state: "done", rows: { done: 1, total: 1 }, count: 0 });
  assert.deepEqual(journalTodayMark(rows, [queued({ temp: 5 }, null)], "2026-11-10"), { state: "queued", rows: { done: 1, total: 1 }, count: 0 });
  // A past-day edit in the queue says nothing about today.
  assert.equal(journalTodayMark(rows, [queued({ temp: 5 }, "2026-11-05")], "2026-11-10").state, "todo");

  const perEmployee = { ...rows, documents: [{ ...document, perEmployee: true, rows: [], history: { "employee-u1": { "2026-11-10": { a: 1 } }, "employee-u2": { "2026-11-09": { a: 1 } } } }] };
  assert.deepEqual(journalTodayMark(perEmployee, [], "2026-11-10"), { state: "done", rows: null, count: 1 });

  const append = { ...rows, append: true, documents: [{ ...document, history: {}, todayCount: 2 }] };
  assert.deepEqual(journalTodayMark(append, [queued({}, null)], "2026-11-10"), { state: "queued", rows: null, count: 3 });
  assert.deepEqual(journalTodayMark({ ...append, documents: [{ ...document, history: {}, todayCount: 0 }] }, [], "2026-11-10"), { state: "todo", rows: null, count: 0 });
});

test("today summary counts fillable objects and journals", () => {
  const base = pack();
  assert.deepEqual(offlineTodaySummary(base, []), { done: 0, total: 2 });
  const withUnsupported = { ...base, objects: [...base.objects, { ...base.objects[0], id: "x", fill: "unsupported" as const }] };
  assert.deepEqual(offlineTodaySummary(withUnsupported, [queued({ temp: 5 }, null)]), { done: 1, total: 2 });
});
