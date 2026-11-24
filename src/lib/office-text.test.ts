import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32, deflateRawSync } from "node:zlib";
import JSZip from "jszip";
import { docxPlainText } from "./office-text";

/** ZIP с одной частью и размерами в заголовках, которые можно подделать. */
function zipWith(name: string, data: Buffer, declaredSize: number): Buffer {
  const compressed = deflateRawSync(data);
  const nameBytes = Buffer.from(name, "utf8");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc32(data), 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(declaredSize, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc32(data), 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(declaredSize, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(0, 42);
  const body = Buffer.concat([local, nameBytes, compressed]);
  const directory = Buffer.concat([central, nameBytes]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, directory, end]);
}

test("DOCX: текст абзацев извлекается", async () => {
  const zip = new JSZip();
  zip.file("word/document.xml", "<w:document><w:body><w:p><w:r><w:t>Приёмка</w:t></w:r></w:p><w:p><w:r><w:t>Проверить &amp; записать</w:t></w:r></w:p></w:body></w:document>");
  const text = docxPlainText(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
  assert.equal(text, "Приёмка\nПроверить & записать\n");
});

test("DOCX-«бомба» с ложным размером в заголовках не распаковывается сверх предела", () => {
  const huge = Buffer.alloc(30 * 1024 * 1024, 0x41);
  const bomb = zipWith("word/document.xml", huge, 1000);
  assert.ok(bomb.length < 100 * 1024, `маленький файл: ${bomb.length}`);
  assert.equal(docxPlainText(bomb), null);
});

test("не ZIP и ZIP без document.xml — null", () => {
  assert.equal(docxPlainText(new Uint8Array([1, 2, 3, 4])), null);
  assert.equal(docxPlainText(zipWith("other.xml", Buffer.from("<x/>"), 4)), null);
});
