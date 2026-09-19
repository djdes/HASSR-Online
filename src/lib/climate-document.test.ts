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
