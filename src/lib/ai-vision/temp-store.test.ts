import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  deleteVisionImages,
  mimeOfVisionImageId,
  readVisionImage,
  saveVisionImage,
  sniffImageMime,
  sweepExpiredVisionImages,
  visionTempDir,
} from "@/lib/ai-vision/temp-store";

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const WEBP = Uint8Array.from([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBPVP8 ")]);

async function withDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vision-test-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("тип фото — по сигнатуре, не по имени", () => {
  assert.equal(sniffImageMime(JPEG), "image/jpeg");
  assert.equal(sniffImageMime(PNG), "image/png");
  assert.equal(sniffImageMime(WEBP), "image/webp");
  assert.equal(sniffImageMime(Buffer.from("GIF89a....")), null);
  assert.equal(sniffImageMime(Buffer.from("%PDF-1.7")), null);
  assert.equal(sniffImageMime(new Uint8Array()), null);
  assert.equal(mimeOfVisionImageId("0123456789abcdef0123456789abcdef-webp"), "image/webp");
});

test("папка по умолчанию — tmp/wesetup-vision", () => {
  assert.equal(visionTempDir(), path.join(os.tmpdir(), "wesetup-vision"));
});

test("сохранить → прочитать → удалить; имя случайное, расширение по сигнатуре", async () => {
  await withDir(async (dir) => {
    const first = await saveVisionImage(PNG, { dir });
    const second = await saveVisionImage(PNG, { dir });
    assert.ok(first && second);
    assert.match(first.id, /^[a-f0-9]{32}-png$/);
    assert.notEqual(first.id, second.id);
    const read = await readVisionImage(first.id, { dir });
    assert.equal(read?.mime, "image/png");
    assert.deepEqual(Uint8Array.from(read!.bytes), PNG);
    assert.equal(await deleteVisionImages([first.id, second.id, "../../evil"], { dir }), 2);
    assert.equal(await readVisionImage(first.id, { dir }), null);
    assert.deepEqual(await fs.readdir(dir), []);
  });
});

test("не картинка — не сохраняется", async () => {
  await withDir(async (dir) => {
    assert.equal(await saveVisionImage(Buffer.from("<html>"), { dir }), null);
    assert.deepEqual(await fs.readdir(dir), []);
  });
});

test("чужие имена не читаются", async () => {
  await withDir(async (dir) => {
    await fs.writeFile(path.join(dir, "secret.txt"), "x");
    assert.equal(await readVisionImage("secret.txt", { dir }), null);
    assert.equal(await readVisionImage("../secret.txt", { dir }), null);
  });
});

test("подметание: старше 15 минут — удаляется, свежее и чужое — остаются", async () => {
  await withDir(async (dir) => {
    const old = await saveVisionImage(JPEG, { dir });
    const fresh = await saveVisionImage(WEBP, { dir });
    await fs.writeFile(path.join(dir, "keep.txt"), "x");
    const past = new Date(Date.now() - 16 * 60 * 1000);
    await fs.utimes(path.join(dir, old!.id), past, past);
    await fs.utimes(path.join(dir, "keep.txt"), past, past);
    assert.equal(await sweepExpiredVisionImages({ dir }), 1);
    const left = (await fs.readdir(dir)).sort();
    assert.deepEqual(left, [fresh!.id, "keep.txt"].sort());
  });
});

test("подметание несуществующей папки — 0 без ошибки", async () => {
  assert.equal(await sweepExpiredVisionImages({ dir: path.join(os.tmpdir(), "vision-test-missing-dir-xyz") }), 0);
});
