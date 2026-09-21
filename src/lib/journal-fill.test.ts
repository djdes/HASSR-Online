import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mintQrFillToken, verifyQrFillToken } from "./qr-fill-token";
import { journalFillHints, timeMinutesAgo } from "./journal-fill-hints";

process.env.EQUIPMENT_QR_TOKEN_SECRET ??= "test-secret-test-secret-1234";

describe("qr-fill-token: journal kind", () => {
  it("минтит и различает журнал, хаб и документ", () => {
    const journal = verifyQrFillToken(mintQrFillToken("journal", "org1:hygiene"));
    assert.equal(journal.ok && journal.kind, "journal");
    assert.equal(journal.ok && journal.id, "org1:hygiene");
    const doc = verifyQrFillToken(mintQrFillToken("journal", "org1:finished_product:doc9"));
    assert.equal(doc.ok && doc.id, "org1:finished_product:doc9");
    const hub = verifyQrFillToken(mintQrFillToken("journal", "org1:all"));
    assert.equal(hub.ok && hub.id, "org1:all");
  });
  it("токен журнала не принимается оборудованием и наоборот", () => {
    const journal = verifyQrFillToken(mintQrFillToken("journal", "org1:hygiene"));
    assert.equal(journal.ok && journal.kind !== "equipment", true);
    const equipment = verifyQrFillToken(mintQrFillToken("equipment", "eq1"));
    assert.equal(equipment.ok && equipment.kind, "equipment");
  });
});

describe("journal-fill-hints", () => {
  it("бракераж: наименование — блюдо, время −30, температура по памяти; оценка — из вариантов документа", () => {
    const hints = journalFillHints("finished_product");
    assert.equal(hints.nameFields?.productName, "dish");
    assert.equal(hints.timeDefaults?.productionTime, 30);
    // Оценка — select адаптера с вариантами документа, своих подсказок нет.
    assert.equal(hints.defaults?.organoleptic, undefined);
    assert.deepEqual(hints.tempField, { nameKey: "productName", tempKey: "productTemp" });
  });
  it("неизвестный журнал — пустые подсказки", () => {
    // Гигиена: «здоров» по умолчанию и статус кнопками; у неизвестного журнала подсказок нет.
    assert.equal(journalFillHints("hygiene").defaults?.status, "healthy");
    assert.equal(journalFillHints("hygiene").segmented?.status?.healthy, "Здоров");
    assert.deepEqual(journalFillHints("no_such_journal"), {});
  });
  it("timeMinutesAgo даёт ЧЧ:ММ со сдвигом", () => {
    const base = new Date(2026, 8, 19, 10, 5);
    assert.equal(timeMinutesAgo(0, base), "10:05");
    assert.equal(timeMinutesAgo(30, base), "09:35");
    assert.equal(timeMinutesAgo(60, base), "09:05");
  });
});
