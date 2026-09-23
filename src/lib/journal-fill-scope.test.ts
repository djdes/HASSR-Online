import assert from "node:assert/strict";
import test from "node:test";

process.env.EQUIPMENT_QR_TOKEN_SECRET ??= "test-secret-test-secret-1234";

import { mintQrFillToken } from "./qr-fill-token";
import { OBJECT_QR_JOURNAL_CODES, verifyJournalFillToken } from "./journal-fill";

/**
 * Плакат журнала открывает только свой журнал (раньше — любой журнал
 * организации, ради удалённого «Дальше →»). Хаб «Все журналы» — по-прежнему
 * любой; плакат документа сужает до документа.
 */
test("токен журнала открывает только свой журнал", () => {
  const token = mintQrFillToken("journal", "org1:hygiene");
  assert.deepEqual(verifyJournalFillToken(token, "org1", "hygiene"), { ok: true, documentId: null, hub: false, validUntil: null, buildingId: null });
  assert.equal(verifyJournalFillToken(token, "org1", "finished_product").ok, false);
  assert.equal(verifyJournalFillToken(token, "org2", "hygiene").ok, false);
});

test("хаб открывает любой журнал, плакат документа — свой документ", () => {
  const hub = mintQrFillToken("journal", "org1:all");
  assert.deepEqual(verifyJournalFillToken(hub, "org1", "finished_product"), { ok: true, documentId: null, hub: true, validUntil: null, buildingId: null });
  const doc = mintQrFillToken("journal", "org1:finished_product:doc9");
  assert.deepEqual(verifyJournalFillToken(doc, "org1", "finished_product"), { ok: true, documentId: "doc9", hub: false, validUntil: null, buildingId: null });
});

test("холодильники, склады и УФ-лампы заполняются по наклейке на объекте", () => {
  assert.equal(OBJECT_QR_JOURNAL_CODES.has("cold_equipment_control"), true);
  assert.equal(OBJECT_QR_JOURNAL_CODES.has("climate_control"), true);
  // УФ-лампу нельзя заполнить из «Все журналы» — только по наклейке на лампе.
  assert.equal(OBJECT_QR_JOURNAL_CODES.has("uv_lamp_runtime"), true);
  assert.equal(OBJECT_QR_JOURNAL_CODES.has("hygiene"), false);
});
