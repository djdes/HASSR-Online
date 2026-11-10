import assert from "node:assert/strict";
import { test } from "node:test";

import { parseOfflineQr } from "./qr-url";

test("equipment sticker", () => {
  const parsed = parseOfflineQr("https://wesetup.ru/equipment-fill/cm1abc?token=equipment.cm1abc.sig");
  assert.deepEqual(parsed, { ok: true, target: { kind: "equipment", equipmentId: "cm1abc", token: "equipment.cm1abc.sig" } });
});

test("room sticker, www host, extra params and url-encoded id", () => {
  const parsed = parseOfflineQr("https://www.wesetup.ru/room-fill/room%2D1?utm=x&token=t%2E1");
  assert.deepEqual(parsed, { ok: true, target: { kind: "room", roomId: "room-1", token: "t.1" } });
});

test("journal poster, hub, document and point posters share one address shape", () => {
  const journal = parseOfflineQr("https://wesetup.ru/journal-fill/org1/hygiene?token=abc&view=all");
  assert.deepEqual(journal, {
    ok: true,
    target: { kind: "journal", orgId: "org1", code: "hygiene", hub: false, token: "abc", shortSig: null, buildingId: null, documentId: null },
  });
  const hub = parseOfflineQr("https://wesetup.ru/journal-fill/org1/all?token=abc");
  assert.equal(hub.ok && hub.target.kind === "journal" && hub.target.hub, true);
});

test("short QR from a printed journal header", () => {
  const parsed = parseOfflineQr("https://wesetup.ru/qj/org1/cleaning/Ab3_x");
  assert.deepEqual(parsed, {
    ok: true,
    target: { kind: "journal", orgId: "org1", code: "cleaning", hub: false, token: null, shortSig: "Ab3_x", buildingId: null, documentId: null },
  });
});

test("bare path from the service worker fallback", () => {
  const parsed = parseOfflineQr("/equipment-fill/cm1abc?token=t");
  assert.equal(parsed.ok && parsed.target.kind, "equipment");
});

test("own host passed by the page is accepted, others are not", () => {
  assert.equal(parseOfflineQr("http://localhost:3000/room-fill/r1?token=t", ["localhost:3000"]).ok, true);
  assert.deepEqual(parseOfflineQr("https://evil.example/equipment-fill/x?token=t"), { ok: false, reason: "foreign-host" });
  assert.deepEqual(parseOfflineQr("https://wesetup.ru.evil.example/equipment-fill/x"), { ok: false, reason: "foreign-host" });
});

test("garbage, other schemes and unknown paths are not ours", () => {
  assert.deepEqual(parseOfflineQr(""), { ok: false, reason: "empty" });
  assert.deepEqual(parseOfflineQr("просто текст"), { ok: false, reason: "unknown-path" });
  assert.deepEqual(parseOfflineQr("tel:+79990000000"), { ok: false, reason: "foreign-host" });
  assert.deepEqual(parseOfflineQr("https://wesetup.ru/pricing"), { ok: false, reason: "unknown-path" });
  assert.deepEqual(parseOfflineQr("https://wesetup.ru/equipment-fill/a/b"), { ok: false, reason: "unknown-path" });
  assert.deepEqual(parseOfflineQr("https://wesetup.ru/equipment-fill/%E0%A4%A"), { ok: false, reason: "bad-id" });
  assert.deepEqual(parseOfflineQr("https://wesetup.ru/journal-fill/org1"), { ok: false, reason: "unknown-path" });
});

test("ids made of names (Cyrillic, spaces) are accepted as the site encodes them", () => {
  const id = "cm1org-Бар-Холодильный шкаф Бар 1";
  const parsed = parseOfflineQr(`https://wesetup.ru/equipment-fill/${encodeURIComponent(id)}?token=t`);
  assert.deepEqual(parsed, { ok: true, target: { kind: "equipment", equipmentId: id, token: "t" } });
  assert.deepEqual(parseOfflineQr("https://wesetup.ru/equipment-fill/a%2Fb?token=t"), { ok: false, reason: "bad-id" });
});

test("плакат точки: точка и документ читаются из токена, как на странице с интернетом", async () => {
  const { readJournalQrScope } = await import("./qr-url");
  const point = parseOfflineQr("https://wesetup.ru/journal-fill/org1/hygiene?token=journal:org1:hygiene:b~bld68.1700000000000.sig");
  assert.ok(point.ok && point.target.kind === "journal");
  assert.equal(point.target.buildingId, "bld68");
  assert.equal(point.target.documentId, null);

  const hub = parseOfflineQr("https://wesetup.ru/journal-fill/org1/all?token=journal:org1:all:b~bld68.1700000000000.sig");
  assert.ok(hub.ok && hub.target.kind === "journal" && hub.target.hub);
  assert.equal(hub.target.buildingId, "bld68");

  assert.deepEqual(readJournalQrScope("journal:org1:hygiene:doc7:2026-11-15.1.sig", "org1", "hygiene"), { buildingId: null, documentId: "doc7" });
  assert.deepEqual(readJournalQrScope("journal:org1:hygiene.1.sig", "org1", "hygiene"), { buildingId: null, documentId: null });
  // Чужая организация или другой журнал в токене — точку из него не берём.
  assert.deepEqual(readJournalQrScope("journal:org2:hygiene:b~x.1.sig", "org1", "hygiene"), { buildingId: null, documentId: null });
  assert.deepEqual(readJournalQrScope("journal:org1:cleaning:b~x.1.sig", "org1", "hygiene"), { buildingId: null, documentId: null });
  assert.deepEqual(readJournalQrScope(null, "org1", "hygiene"), { buildingId: null, documentId: null });
});
