import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32, deflateSync } from "node:zlib";
import { SIGNATURE_MAX_BYTES, ackMethodOf, parseSignatureDataUrl } from "./signature";
import { isTextDoc, textDocCreateSchema, textDocFileName, textDocPatchSchema } from "./text-docs";

/** Минимальный PNG (оттенки серого): белый фон и горизонтальный штрих. */
function pngDataUrl(width: number, height: number): string {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 8 бит
  header[9] = 0; // оттенки серого
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(width + 1, 255);
    row[0] = 0; // без фильтра
    if (y === Math.floor(height / 2)) for (let x = 10; x < Math.min(width, 120); x += 1) row[x + 1] = 0;
    rows.push(row);
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

test("подпись: PNG принимается, размеры читаются", () => {
  const parsed = parseSignatureDataUrl(pngDataUrl(600, 200));
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.width, 600);
    assert.equal(parsed.height, 200);
  }
});

test("подпись: не PNG, пусто, слишком большая, мелкая картинка — отказ", () => {
  assert.equal(parseSignatureDataUrl("data:image/jpeg;base64,/9j/4AAQ").ok, false);
  assert.equal(parseSignatureDataUrl("").ok, false);
  assert.equal(parseSignatureDataUrl(42).ok, false);
  assert.equal(parseSignatureDataUrl("data:image/png;base64,AAAA").ok, false);
  assert.equal(parseSignatureDataUrl("data:image/png;base64,***").ok, false);
  const huge = `data:image/png;base64,${Buffer.alloc(SIGNATURE_MAX_BYTES + 10, 1).toString("base64")}`;
  assert.equal(parseSignatureDataUrl(huge).ok, false);
  assert.equal(parseSignatureDataUrl(pngDataUrl(10, 10)).ok, false);
});

test("способ отметки: подпись, PIN, в кабинете (старые отметки — в кабинете)", () => {
  assert.equal(ackMethodOf("finger", false), "finger");
  assert.equal(ackMethodOf(null, true), "finger");
  assert.equal(ackMethodOf("pin", false), "pin");
  assert.equal(ackMethodOf("self", false), "self");
  assert.equal(ackMethodOf(null, false), "self");
});

test("документ текстом: имя файла, проверки создания и правки", () => {
  assert.equal(textDocFileName("Личная гигиена"), "Личная гигиена.txt");
  assert.equal(textDocFileName('Приёмка: сырьё / тара?'), "Приёмка сырьё тара.txt");
  assert.equal(textDocFileName("   "), "Документ.txt");
  assert.equal(isTextDoc("text/plain; charset=utf-8"), true);
  assert.equal(isTextDoc("application/pdf"), false);
  assert.equal(textDocCreateSchema.safeParse({ source: "knowledge", title: "Личная гигиена", text: "Мыть руки" }).success, true);
  assert.equal(textDocCreateSchema.safeParse({ source: "knowledge", title: "Личная гигиена", text: "   " }).success, false);
  assert.equal(textDocCreateSchema.safeParse({ source: "lab", title: "x", text: "y" }).success, false);
  assert.equal(textDocPatchSchema.safeParse({}).success, false);
  assert.equal(textDocPatchSchema.safeParse({ text: "Новый текст" }).success, true);
  assert.equal(textDocPatchSchema.safeParse({ title: "x", extra: 1 }).success, false);
});
