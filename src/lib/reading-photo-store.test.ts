import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readReadingPhoto, readingPhotoExists, saveReadingPhoto } from "@/lib/reading-photo-store";
import { isReadingPhotoUrl } from "@/lib/reading-photos";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

async function withDir(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wesetup-reading-photo-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("снимок замера: подкаталог readings, случайное имя, расширение по сигнатуре", async () => {
  await withDir(async (baseDir) => {
    const jpeg = await saveReadingPhoto(JPEG, { baseDir });
    const png = await saveReadingPhoto(PNG, { baseDir });
    assert.ok(jpeg && png);
    assert.ok(isReadingPhotoUrl(jpeg.url), jpeg.url);
    assert.match(jpeg.url, /\.jpg$/);
    assert.match(png.url, /\.png$/);
    assert.notEqual(jpeg.url, png.url);
    assert.equal((await readdir(path.join(baseDir, "readings"))).length, 2);
    assert.equal(await readingPhotoExists(jpeg.url, { baseDir }), true);
    assert.deepEqual(await readReadingPhoto(jpeg.url, { baseDir }), JPEG);
  });
});

test("не картинка под видом фото не сохраняется; чужие и несуществующие ссылки не читаются", async () => {
  await withDir(async (baseDir) => {
    assert.equal(await saveReadingPhoto(new TextEncoder().encode("<script>alert(1)</script>"), { baseDir }), null);
    const missing = `/uploads/readings/${"f0".repeat(16)}.jpg`;
    assert.equal(await readingPhotoExists(missing, { baseDir }), false);
    assert.equal(await readReadingPhoto(missing, { baseDir }), null);
    assert.equal(await readingPhotoExists("/uploads/readings/../../.env", { baseDir }), false);
    assert.equal(await readReadingPhoto("https://evil.example/a.jpg", { baseDir }), null);
  });
});
