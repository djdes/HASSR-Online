import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  clampEventTime,
  EVENT_FUTURE_SLACK_MS,
  generateHelperToken,
  hashHelperToken,
  helperAccessError,
  MAX_SYNC_EVENTS,
  normalizeBluetoothAddress,
  parseSyncRequest,
  planPrinterEvent,
  readHelperClientInfo,
  setupHelperDownloadUrl,
  type HelperEvent,
  type PrinterState,
} from "./setup-helper";

const NOW = new Date("2026-10-25T12:00:00.000Z");
const actor = { deviceId: "device-1", userId: "user-1" };

function connected(at: string, extra: Partial<Record<string, unknown>> = {}) {
  return {
    id: `c-${at.replace(/\D/g, "")}`,
    type: "printer_connected",
    at,
    printer: { address: "dc:0d:30:12:34:56", name: "IP-802BT", model: "AIYIN IP-802BT", transport: "classic" },
    ...extra,
  };
}

function eventOf(raw: unknown): HelperEvent {
  const parsed = parseSyncRequest({ events: [raw] }, NOW);
  assert.ok(parsed);
  assert.equal(parsed.rejected.length, 0, "fixture must be valid");
  return parsed.events[0];
}

test("helper tokens are random base64url and stored only as a prefixed sha256", () => {
  const a = generateHelperToken();
  const b = generateHelperToken();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.match(hashHelperToken(a), /^[0-9a-f]{64}$/);
  assert.equal(hashHelperToken(a), hashHelperToken(a));
  // Не совпадает с голым sha256, как у ключей агента печати.
  assert.notEqual(hashHelperToken(a), createHash("sha256").update(a).digest("hex"));
});

test("bluetooth addresses are normalised to upper-case colon form", () => {
  assert.equal(normalizeBluetoothAddress("dc:0d:30:12:34:56"), "DC:0D:30:12:34:56");
  assert.equal(normalizeBluetoothAddress(" DC-0D-30-12-34-56 "), "DC:0D:30:12:34:56");
  assert.equal(normalizeBluetoothAddress("DC:0D:30:12:34"), null);
  assert.equal(normalizeBluetoothAddress("GG:0D:30:12:34:56"), null);
  assert.equal(normalizeBluetoothAddress(42), null);
});

test("event time trusts the phone unless its clock is obviously wrong", () => {
  const recent = new Date("2026-10-20T08:00:00.000Z");
  assert.equal(clampEventTime(recent, NOW), recent);
  assert.equal(clampEventTime(new Date(NOW.getTime() + EVENT_FUTURE_SLACK_MS - 1), NOW).getTime(), NOW.getTime() + EVENT_FUTURE_SLACK_MS - 1);
  assert.equal(clampEventTime(new Date("2027-01-01T00:00:00Z"), NOW), NOW);
  assert.equal(clampEventTime(new Date("2001-01-01T00:00:00Z"), NOW), NOW);
  assert.equal(clampEventTime(new Date("nope"), NOW), NOW);
});

test("sync parsing validates each event on its own and never drops the whole batch for one bad record", () => {
  const parsed = parseSyncRequest({
    appVersion: " 1.0.0 ",
    events: [
      connected("2026-10-25T10:00:00Z"),
      { id: "bad-address-1", type: "printer_connected", at: "2026-10-25T10:00:00Z", printer: { address: "nope", name: "X", transport: "classic" } },
      { id: "bad-type-0001", type: "printer_exploded", at: "2026-10-25T10:00:00Z", printer: { address: "DC:0D:30:12:34:56" } },
      { id: "bad-copies-01", type: "printer_printed", at: "2026-10-25T10:01:00Z", printer: { address: "DC:0D:30:12:34:56" }, template: "test-58x40", copies: 0 },
      { type: "printer_removed", at: "2026-10-25T10:01:00Z", printer: { address: "DC:0D:30:12:34:56" } },
      { id: "printed-00001", type: "printer_printed", at: "2026-10-25T10:02:00.500Z", printer: { address: "DC:0D:30:12:34:56" }, template: "test-58x40", copies: 2 },
      { id: "removed-00001", type: "printer_removed", at: "2026-10-25T13:02:00+03:00", printer: { address: "dc-0d-30-12-34-56" } },
    ],
  }, NOW);
  assert.ok(parsed);
  assert.equal(parsed.appVersion, "1.0.0");
  assert.deepEqual(parsed.rejected, ["bad-address-1", "bad-type-0001", "bad-copies-01"]);
  assert.deepEqual(parsed.events.map(event => event.type), ["printer_connected", "printer_printed", "printer_removed"]);
  const [first, printed, removed] = parsed.events;
  assert.equal(first.address, "DC:0D:30:12:34:56");
  assert.equal(first.type === "printer_connected" && first.model, "AIYIN IP-802BT");
  assert.equal(printed.type === "printer_printed" && printed.copies, 2);
  assert.equal(removed.at.toISOString(), "2026-10-25T10:02:00.000Z");
});

test("sync parsing refuses malformed or oversized requests", () => {
  assert.equal(parseSyncRequest(null, NOW), null);
  assert.equal(parseSyncRequest({ events: "x" }, NOW), null);
  assert.equal(parseSyncRequest({ events: Array.from({ length: MAX_SYNC_EVENTS + 1 }, (_, i) => connected(`2026-10-25T10:00:${String(i % 60).padStart(2, "0")}Z`)) }, NOW), null);
  assert.deepEqual(parseSyncRequest({ events: [] }, NOW), { events: [], rejected: [], appVersion: null });
});

test("first connection creates the printer from the event and the device that sent it", () => {
  const event = eventOf(connected("2026-10-25T10:00:00Z"));
  const plan = planPrinterEvent(null, event, actor);
  assert.deepEqual(plan, {
    kind: "create",
    data: {
      address: "DC:0D:30:12:34:56",
      name: "IP-802BT",
      model: "AIYIN IP-802BT",
      transport: "classic",
      deviceId: "device-1",
      connectedById: "user-1",
      connectedAt: new Date("2026-10-25T10:00:00Z"),
    },
  });
});

test("replaying the same connection is a no-op and an older connection never overwrites a newer one", () => {
  const state: PrinterState = { connectedAt: new Date("2026-10-25T10:00:00Z"), lastPrintAt: null, removedAt: null };
  assert.deepEqual(planPrinterEvent(state, eventOf(connected("2026-10-25T10:00:00Z")), actor), { kind: "skip" });
  assert.deepEqual(planPrinterEvent(state, eventOf(connected("2026-10-25T09:00:00Z")), actor), { kind: "skip" });
  const newer = planPrinterEvent(state, eventOf(connected("2026-10-25T11:00:00Z")), { deviceId: "device-2", userId: "user-2" });
  assert.equal(newer.kind, "update");
  assert.equal(newer.kind === "update" && newer.data.deviceId, "device-2");
  assert.equal(newer.kind === "update" && newer.data.removedAt, null);
});

test("a late connection does not resurrect a printer removed afterwards, a newer one does", () => {
  // Время событий — до NOW: «будущее» по часам телефона заменяется временем сервера.
  const removed: PrinterState = { connectedAt: new Date("2026-10-25T09:00:00Z"), lastPrintAt: null, removedAt: new Date("2026-10-25T11:00:00Z") };
  const late = planPrinterEvent(removed, eventOf(connected("2026-10-25T10:30:00Z")), actor);
  assert.equal(late.kind, "update");
  assert.deepEqual(late.kind === "update" && late.data.removedAt, new Date("2026-10-25T11:00:00Z"));
  const again = planPrinterEvent(removed, eventOf(connected("2026-10-25T11:30:00Z")), actor);
  assert.equal(again.kind === "update" && again.data.removedAt, null);
});

test("prints keep the latest time and template, duplicates and stale prints are skipped", () => {
  const state: PrinterState = { connectedAt: new Date("2026-10-25T09:00:00Z"), lastPrintAt: new Date("2026-10-25T10:00:00Z"), removedAt: null };
  const print = (at: string) => eventOf({ id: `p-${at.replace(/\D/g, "")}`, type: "printer_printed", at, printer: { address: "DC:0D:30:12:34:56" }, template: "product", copies: 3 });
  assert.deepEqual(planPrinterEvent(state, print("2026-10-25T10:00:00Z"), actor), { kind: "skip" });
  assert.deepEqual(planPrinterEvent(state, print("2026-10-25T09:30:00Z"), actor), { kind: "skip" });
  assert.deepEqual(planPrinterEvent(state, print("2026-10-25T10:30:00Z"), actor), {
    kind: "update",
    data: { lastPrintAt: new Date("2026-10-25T10:30:00Z"), lastTemplate: "product" },
  });
  assert.deepEqual(planPrinterEvent(null, print("2026-10-25T10:30:00Z"), actor), { kind: "skip" });
});

test("removal applies only after the latest connection and only once", () => {
  const state: PrinterState = { connectedAt: new Date("2026-10-25T10:00:00Z"), lastPrintAt: null, removedAt: null };
  const remove = (at: string) => eventOf({ id: `r-${at.replace(/\D/g, "")}`, type: "printer_removed", at, printer: { address: "DC:0D:30:12:34:56" } });
  assert.deepEqual(planPrinterEvent(state, remove("2026-10-25T09:00:00Z"), actor), { kind: "skip" });
  assert.deepEqual(planPrinterEvent(state, remove("2026-10-25T11:00:00Z"), actor), { kind: "update", data: { removedAt: new Date("2026-10-25T11:00:00Z") } });
  const removed = { ...state, removedAt: new Date("2026-10-25T11:00:00Z") };
  assert.deepEqual(planPrinterEvent(removed, remove("2026-10-25T11:00:00Z"), actor), { kind: "skip" });
  assert.deepEqual(planPrinterEvent(null, remove("2026-10-25T11:00:00Z"), actor), { kind: "skip" });
});

test("client info from the login request is trimmed and the installation id is validated", () => {
  assert.deepEqual(readHelperClientInfo({ deviceName: "  Samsung   SM-A515F ", appVersion: "1.0.0", installationId: "3f2b9c1e-1111-4a2b-9c3d-123456789abc" }), {
    deviceName: "Samsung SM-A515F",
    appVersion: "1.0.0",
    installationId: "3f2b9c1e-1111-4a2b-9c3d-123456789abc",
  });
  assert.deepEqual(readHelperClientInfo({ installationId: "../etc/passwd" }), { deviceName: "Android", appVersion: null, installationId: null });
  assert.equal(readHelperClientInfo({ deviceName: "x".repeat(300) }).deviceName.length, 100);
});

test("download link is absolute so it works when opened from a phone", () => {
  const before = process.env.NEXTAUTH_URL;
  try {
    process.env.NEXTAUTH_URL = "https://wesetup.ru/";
    assert.equal(setupHelperDownloadUrl(), "https://wesetup.ru/api/setup-helper/download");
    delete process.env.NEXTAUTH_URL;
    assert.equal(setupHelperDownloadUrl(), "https://wesetup.ru/api/setup-helper/download");
  } finally {
    if (before === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = before;
  }
});

test("only venue management may use the app; root and staff are refused with a reason", () => {
  for (const role of ["manager", "owner", "head_chef", "technologist"]) {
    assert.equal(helperAccessError({ role, isRoot: false }), null, role);
  }
  for (const role of ["cook", "waiter", "operator", null]) {
    assert.match(helperAccessError({ role, isRoot: false }) ?? "", /управляющий или заведующий/, String(role));
  }
  assert.equal(helperAccessError({ role: "manager", isRoot: true }), "Войдите под учётной записью заведения");
});
