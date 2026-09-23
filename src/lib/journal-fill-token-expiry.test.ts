import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.EQUIPMENT_QR_TOKEN_SECRET ??= "test-secret-test-secret-1234";

import { mintQrFillToken } from "./qr-fill-token";
import {
  JOURNAL_FILL_PERPETUAL_UNTIL,
  journalFillSubject,
  journalFillTokenExpired,
  journalFillValidUntil,
  scopeDocumentsToBuilding,
  verifyJournalFillToken,
} from "./journal-fill";

/**
 * Дополнительный QR документа (2026-09-23) действует до конца периода
 * документа: дата — в подписанной части субъекта. Основной QR точки —
 * `b~<buildingId>`, бессрочный. Старые формы не меняются.
 */
const mint = (subject: string) => mintQrFillToken("journal", subject);

describe("токен документа со сроком", () => {
  it("выпуск и проверка: срок и документ из подписи", () => {
    const token = mint(journalFillSubject("org1", "hygiene", "doc9", { validUntil: "2026-09-30" }));
    assert.deepEqual(verifyJournalFillToken(token, "org1", "hygiene"), {
      ok: true,
      documentId: "doc9",
      hub: false,
      validUntil: "2026-09-30",
      buildingId: null,
    });
  });

  it("подмена даты в токене — неверная подпись", () => {
    const token = mint(journalFillSubject("org1", "hygiene", "doc9", { validUntil: "2026-09-30" }));
    const forged = token.replace("2026-09-30", "2099-12-31");
    assert.notEqual(forged, token);
    assert.deepEqual(verifyJournalFillToken(forged, "org1", "hygiene"), { ok: false, reason: "bad-sig" });
  });

  it("кривой 4-й сегмент и лишние сегменты — bad-format", () => {
    for (const subject of [
      "org1:hygiene:doc9:2026-13-01",
      "org1:hygiene:doc9:2026-02-30",
      "org1:hygiene:doc9:abc",
      "org1:hygiene:doc9:20260930",
      "org1:hygiene:doc9:2026-09-30:x",
      "org1:hygiene::2026-09-30",
      "org1:hygiene:b~b1:2026-09-30",
      "org1:hygiene:",
      "org1:hygiene:b~",
      "org1:all:doc9",
    ]) {
      assert.deepEqual(verifyJournalFillToken(mint(subject), "org1", "hygiene"), { ok: false, reason: "bad-format" }, subject);
    }
  });

  it("в последний день ещё работает, на следующий — нет", () => {
    const check = verifyJournalFillToken(mint(journalFillSubject("org1", "hygiene", "doc9", { validUntil: "2026-09-30" })), "org1", "hygiene");
    assert.equal(journalFillTokenExpired(check, "2026-09-29"), false);
    assert.equal(journalFillTokenExpired(check, "2026-09-30"), false);
    assert.equal(journalFillTokenExpired(check, "2026-10-01"), true);
  });

  it("старые токены и основной QR не истекают", () => {
    for (const subject of ["org1:hygiene", "org1:hygiene:doc9", "org1:all", "org1:hygiene:b~b1"]) {
      const check = verifyJournalFillToken(mint(subject), "org1", "hygiene");
      assert.equal(check.ok, true, subject);
      assert.equal(journalFillTokenExpired(check, "2099-01-01"), false, subject);
    }
  });

  it("бессрочный документ — 2099-12-31, срочный — его dateTo", () => {
    assert.equal(JOURNAL_FILL_PERPETUAL_UNTIL, "2099-12-31");
    assert.equal(journalFillValidUntil(new Date("2099-12-31T00:00:00.000Z")), "2099-12-31");
    assert.equal(journalFillValidUntil("2150-01-01"), "2099-12-31");
    assert.equal(journalFillValidUntil(new Date("2026-09-30T00:00:00.000Z")), "2026-09-30");
  });

  it("выпуск с кривой датой не проходит", () => {
    assert.throws(() => journalFillSubject("org1", "hygiene", "doc9", { validUntil: "30.09.2026" }));
    assert.throws(() => journalFillSubject("org1", "hygiene", null, { validUntil: "2026-09-30" }));
  });
});

describe("основной QR точки `b~<buildingId>`", () => {
  it("выпуск и проверка", () => {
    const subject = journalFillSubject("org1", "hygiene", null, { buildingId: "b1" });
    assert.equal(subject, "org1:hygiene:b~b1");
    assert.deepEqual(verifyJournalFillToken(mint(subject), "org1", "hygiene"), {
      ok: true,
      documentId: null,
      hub: false,
      validUntil: null,
      buildingId: "b1",
    });
  });

  it("не открывает чужой журнал и чужую организацию", () => {
    const token = mint("org1:hygiene:b~b1");
    assert.deepEqual(verifyJournalFillToken(token, "org1", "cleaning"), { ok: false, reason: "mismatch" });
    assert.deepEqual(verifyJournalFillToken(token, "org2", "hygiene"), { ok: false, reason: "mismatch" });
  });

  it("документы точки и общие; точка не из организации — фильтра нет", () => {
    const docs = [
      { id: "a", buildingId: "b1" },
      { id: "b", buildingId: "b2" },
      { id: "c", buildingId: null },
    ];
    assert.deepEqual(scopeDocumentsToBuilding(docs, "b1", ["b1", "b2"]).map((d) => d.id), ["a", "c"]);
    assert.deepEqual(scopeDocumentsToBuilding(docs, null, ["b1", "b2"]).map((d) => d.id), ["a", "b", "c"]);
    assert.deepEqual(scopeDocumentsToBuilding(docs, "b1", [null]).map((d) => d.id), ["a", "b", "c"]);
  });
});
