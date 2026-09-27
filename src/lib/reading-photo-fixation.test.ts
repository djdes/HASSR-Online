import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_READING_PHOTO_SETTINGS,
  READING_PHOTO_FIXATION_TEXT,
  READING_PHOTO_REQUIRED_CODE,
  applyReadingPhotoPatch,
  initialReadingEntry,
  isBlankReading,
  isDefaultReadingPhotoSettings,
  isReadingPhotoMissing,
  parseReadingPhotoSettings,
  readingFormView,
  readingPhotoSettingKey,
  resolveReadingPhotoForSave,
  serializeReadingPhotoSettings,
  type ReadingPhotoSettings,
} from "@/lib/reading-photo-fixation";

const ON: ReadingPhotoSettings = { enabled: true, required: false };
const OFF: ReadingPhotoSettings = { enabled: false, required: false };
const REQUIRED: ReadingPhotoSettings = { enabled: true, required: true };
const PHOTO = `/uploads/readings/${"a1".repeat(16)}.jpg`;

test("настройка: по умолчанию фотофиксация включена, фото не обязательно; ключ — своей организации", () => {
  assert.deepEqual(DEFAULT_READING_PHOTO_SETTINGS, ON);
  assert.equal(readingPhotoSettingKey("org_1"), "org-reading-photo:org_1");
  assert.notEqual(readingPhotoSettingKey("org_1"), readingPhotoSettingKey("org_2"));
  assert.throws(() => readingPhotoSettingKey(""));
});

test("настройка: строка из базы, объект, мусор; «обязательно» без «включено» не бывает", () => {
  assert.deepEqual(parseReadingPhotoSettings(null), ON);
  assert.deepEqual(parseReadingPhotoSettings(""), ON);
  assert.deepEqual(parseReadingPhotoSettings("не json"), ON);
  assert.deepEqual(parseReadingPhotoSettings("[1,2]"), ON);
  assert.deepEqual(parseReadingPhotoSettings('{"enabled":false}'), OFF);
  assert.deepEqual(parseReadingPhotoSettings('{"enabled":true,"required":true}'), REQUIRED);
  assert.deepEqual(parseReadingPhotoSettings({ enabled: false, required: true }), OFF);
  assert.deepEqual(parseReadingPhotoSettings({ enabled: "no", required: "yes" }), ON);
  // Туда и обратно.
  for (const settings of [ON, OFF, REQUIRED]) {
    assert.deepEqual(parseReadingPhotoSettings(serializeReadingPhotoSettings(settings)), settings);
  }
  assert.equal(isDefaultReadingPhotoSettings(ON), true);
  assert.equal(isDefaultReadingPhotoSettings(OFF), false);
  assert.equal(isDefaultReadingPhotoSettings(REQUIRED), false);
});

test("настройка: выключил фотофиксацию — «обязательно» снимается; включил «обязательно» — фотофиксация включается", () => {
  assert.deepEqual(applyReadingPhotoPatch(REQUIRED, { enabled: false }), OFF);
  assert.deepEqual(applyReadingPhotoPatch(OFF, { required: true }), REQUIRED);
  assert.deepEqual(applyReadingPhotoPatch(REQUIRED, { required: false }), ON);
  assert.deepEqual(applyReadingPhotoPatch(OFF, { enabled: true }), ON);
  assert.deepEqual(applyReadingPhotoPatch(ON, {}), ON);
  assert.deepEqual(applyReadingPhotoPatch(OFF, { enabled: true, required: true }), REQUIRED);
  assert.deepEqual(applyReadingPhotoPatch(ON, { enabled: false, required: true }), REQUIRED);
});

test("сохранение замера: фото обязательно — без снимка отказ 400, с фото и «обсл/рем» — можно", () => {
  const refused = resolveReadingPhotoForSave({ settings: REQUIRED, hasReading: true, photo: null });
  assert.deepEqual(refused, {
    ok: false,
    status: 400,
    code: READING_PHOTO_REQUIRED_CODE,
    error: READING_PHOTO_FIXATION_TEXT.requiredError,
  });
  assert.equal(resolveReadingPhotoForSave({ settings: REQUIRED, hasReading: true, photo: "" }).ok, false);
  assert.deepEqual(resolveReadingPhotoForSave({ settings: REQUIRED, hasReading: true, photo: PHOTO }), { ok: true, photo: PHOTO, ignored: false });
  // «Обслуживание/Ремонт» и одна влажность — показания температуры нет, фото не нужно и не прикладывается.
  assert.deepEqual(resolveReadingPhotoForSave({ settings: REQUIRED, hasReading: false, photo: null }), { ok: true, photo: null, ignored: false });
  assert.deepEqual(resolveReadingPhotoForSave({ settings: REQUIRED, hasReading: false, photo: PHOTO }), { ok: true, photo: null, ignored: false });
});

test("сохранение замера: фотофиксация выключена — присланное фото не прикладываем, замер не ломается", () => {
  assert.deepEqual(resolveReadingPhotoForSave({ settings: OFF, hasReading: true, photo: PHOTO }), { ok: true, photo: null, ignored: true });
  assert.deepEqual(resolveReadingPhotoForSave({ settings: OFF, hasReading: true, photo: null }), { ok: true, photo: null, ignored: false });
  // Включена, не обязательна — как раньше: с фото и без.
  assert.deepEqual(resolveReadingPhotoForSave({ settings: ON, hasReading: true, photo: PHOTO }), { ok: true, photo: PHOTO, ignored: false });
  assert.deepEqual(resolveReadingPhotoForSave({ settings: ON, hasReading: true, photo: null }), { ok: true, photo: null, ignored: false });
});

test("форма: значения нет — начинаем со снимка; есть значение или фотофиксация выключена — сразу поле", () => {
  assert.equal(isBlankReading(""), true);
  assert.equal(isBlankReading(" - "), true);
  assert.equal(isBlankReading("4"), false);
  assert.equal(initialReadingEntry(ON, ""), "photo");
  assert.equal(initialReadingEntry(ON, "-"), "photo");
  assert.equal(initialReadingEntry(ON, "3.5"), "manual");
  assert.equal(initialReadingEntry(OFF, ""), "manual");
});

test("форма: главная кнопка → ждём распознавание без поля → поле с числом и «Сохранить»", () => {
  const base = { settings: ON, entry: "photo" as const, photoUrl: null, value: "", status: false };
  // Снимка нет — только «Сфотографируйте показание» (и «Ввести вручную»), без поля и «Сохранить».
  assert.deepEqual(readingFormView({ ...base, phase: "idle" }), { photoFirst: true, showField: false, showSave: false });
  // Загружаем и распознаём — карточка фото, поля ещё нет.
  assert.deepEqual(readingFormView({ ...base, phase: "busy", photoUrl: PHOTO }), { photoFirst: false, showField: false, showSave: false });
  // Распознали — число в поле.
  assert.deepEqual(readingFormView({ ...base, phase: "done", photoUrl: PHOTO, value: "8.4" }), { photoFirst: false, showField: true, showSave: true });
  // Не разобрали / бесплатный тариф — фото есть, поле пустое для ручного ввода.
  assert.deepEqual(readingFormView({ ...base, phase: "done", photoUrl: PHOTO }), { photoFirst: false, showField: true, showSave: true });
  // Фото восстановлено из черновика — поле сразу.
  assert.deepEqual(readingFormView({ ...base, phase: "idle", photoUrl: PHOTO }), { photoFirst: false, showField: true, showSave: true });
  // Перевели на ручной ввод или фотофиксация выключена — обычная форма.
  assert.deepEqual(readingFormView({ ...base, entry: "manual", phase: "idle" }), { photoFirst: false, showField: true, showSave: true });
  assert.deepEqual(readingFormView({ ...base, settings: OFF, phase: "idle" }), { photoFirst: false, showField: true, showSave: true });
  // «Обслуживание/Ремонт» — поля нет, «Сохранить» есть.
  assert.deepEqual(readingFormView({ ...base, phase: "idle", status: true }), { photoFirst: false, showField: false, showSave: true });
});

test("форма: «Фото обязательно» — без снимка к температуре «Сохранить» неактивна", () => {
  assert.equal(isReadingPhotoMissing({ settings: REQUIRED, hasReading: true, photoUrl: null }), true);
  assert.equal(isReadingPhotoMissing({ settings: REQUIRED, hasReading: true, photoUrl: PHOTO }), false);
  assert.equal(isReadingPhotoMissing({ settings: REQUIRED, hasReading: false, photoUrl: null }), false);
  assert.equal(isReadingPhotoMissing({ settings: ON, hasReading: true, photoUrl: null }), false);
  assert.equal(isReadingPhotoMissing({ settings: OFF, hasReading: true, photoUrl: null }), false);
});
