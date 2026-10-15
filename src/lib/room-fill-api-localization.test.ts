import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { roomResponseFeedback } from "@/app/room-fill/[roomId]/room-fill-client";
import { loadMessages } from "@/i18n/messages";
import { createTranslator } from "use-intl/core";

const photo = "/uploads/readings/0123456789abcdef0123456789abcdef.jpg";
const base = { token: "fixture-token", employeeId: "person" };
type Options = { limited?: boolean; invalid?: boolean; noRoom?: boolean; denied?: boolean; wrongFiller?: boolean; noEmployee?: boolean; required?: boolean; missingPhoto?: boolean; noDocument?: boolean; rolloverReason?: string; missingRow?: boolean; temperature?: boolean; humidity?: boolean };
function fixture(options: Options = {}) {
  const writes: Record<string, unknown>[] = [], audits: Record<string, unknown>[] = [], notifications: Record<string, unknown>[] = [], reads: string[] = [], configWrites: Record<string, unknown>[] = [];
  const person = { id: "person", name: "Customer O‘tkir", role: "cook", canManageSettings: false };
  const norms = { temperature: { enabled: options.temperature ?? true, min: 18, max: 25 }, humidity: { enabled: options.humidity ?? true, min: 15, max: 75 } };
  const room = { id: "room", name: "Customer room", climateNorms: norms, buildingId: "building", fillerUserIds: [], building: { organizationId: "verified-org", organization: { timezone: "Asia/Tashkent", qrFillMode: "pin" } } };
  const config = { controlTimes: ["10:00", "17:00"], rooms: options.missingRow ? [] : [{ id: "row", roomId: "room", name: "Customer source row", ...norms }] };
  const mocks: Record<string, unknown> = {
    "@/lib/db": { db: {
      room: { findUnique: async () => { reads.push("room"); return options.noRoom ? null : room; } },
      user: { findFirst: async (query: { where: { organizationId: string; id: string } }) => { assert.equal(query.where.organizationId, "verified-org"); assert.equal(query.where.id, "person"); return options.noEmployee ? null : person; } },
      journalDocument: { findMany: async (query: { where: { organizationId: string; template: { code: string }; buildingId?: string } }) => { assert.equal(query.where.organizationId, "verified-org"); assert.equal(query.where.template.code, "climate_control"); return options.noDocument ? [] : [{ id: "doc", buildingId: "building", config }]; }, update: async (query: Record<string, unknown>) => { configWrites.push(query); } },
      journalDocumentEntry: { findUnique: async () => ({ data: { responsibleTitle: "Customer audit title", measurements: { row: { "17:00": { temperature: 20, humidity: 40 } }, other: { "10:00": { temperature: 21, humidity: 41 } } } } }), upsert: async (query: Record<string, unknown>) => { writes.push(query); } },
    } },
    "@/lib/qr-fill-token": { verifyQrFillTokenFor: (token: string, kind: string, id: string) => { assert.equal(token, base.token); assert.equal(kind, "room"); assert.equal(id, "room"); return options.invalid ? { ok: false, reason: "bad-signature" } : { ok: true }; } },
    "@/lib/client-ip": { clientIp: () => "fixture-ip" },
    "@/lib/rate-limit": { qrFillRateLimiter: { consume: () => !options.limited } },
    "@/lib/qr-fill-audit": { QR_FILL_RATE_LIMIT_ERROR: "legacy rate limit", qrFillRateKey: () => "fixture", recordQrFillAudit: async (query: Record<string, unknown>) => { audits.push(query); } },
    "@/lib/qr-fill-actor": { normalizeQrFillMode: (value: string) => value },
    "@/lib/qr-object-pass": { readObjectPassCookie: async () => "cookie-pass", resolveObjectActor: async (query: { organizationId: string; employeeId: string; pass?: string; cookiePass: string }) => { assert.equal(query.organizationId, "verified-org"); assert.equal(query.employeeId, "person"); assert.equal(query.cookiePass, "cookie-pass"); return options.denied ? { ok: false, status: 403, error: "legacy actor denial", errorCode: "equipmentFill.errors.pinWrong", errorParams: { attempts: 3 } } : { ok: true, employee: person }; } },
    "@/lib/object-fillers": { OBJECT_FILLER_DENIED: "legacy object denial", canFillObject: () => !options.wrongFiller },
    "@/lib/reading-photo-fixation.server": { getReadingPhotoSettings: async () => ({ enabled: true, required: options.required ?? false }) },
    "@/lib/reading-photo-store": { readingPhotoExists: async () => !options.missingPhoto },
    "@/lib/journal-qr-rollover": { ensureQrPeriodDocuments: async (query: { organizationId: string; templateCode: string; todayKey: string; anchor: { buildingId: string } }) => { assert.equal(query.organizationId, "verified-org"); assert.equal(query.templateCode, "climate_control"); assert.equal(query.todayKey, "2026-10-15"); assert.equal(query.anchor.buildingId, "building"); return { reason: options.rolloverReason ?? "no-document" }; }, qrRolloverMessage: (reason: string) => `legacy ${reason}` },
    "@/lib/temperature-deviations": { subjectKeyForDocumentItem: (doc: string, row: string) => `${doc}:${row}`, processTemperatureReading: async (query: Record<string, unknown>) => { notifications.push(query); } },
  };
  class FixtureDate extends Date { constructor(value?: string | number) { super(value ?? "2026-10-14T21:30:00.000Z"); } }
  const require = createRequire(import.meta.url), mod = { exports: {} };
  const source = ts.transpileModule(readFileSync("src/app/api/room-fill/[roomId]/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { module: mod, exports: mod.exports, console, Date: FixtureDate, URL, Request, Response, require: (id: string) => Object.hasOwn(mocks, id) ? mocks[id] : require(id) });
  const POST = (mod.exports as { POST: (request: Request, context: { params: Promise<{ roomId: string }> }) => Promise<Response> }).POST;
  return { writes, audits, notifications, reads, configWrites, post: (body: unknown) => POST(new Request("https://fixture.invalid/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ roomId: "room" }) }) };
}

test("actual room handler emits additive stable descriptors without unauthorized writes", async () => {
  const cases: [Options, Record<string, unknown>, number, string][] = [
    [{ limited: true }, { temperature: 20 }, 429, "equipmentFill.errors.rateLimit"],
    [{ invalid: true }, { temperature: 20 }, 401, "roomFill.errors.invalidCode"],
    [{ noRoom: true }, { temperature: 20 }, 404, "roomFill.errors.roomNotFound"],
    [{ denied: true }, { temperature: 20 }, 403, "equipmentFill.errors.pinWrong"],
    [{ wrongFiller: true }, { temperature: 20 }, 403, "equipmentFill.errors.objectDenied"],
    [{ noEmployee: true }, { temperature: 20 }, 404, "equipmentFill.errors.employeeNotFound"],
    [{ required: true }, { temperature: 20 }, 400, "equipmentFill.photo.requiredError"],
    [{ missingPhoto: true, required: true }, { temperature: 20, photo }, 400, "equipmentFill.errors.photoNotFound"],
    [{ missingPhoto: true }, { temperature: 20, photo }, 400, "equipmentFill.errors.photoNotFoundOptional"],
    [{ noDocument: true, rolloverReason: "period-closed" }, { temperature: 20 }, 409, "roomFill.errors.periodClosed"],
    [{ noDocument: true, rolloverReason: "org-paused" }, { temperature: 20 }, 409, "roomFill.errors.orgPaused"],
    [{ noDocument: true, rolloverReason: "journal-disabled" }, { temperature: 20 }, 409, "roomFill.errors.noDocument"],
    [{}, { temperature: 30 }, 400, "equipmentFill.errors.correctionRequired"],
    [{}, {}, 400, "roomFill.errors.enterTemperatureOrHumidity"],
    [{}, { humidity: 101 }, 400, "equipmentFill.errors.invalidData"],
  ];
  for (const [options, values, status, code] of cases) {
    const f = fixture(options), response = await f.post({ ...base, ...values }), data = await response.json();
    assert.equal(response.status, status, code); assert.equal(data.errorCode, code); assert.equal(typeof data.error, "string");
    assert.equal(f.writes.length, 0); assert.equal(f.audits.length, 0); assert.equal(f.notifications.length, 0);
    if (options.invalid || options.limited) assert.deepEqual(f.reads, []);
    if (options.denied) assert.deepEqual(data.errorParams, { attempts: 3 });
    if (options.noDocument) assert.equal(data.code, "no-active-document");
  }
});
test("actual room writes preserve measurements, other slots, canonical corrections, photo, audit and business calendar", async () => {
  for (const correction of ["Сообщил руководителю", "Customer action <&>"]) {
    const f = fixture(), response = await f.post({ ...base, temperature: 30, humidity: 90, correction, photo, pass: "signed-pass" });
    assert.equal(response.status, 200); const result = await response.json(); assert.equal(result.slot, "10:00"); assert.equal(result.dateKey, "2026-10-15"); assert.equal(result.photoAttached, true);
    const written = JSON.parse(JSON.stringify(f.writes[0]));
    assert.equal(written.create.employeeId, "person"); assert.equal(written.create.documentId, "doc"); assert.equal(written.create.date, "2026-10-15T00:00:00.000Z");
    assert.deepEqual(written.create.data.measurements.row["10:00"], { temperature: 30, humidity: 90 });
    assert.deepEqual(written.create.data.measurements.row["17:00"], { temperature: 20, humidity: 40 });
    assert.deepEqual(written.create.data.measurements.other["10:00"], { temperature: 21, humidity: 41 });
    assert.equal(written.create.data.responsibleTitle, "Customer audit title");
    assert.equal(written.create.data.corrections["row:10:00:temperature"], correction); assert.equal(written.create.data.corrections["row:10:00:humidity"], correction);
    assert.equal(written.create.data.readingPhotos["row:10:00:temperature"], photo);
    assert.equal(f.audits[0].objectName, "Customer room"); assert.equal(f.audits[0].organizationId, "verified-org"); assert.equal(f.audits[0].temperature, 30); assert.equal(f.audits[0].humidity, 90);
    assert.equal(f.notifications[0].subjectName, "Customer source row"); assert.equal(f.notifications[0].source, "Customer O‘tkir (QR)");
  }
});
test("humidity-only writes remain photo-optional and missing room row is added using directory data", async () => {
  const f = fixture({ required: true, temperature: false, missingRow: true });
  const response = await f.post({ ...base, humidity: 55 }); assert.equal(response.status, 200);
  assert.equal(f.configWrites.length, 1); const update = JSON.parse(JSON.stringify(f.configWrites[0]));
  const added = update.data.config.rooms.find((row: { roomId?: string }) => row.roomId === "room");
  assert.equal(added.name, "Customer room"); assert.equal(added.temperature.enabled, false);
  assert.equal(f.notifications.length, 0); assert.equal(f.audits[0].humidity, 55); assert.equal(f.audits[0].temperature, undefined);
});
test("room response presentation accepts semantic room/shared errors and never displays unknown server prose", async () => {
  assert.deepEqual(roomResponseFeedback({ error: "RAW SERVER" }), { key: "reading.saveError" });
  assert.deepEqual(roomResponseFeedback({ errorCode: "roomFill.page.metadataTitle" }), { key: "reading.saveError" });
  assert.deepEqual(roomResponseFeedback({ errorCode: "equipmentFill.errors.pinWrong", errorParams: { attempts: "RAW" } }), { key: "reading.saveError" });
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale), t = createTranslator({ locale, messages, namespace: "roomFill" });
    for (const key of ["invalidCode", "roomNotFound", "enterTemperatureOrHumidity", "noDocument", "periodClosed", "orgPaused"] as const) {
      const feedback = roomResponseFeedback({ errorCode: `roomFill.errors.${key}`, error: "RAW SERVER" });
      assert.ok("roomKey" in feedback); assert.equal(t(feedback.roomKey), messages.roomFill.errors[key]);
    }
  }
});
