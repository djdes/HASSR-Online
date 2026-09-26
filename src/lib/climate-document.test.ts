import assert from "node:assert/strict";
import test from "node:test";

import { countClimateTimeValues } from "@/lib/climate-document";

test("считаем, сколько замеров потеряется при удалении времени контроля", () => {
  // Явный тип: без него TS выводит объединение литералов и не принимает массив.
  const entries: Parameters<typeof countClimateTimeValues>[0] = [
    {
      data: {
        measurements: {
          "room-1": {
            "10:00": { temperature: 21, humidity: 55 },
            "17:00": { temperature: 22, humidity: null },
          },
          "room-2": {
            "17:00": { temperature: null, humidity: 60 },
          },
        },
      },
    },
    {
      data: {
        measurements: {
          "room-1": { "10:00": { temperature: 20, humidity: 50 } },
        },
      },
    },
  ];

  // 17:00 — температура room-1 и влажность room-2.
  assert.equal(countClimateTimeValues(entries, "17:00"), 2);
  // 10:00 — по два значения в каждом из двух дней.
  assert.equal(countClimateTimeValues(entries, "10:00"), 4);
  // Времени нет ни в одном дне — терять нечего, подтверждение это покажет.
  assert.equal(countClimateTimeValues(entries, "08:00"), 0);
  assert.equal(countClimateTimeValues([], "10:00"), 0);
  // Пустой день не ломает подсчёт.
  assert.equal(countClimateTimeValues([{ data: {} }], "10:00"), 0);
});

test("фото замеров склада: переживают normalize/sync/merge, переезжают со временем контроля, чужие ссылки отбрасываются", async () => {
  const {
    createClimateRoomConfig,
    mergeClimateEntryData,
    normalizeClimateEntryData,
    renameClimateControlTimes,
    syncClimateEntryDataWithConfig,
  } = await import("@/lib/climate-document");
  const photo = `/uploads/readings/${"a1".repeat(16)}.jpg`;
  const raw = {
    responsibleTitle: null,
    measurements: { "room-1": { "10:00": { temperature: 18, humidity: 50 } } },
    readingPhotos: { "room-1:10:00:temperature": photo, "room-1:10:00:humidity": "https://evil.example/a.jpg" },
  };
  const data = normalizeClimateEntryData(JSON.parse(JSON.stringify(raw)));
  assert.deepEqual(data.readingPhotos, { "room-1:10:00:temperature": photo });
  assert.equal("readingPhotos" in normalizeClimateEntryData({ measurements: {} }), false);

  const config = {
    rooms: [createClimateRoomConfig({ id: "room-1", name: "Склад" })],
    controlTimes: ["10:00"],
    skipWeekends: false,
  };
  const synced = syncClimateEntryDataWithConfig(data, config);
  assert.deepEqual(synced.readingPhotos, { "room-1:10:00:temperature": photo });

  const merged = mergeClimateEntryData(synced, { ...synced, readingPhotos: { "room-1:10:00:humidity": photo } });
  assert.deepEqual(merged.readingPhotos, { "room-1:10:00:temperature": photo });

  const renamed = renameClimateControlTimes(synced, { "10:00": "09:30" });
  assert.deepEqual(renamed.readingPhotos, { "room-1:09:30:temperature": photo });
  assert.equal(renamed.measurements["room-1"]["09:30"]?.temperature, 18);
});
