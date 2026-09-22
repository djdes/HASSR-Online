import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeGeneralSchedule,
  roomGeneralSchedule,
  scheduledDatesInMonth,
  scheduledDatesInRange,
  type RoomGeneralSchedule,
} from "@/lib/general-cleaning-schedule";

const FRIDAY = 1 << 4; // bit 0 = Пн
const weeklyFriday: RoomGeneralSchedule = {
  scheduleType: "weekly",
  weekdayMask: FRIDAY,
  monthDays: [],
};

describe("roomGeneralSchedule", () => {
  it("еженедельный график из маски", () => {
    assert.deepEqual(
      roomGeneralSchedule({ generalScheduleType: "weekly", generalDays: FRIDAY }),
      weeklyFriday,
    );
  });

  it("пустая маска / пустые числа — графика нет", () => {
    assert.equal(roomGeneralSchedule({ generalScheduleType: "weekly", generalDays: 0 }), null);
    assert.equal(
      roomGeneralSchedule({ generalScheduleType: "monthly", generalMonthDays: [] }),
      null,
    );
    assert.equal(roomGeneralSchedule(null), null);
    assert.equal(roomGeneralSchedule({}), null);
  });

  it("числа месяца чистятся, сортируются, «last» — в конце", () => {
    assert.deepEqual(
      roomGeneralSchedule({
        generalScheduleType: "monthly",
        generalMonthDays: ["15", "1", "last", "x", "32", "15", 7],
      }),
      { scheduleType: "monthly", weekdayMask: 0, monthDays: ["1", "15", "last"] },
    );
  });
});

describe("scheduledDatesInMonth", () => {
  it("каждую пятницу сентября 2026", () => {
    assert.deepEqual(scheduledDatesInMonth(weeklyFriday, 2026, 8), [
      "2026-09-04",
      "2026-09-11",
      "2026-09-18",
      "2026-09-25",
    ]);
  });

  it("1, 15 и последний день февраля", () => {
    const s: RoomGeneralSchedule = {
      scheduleType: "monthly",
      weekdayMask: 0,
      monthDays: ["1", "15", "last"],
    };
    assert.deepEqual(scheduledDatesInMonth(s, 2026, 1), [
      "2026-02-01",
      "2026-02-15",
      "2026-02-28",
    ]);
  });

  it("несуществующие числа пропускаются, совпадения схлопываются", () => {
    const s31: RoomGeneralSchedule = { scheduleType: "monthly", weekdayMask: 0, monthDays: ["31"] };
    assert.deepEqual(scheduledDatesInMonth(s31, 2026, 8), []);
    const s30: RoomGeneralSchedule = {
      scheduleType: "monthly",
      weekdayMask: 0,
      monthDays: ["30", "last"],
    };
    assert.deepEqual(scheduledDatesInMonth(s30, 2026, 8), ["2026-09-30"]);
  });
});

describe("scheduledDatesInRange", () => {
  it("границы включительно, через месяц", () => {
    assert.deepEqual(scheduledDatesInRange(weeklyFriday, "2026-09-22", "2026-10-09"), [
      "2026-09-25",
      "2026-10-02",
      "2026-10-09",
    ]);
  });

  it("через новый год", () => {
    assert.deepEqual(scheduledDatesInRange(weeklyFriday, "2026-12-26", "2027-01-08"), [
      "2027-01-01",
      "2027-01-08",
    ]);
  });

  it("пустой или перевёрнутый диапазон", () => {
    assert.deepEqual(scheduledDatesInRange(weeklyFriday, "2026-10-01", "2026-09-01"), []);
    assert.deepEqual(scheduledDatesInRange(weeklyFriday, "bad", "2026-09-01"), []);
  });
});

describe("describeGeneralSchedule", () => {
  it("один день недели — «каждую пятницу»", () => {
    assert.equal(describeGeneralSchedule(weeklyFriday), "каждую пятницу");
    assert.equal(
      describeGeneralSchedule({ scheduleType: "weekly", weekdayMask: 1, monthDays: [] }),
      "каждый понедельник",
    );
    assert.equal(
      describeGeneralSchedule({ scheduleType: "weekly", weekdayMask: 64, monthDays: [] }),
      "каждое воскресенье",
    );
  });

  it("несколько дней недели", () => {
    assert.equal(
      describeGeneralSchedule({ scheduleType: "weekly", weekdayMask: 1 | FRIDAY, monthDays: [] }),
      "каждую неделю: Пн, Пт",
    );
    assert.equal(
      describeGeneralSchedule({ scheduleType: "weekly", weekdayMask: 127, monthDays: [] }),
      "ежедневно",
    );
  });

  it("числа месяца", () => {
    const d = (monthDays: string[]) =>
      describeGeneralSchedule({ scheduleType: "monthly", weekdayMask: 0, monthDays });
    assert.equal(d(["1", "15", "last"]), "1 и 15 числа, последний день месяца");
    assert.equal(d(["15"]), "15 числа");
    assert.equal(d(["last"]), "последний день месяца");
    assert.equal(d(["1", "10", "20"]), "1, 10 и 20 числа");
  });
});
