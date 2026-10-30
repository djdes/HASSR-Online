import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  checkEdoUpload,
  cleanFileName,
  EDO_MAX_FILE_BYTES,
  EDO_SABY_TYPE,
  guessDocMeta,
  isEdoKind,
  isValidDocDate,
  moscowYmd,
  planEdoSend,
} from "./registry";
import { decryptEdoSecret, encryptEdoSecret } from "./secret-crypto";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("реестр видов", () => {
  test("типы Saby: договор — ДоговорДок, счёт — СчетИсх, УПД — ДокОтгрИсх", () => {
    assert.equal(EDO_SABY_TYPE.contract, "ДоговорДок");
    assert.equal(EDO_SABY_TYPE.invoice, "СчетИсх");
    assert.equal(EDO_SABY_TYPE.upd, "ДокОтгрИсх");
    assert.ok(isEdoKind("upd"));
    assert.equal(isEdoKind("act"), false);
  });

  test("planEdoSend: счёт и УПД — только из WeSetup, прочее — только файлом, договор — оба пути", () => {
    assert.deepEqual(planEdoSend({ kind: "invoice", sourceId: "12", hasFile: false }), { mode: "source", sourceId: "12" });
    assert.ok("error" in planEdoSend({ kind: "invoice", hasFile: true }));
    assert.ok("error" in planEdoSend({ kind: "upd", sourceId: " ", hasFile: false }));
    assert.deepEqual(planEdoSend({ kind: "contract", hasFile: true }), { mode: "file" });
    assert.deepEqual(planEdoSend({ kind: "contract", sourceId: "c1", hasFile: false }), { mode: "source", sourceId: "c1" });
    assert.deepEqual(planEdoSend({ kind: "other", hasFile: true }), { mode: "file" });
    assert.ok("error" in planEdoSend({ kind: "other", sourceId: "x", hasFile: false }));
    assert.ok("error" in planEdoSend({ kind: "contract", hasFile: false }));
  });
});

describe("загрузка файла", () => {
  test("подходят PDF/DOCX/ODT/RTF с верной сигнатурой", () => {
    assert.equal(checkEdoUpload("Договор.pdf", bytes("%PDF-1.7")), null);
    assert.equal(checkEdoUpload("Договор.DOCX", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0])), null);
    assert.equal(checkEdoUpload("d.odt", new Uint8Array([0x50, 0x4b, 0x03, 0x04])), null);
    assert.equal(checkEdoUpload("d.rtf", bytes("{\\rtf1")), null);
  });

  test("чужое расширение, пустой, большой, подмена содержимого — понятный отказ", () => {
    assert.match(checkEdoUpload("a.exe", bytes("MZ")) ?? "", /PDF, DOCX/);
    assert.match(checkEdoUpload("a.pdf", new Uint8Array()) ?? "", /пустой/);
    assert.match(checkEdoUpload("a.pdf", new Uint8Array(EDO_MAX_FILE_BYTES + 1)) ?? "", /10 МБ/);
    assert.match(checkEdoUpload("a.pdf", bytes("<html>")) ?? "", /не похоже/);
    assert.match(checkEdoUpload("  ", bytes("%PDF")) ?? "", /нет имени/);
  });

  test("имя файла без пути и управляющих символов", () => {
    assert.equal(cleanFileName("C:\\Users\\x\\Договор\u0007.pdf"), "Договор.pdf");
    assert.equal(cleanFileName("/tmp/a/b.pdf"), "b.pdf");
  });

  test("номер и дата из имени файла", () => {
    assert.deepEqual(guessDocMeta("Договор № 2810-1 ООО «БФС» 28.10.2026 (2).docx"), { number: "2810-1", date: "2026-10-28" });
    assert.deepEqual(guessDocMeta("скан.pdf"), { number: "", date: "" });
    assert.deepEqual(guessDocMeta("№ 28.10.2026.pdf"), { number: "", date: "2026-10-28" });
  });

  test("даты: настоящая ГГГГ-ММ-ДД и московская дата документа", () => {
    assert.ok(isValidDocDate("2026-10-28"));
    assert.equal(isValidDocDate("2026-02-31"), false);
    assert.equal(isValidDocDate("28.10.2026"), false);
    // 21:30 UTC 28-го — в Москве уже 29-е.
    assert.equal(moscowYmd(new Date("2026-10-28T21:30:00Z")), "2026-10-29");
  });
});

describe("шифрование ключей Saby", () => {
  test("туда-обратно; другое назначение и другой NEXTAUTH_SECRET не расшифровывают", () => {
    const prev = process.env.NEXTAUTH_SECRET;
    process.env.NEXTAUTH_SECRET = "test-secret-aaaaaaaaaaaaaaaa";
    try {
      const enc = encryptEdoSecret("app-secret-1");
      assert.notEqual(enc, "app-secret-1");
      assert.doesNotMatch(enc, /app-secret/);
      assert.equal(decryptEdoSecret(enc), "app-secret-1");
      assert.notEqual(encryptEdoSecret("app-secret-1"), enc, "IV случайный");
      assert.throws(() => decryptEdoSecret(enc, "other"));
      process.env.NEXTAUTH_SECRET = "another-secret-bbbbbbbbbbbbbb";
      assert.throws(() => decryptEdoSecret(enc));
    } finally {
      process.env.NEXTAUTH_SECRET = prev;
    }
  });
});
