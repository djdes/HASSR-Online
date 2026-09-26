import assert from "node:assert/strict";
import test from "node:test";

import {
  findClimateRowForEquipment,
  findClimateRowForRoom,
  mergeClimateCorrections,
  mergeClimateMeasurement,
  orgClockMinutes,
  pickNearestControlTime,
} from "@/lib/climate-fill";
import {
  climateCorrectionKey,
  createClimateRoomConfig,
} from "@/lib/climate-document";

// 2026-09-15 07:40 UTC = 10:40 МСК.
const NOW = new Date("2026-09-15T07:40:00.000Z");

test("часы организации, а не процесса", () => {
  assert.equal(orgClockMinutes(NOW, "Europe/Moscow"), 10 * 60 + 40);
  assert.equal(orgClockMinutes(NOW, "Asia/Vladivostok"), 17 * 60 + 40);
  assert.equal(orgClockMinutes(NOW, "Not/AZone"), 7 * 60 + 40);
});

test("ближайший срок контроля; без сроков — текущий час", () => {
  assert.equal(pickNearestControlTime(["10:00", "17:00"], NOW, "Europe/Moscow"), "10:00");
  assert.equal(pickNearestControlTime(["10:00", "17:00"], NOW, "Asia/Vladivostok"), "17:00");
  assert.equal(pickNearestControlTime(["bad", "18:00"], NOW, "Europe/Moscow"), "18:00");
  assert.equal(pickNearestControlTime([], NOW, "Europe/Moscow"), "10:00");
});

const config = {
  rooms: [
    createClimateRoomConfig({ id: "room-r1", roomId: "r1", name: "Склад сухих продуктов" }),
    createClimateRoomConfig({ id: "legacy-row", roomId: "r2", name: "Овощной склад" }),
    createClimateRoomConfig({ id: "room-area-a1", name: "Кондитерский цех" }),
  ],
};

test("строка помещения: по связи со справочником и по стабильному id", () => {
  assert.equal(findClimateRowForRoom(config, "r2")?.id, "legacy-row");
  assert.equal(findClimateRowForRoom(config, "r1")?.id, "room-r1");
  assert.equal(findClimateRowForRoom(config, "missing"), null);
});

test("строка оборудования: цех по areaId, затем по названию (регресс: не id оборудования)", () => {
  assert.equal(findClimateRowForEquipment(config, { areaId: "a1" })?.id, "room-area-a1");
  assert.equal(findClimateRowForEquipment(config, { areaId: "zz", areaName: " кондитерский ЦЕХ " })?.id, "room-area-a1");
  assert.equal(findClimateRowForEquipment(config, { areaId: "zz", areaName: "Нет такого" }), null);
});

test("слияние: соседние помещения и сроки сохраняются, неприсланная метрика не обнуляется", () => {
  const existing = {
    responsibleTitle: "Повар",
    corrections: { "room-r1:10:00:temperature": "Проветрили" },
    measurements: {
      "room-r1": { "10:00": { temperature: 20, humidity: 50 }, "17:00": { temperature: 21, humidity: 55 } },
      "legacy-row": { "10:00": { temperature: 15, humidity: 70 } },
    },
  };
  const merged = mergeClimateMeasurement(existing, "room-r1", "10:00", { humidity: 60 }) as typeof existing;
  assert.deepEqual(merged.measurements["room-r1"]["10:00"], { temperature: 20, humidity: 60 });
  assert.deepEqual(merged.measurements["room-r1"]["17:00"], { temperature: 21, humidity: 55 });
  assert.deepEqual(merged.measurements["legacy-row"], existing.measurements["legacy-row"]);
  assert.equal(merged.responsibleTitle, "Повар");
  assert.deepEqual(merged.corrections, existing.corrections);

  const fresh = mergeClimateMeasurement(null, "room-r1", "17:00", { temperature: 19 }) as typeof existing;
  assert.deepEqual(fresh.measurements["room-r1"]["17:00"], { temperature: 19, humidity: null });
});

test("комментарий к отклонению: пишется в corrections, соседние не трогает", () => {
  type Entry = {
    measurements: Record<string, Record<string, { temperature: number; humidity: number }>>;
    corrections: Record<string, string>;
  };
  const existing: Entry = {
    measurements: { "room-r1": { "10:00": { temperature: 30, humidity: 50 } } },
    corrections: { "room-r1:17:00:temperature": "Проветрили вечером" },
  };
  const key = climateCorrectionKey("room-r1", "10:00", "temperature");
  const merged = mergeClimateCorrections(existing, { [key]: "  Сообщил руководителю  " }) as Entry;
  assert.equal(merged.corrections[key], "Сообщил руководителю");
  assert.equal(merged.corrections["room-r1:17:00:temperature"], "Проветрили вечером");
  assert.deepEqual(merged.measurements, existing.measurements);

  // Пустой текст ничего не стирает и не добавляет.
  const untouched = mergeClimateCorrections(existing, { [key]: "   " }) as typeof existing;
  assert.deepEqual(untouched.corrections, existing.corrections);

  // Записи ещё нет — corrections создаются с нуля.
  const fresh = mergeClimateCorrections(null, { [key]: "Вызвал мастера" }) as typeof existing;
  assert.deepEqual(fresh.corrections, { [key]: "Вызвал мастера" });
});

test("фото замера склада: ключ как у комментария, новое заменяет, без ссылки ничего не меняется", async () => {
  const { mergeClimateReadingPhoto, mergeClimateMeasurement } = await import("@/lib/climate-fill");
  const { climateCorrectionKey } = await import("@/lib/climate-document");
  const photo = `/uploads/readings/${"a1".repeat(16)}.jpg`;
  const retake = `/uploads/readings/${"b2".repeat(16)}.webp`;
  const key = climateCorrectionKey("room-1", "10:00", "temperature");
  const measured = mergeClimateMeasurement({ responsibleTitle: "Кладовщик", corrections: { x: "y" } }, "room-1", "10:00", { temperature: 18 });
  const withPhoto = mergeClimateReadingPhoto(measured, key, photo);
  assert.deepEqual(withPhoto.readingPhotos, { [key]: photo });
  assert.equal(withPhoto.responsibleTitle, "Кладовщик");
  assert.deepEqual(withPhoto.corrections, { x: "y" });
  assert.deepEqual((withPhoto.measurements as Record<string, unknown>)["room-1"], { "10:00": { temperature: 18, humidity: null } });
  const other = mergeClimateReadingPhoto(withPhoto, climateCorrectionKey("room-2", "10:00", "temperature"), retake);
  assert.deepEqual(Object.keys(other.readingPhotos as object).sort(), [key, "room-2:10:00:temperature"].sort());
  assert.deepEqual(mergeClimateReadingPhoto(withPhoto, key, retake).readingPhotos, { [key]: retake });
  assert.equal(mergeClimateReadingPhoto(withPhoto, key, null), withPhoto);
  assert.equal(mergeClimateReadingPhoto(withPhoto, key, "https://evil.example/a.jpg"), withPhoto);
});
