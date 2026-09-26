import assert from "node:assert/strict";
import test from "node:test";

import {
  READING_PHOTO_TEXT,
  TARIFFS_HREF,
  acceptRecognizedReading,
  formatRecognizedReading,
  isReadingMetric,
  isReadingPhotoUrl,
  normalizeReadingPhotos,
  readingPhotoPathSegments,
  withReadingPhoto,
} from "@/lib/reading-photos";

const OK_URL = `/uploads/readings/${"a1".repeat(16)}.jpg`;
const OK_URL_2 = `/uploads/readings/${"b2".repeat(16)}.webp`;

test("ссылка на фото замера: только наш каталог, 32 hex и jpg/png/webp", () => {
  assert.equal(isReadingPhotoUrl(OK_URL), true);
  assert.equal(isReadingPhotoUrl(OK_URL_2), true);
  assert.equal(isReadingPhotoUrl(`/uploads/readings/${"c3".repeat(16)}.png`), true);
  for (const bad of [
    "javascript:alert(1)",
    "https://evil.example/x.jpg",
    `//evil.example/uploads/readings/${"a1".repeat(16)}.jpg`,
    `/uploads/readings/../../.env`,
    `/uploads/readings/${"A1".repeat(16)}.jpg`,
    `/uploads/readings/${"a1".repeat(15)}.jpg`,
    `/uploads/readings/${"a1".repeat(16)}.gif`,
    `/uploads/readings/${"a1".repeat(16)}.jpg?x=1`,
    `/uploads/${"a1".repeat(16)}.jpg`,
    `/uploads/signatures/${"a1".repeat(16)}.jpg`,
    "",
    null,
    42,
  ]) {
    assert.equal(isReadingPhotoUrl(bad), false, String(bad));
  }
  assert.deepEqual(readingPhotoPathSegments(OK_URL), ["readings", `${"a1".repeat(16)}.jpg`]);
  assert.equal(readingPhotoPathSegments("/uploads/../x.jpg"), null);
});

test("карта фото из сырых данных: чужие ссылки и мусор отбрасываются, пустая — undefined", () => {
  assert.deepEqual(
    normalizeReadingPhotos({ fridge: OK_URL, "fridge#2": "javascript:alert(1)", freezer: 5, [`${"x".repeat(250)}`]: OK_URL_2 }),
    { fridge: OK_URL }
  );
  assert.equal(normalizeReadingPhotos({ fridge: "https://evil.example/a.jpg" }), undefined);
  assert.equal(normalizeReadingPhotos([OK_URL]), undefined);
  assert.equal(normalizeReadingPhotos(null), undefined);
  assert.equal(normalizeReadingPhotos("x"), undefined);
});

test("фото к замеру: новое заменяет прежнее, без ссылки ничего не стирается", () => {
  const first = withReadingPhoto(undefined, "fridge", OK_URL);
  assert.deepEqual(first, { fridge: OK_URL });
  const replaced = withReadingPhoto(first, "fridge", OK_URL_2);
  assert.deepEqual(replaced, { fridge: OK_URL_2 });
  assert.deepEqual(first, { fridge: OK_URL }, "исходная карта не меняется");
  assert.equal(withReadingPhoto(first, "fridge", null), first);
  assert.equal(withReadingPhoto(first, "fridge", undefined), first);
  assert.equal(withReadingPhoto(first, "fridge", "https://evil.example/a.jpg"), first);
  assert.equal(withReadingPhoto(first, "", OK_URL_2), first);
  assert.deepEqual(withReadingPhoto(first, "freezer", OK_URL_2), { fridge: OK_URL, freezer: OK_URL_2 });
});

test("распознанное число в поле: только своя единица и правдоподобное значение, иначе — пусто", () => {
  assert.equal(acceptRecognizedReading({ value: -18.5, unit: "C" }, "temperature"), -18.5);
  assert.equal(acceptRecognizedReading({ value: 4.5, unit: null }, "temperature"), 4.5);
  // Влажность с термогигрометра в поле температуры — не подставляем.
  assert.equal(acceptRecognizedReading({ value: 45, unit: "%" }, "temperature"), null);
  assert.equal(acceptRecognizedReading({ value: 1200, unit: "h" }, "temperature"), null);
  // «450» вместо «4.5» — ошибка чтения, а не мороз/жара.
  assert.equal(acceptRecognizedReading({ value: 450, unit: "C" }, "temperature"), null);
  assert.equal(acceptRecognizedReading({ value: -61, unit: null }, "temperature"), null);
  assert.equal(acceptRecognizedReading({ value: 55, unit: "%" }, "humidity"), 55);
  assert.equal(acceptRecognizedReading({ value: 22.5, unit: "C" }, "humidity"), null);
  assert.equal(acceptRecognizedReading({ value: 101, unit: "%" }, "humidity"), null);
  // Нечитаемое остаётся нечитаемым.
  assert.equal(acceptRecognizedReading({ value: null, unit: null }, "temperature"), null);
  assert.equal(acceptRecognizedReading(null, "temperature"), null);
  assert.equal(acceptRecognizedReading({ value: Number.NaN, unit: "C" }, "temperature"), null);
});

test("число для поля и тексты подсказок", () => {
  assert.equal(formatRecognizedReading(-18.5), "-18.5");
  assert.equal(formatRecognizedReading(4.500000001), "4.5");
  assert.equal(formatRecognizedReading(-0), "0");
  assert.equal(formatRecognizedReading(3), "3");
  assert.equal(isReadingMetric("temperature"), true);
  assert.equal(isReadingMetric("humidity"), true);
  assert.equal(isReadingMetric("hours"), false);
  assert.equal(READING_PHOTO_TEXT.paidOnly, "Автоввод с фото — на платном тарифе");
  assert.equal(READING_PHOTO_TEXT.unreadable, "Не разобрали цифры — введите вручную");
  assert.equal(READING_PHOTO_TEXT.checkMark, "с фото — проверьте");
  assert.equal(TARIFFS_HREF, "/settings/subscription");
});
