import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  batchEvents,
  calendarWindow,
  calibrationEvents,
  capaEvents,
  competencyEvents,
  inWindow,
  medBookEvents,
  subscriptionEvents,
} from "@/lib/calendar/sources";

const now = new Date("2026-09-10T09:00:00.000Z");
const window = calendarWindow(now);

describe("calendarWindow", () => {
  it("месяц назад и год вперёд", () => {
    assert.deepEqual(window, { from: "2026-08-11", to: "2027-09-10" });
    assert.equal(inWindow("2026-08-10", window), false);
    assert.equal(inWindow("2027-09-10", window), true);
  });
});

describe("subscriptionEvents / competencyEvents / capaEvents / batchEvents", () => {
  it("подписка — одно событие с датой окончания, вне окна — ничего", () => {
    const [ev] = subscriptionEvents({ name: "Кафе", subscriptionEnd: new Date("2026-10-01T00:00:00Z") }, window);
    assert.equal(ev.date, "2026-10-01");
    assert.equal(ev.kind, "subscription");
    assert.deepEqual(subscriptionEvents({ name: "Кафе", subscriptionEnd: new Date("2020-01-01") }, window), []);
    assert.deepEqual(subscriptionEvents({ name: "Кафе", subscriptionEnd: null }, window), []);
  });
  it("допуски с именем сотрудника", () => {
    const [ev] = competencyEvents([{ id: "c1", skill: "ХАССП", expiresAt: new Date("2026-12-01"), userName: "Иванова" }], window);
    assert.equal(ev.title, "Истекает допуск: ХАССП — Иванова");
    assert.equal(ev.uid, "competency-c1");
  });
  it("CAPA: закрытые не попадают", () => {
    const rows = [
      { id: "a", title: "Течь", dueDate: new Date("2026-09-20"), status: "open", priority: "high" },
      { id: "b", title: "Готово", dueDate: new Date("2026-09-21"), status: "closed", priority: "low" },
    ];
    assert.deepEqual(capaEvents(rows, window).map((e) => e.uid), ["capa-a"]);
  });
  it("партии: списанные не попадают", () => {
    const rows = [
      { id: "p1", code: "B-1", productName: "Молоко", expiryDate: new Date("2026-09-12"), status: "received" },
      { id: "p2", code: "B-2", productName: "Сыр", expiryDate: new Date("2026-09-13"), status: "written_off" },
    ];
    const evs = batchEvents(rows, window);
    assert.equal(evs.length, 1);
    assert.equal(evs[0].title, "Срок годности: Молоко (B-1)");
  });
});

describe("medBookEvents", () => {
  it("по одному событию на медосмотр со сроком и на сделанную прививку", () => {
    const entries = [
      {
        id: "e1",
        employeeName: "Петров",
        data: {
          positionTitle: "Повар",
          examinations: { Терапевт: { date: "2026-03-01", expiryDate: "2027-03-01" }, Флюорография: { date: null, expiryDate: null } },
          vaccinations: { Гепатит: { type: "done", expiryDate: "2026-11-05" }, Корь: { type: "refusal", expiryDate: "2026-11-06" } },
        },
      },
    ];
    const evs = medBookEvents(entries, window);
    assert.deepEqual(
      evs.map((e) => [e.date, e.title]),
      [
        ["2027-03-01", "Медкнижка: Петров — Терапевт"],
        ["2026-11-05", "Прививка: Петров — Гепатит"],
      ]
    );
    assert.equal(new Set(evs.map((e) => e.uid)).size, 2);
  });
});

describe("calibrationEvents", () => {
  it("следующая поверка = последняя + интервал", () => {
    const docs = [
      {
        id: "d1",
        config: {
          rows: [
            { id: "r1", equipmentName: "Термометр", equipmentNumber: "T-1", lastCalibrationDate: "2026-01-15", calibrationInterval: 12, location: "Кухня" },
            { id: "r2", equipmentName: "Весы", lastCalibrationDate: "", calibrationInterval: 12 },
          ],
        },
      },
    ];
    const evs = calibrationEvents(docs, window);
    assert.equal(evs.length, 1);
    assert.equal(evs[0].date, "2027-01-15");
    assert.equal(evs[0].title, "Поверка: Термометр (T-1)");
    assert.match(evs[0].description ?? "", /Где: Кухня/);
  });
  it("технический код вместо номера (хвост id) в название не попадает", () => {
    const docs = [
      {
        id: "d2",
        config: {
          rows: [
            { id: "r3", sourceEquipmentId: "cmabcdefuiylzrud", equipmentName: "Холодильник", equipmentNumber: "UIYLZRUD", lastCalibrationDate: "2026-01-15", calibrationInterval: 12 },
            { id: "r4", equipmentName: "Весы", equipmentNumber: "GYGXJC", lastCalibrationDate: "2026-01-15", calibrationInterval: 12 },
          ],
        },
      },
    ];
    const titles = calibrationEvents(docs, window).map((e) => e.title);
    assert.deepEqual(titles, ["Поверка: Холодильник", "Поверка: Весы"]);
  });
});
