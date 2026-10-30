import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";

import { WORDMARK_INK, WORDMARK_RATIO } from "./logo";

test("поля знака в WORDMARK_INK совпадают с файлом", async () => {
  const image = await loadImage(join(process.cwd(), "public", "brand", "wordmark.png"));
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, image.width, image.height);
  let left = image.width;
  let right = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (data[(y * image.width + x) * 4 + 3] < 32) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
  }
  // Пропорция файла — та, по которой считается ширина знака.
  assert.ok(Math.abs(image.width / image.height - WORDMARK_RATIO) < 0.01);
  // Поля — с точностью до пикселя файла.
  assert.ok(Math.abs(left / image.width - WORDMARK_INK.left) <= 1 / image.width, `left ${left}`);
  assert.ok(Math.abs((image.width - right - 1) / image.width - WORDMARK_INK.right) <= 1 / image.width, `right ${right}`);
});
