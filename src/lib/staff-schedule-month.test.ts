import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  clampOffset,
  formatDayLong,
  monthDates,
  monthLabel,
  monthOf,
  scheduleDateWindow,
  shiftMonth,
} from "@/lib/staff-schedule-month";

describe("monthDates", () => {
  it("отдаёт все дни месяца от первого до последнего", () => {
    const days = monthDates({ year: 2026, month: 9 }); // октябрь
    assert.equal(days.length, 31);
    assert.equal(days[0], "2026-10-01");
    assert.equal(days[30], "2026-10-31");
  });

  it("знает про короткие месяцы", () => {
    assert.equal(monthDates({ year: 2026, month: 10 }).length, 30); // ноябрь
    assert.equal(monthDates({ year: 2026, month: 1 }).length, 28); // февраль
  });

  it("знает про високосный февраль", () => {
    const feb = monthDates({ year: 2028, month: 1 });
    assert.equal(feb.length, 29);
    assert.equal(feb[28], "2028-02-29");
  });
});

describe("shiftMonth", () => {
  it("переходит через год вперёд и назад", () => {
    assert.deepEqual(shiftMonth({ year: 2026, month: 11 }, 1), { year: 2027, month: 0 });
    assert.deepEqual(shiftMonth({ year: 2026, month: 0 }, -1), { year: 2025, month: 11 });
  });

  it("нулевой сдвиг ничего не меняет", () => {
    assert.deepEqual(shiftMonth({ year: 2026, month: 5 }, 0), { year: 2026, month: 5 });
  });

  it("шагает больше чем на год", () => {
    assert.deepEqual(shiftMonth({ year: 2026, month: 3 }, 14), { year: 2027, month: 5 });
  });
});

describe("monthOf", () => {
  it("берёт месяц даты в UTC", () => {
    assert.deepEqual(monthOf(new Date("2026-09-11T21:30:00Z")), { year: 2026, month: 8 });
  });
});

describe("monthLabel и formatDayLong", () => {
  it("подписывает месяц по-русски", () => {
    assert.equal(monthLabel({ year: 2026, month: 9 }), "Октябрь 2026");
    assert.equal(monthLabel({ year: 2027, month: 0 }), "Январь 2027");
  });

  it("подписывает день в родительном падеже", () => {
    assert.equal(formatDayLong("2026-10-01"), "1 октября 2026");
    assert.equal(formatDayLong("2026-03-08"), "8 марта 2026");
  });
});

describe("clampOffset", () => {
  it("держит перемотку в пределах года в обе стороны", () => {
    assert.equal(clampOffset(99), 12);
    assert.equal(clampOffset(-99), -12);
    assert.equal(clampOffset(3), 3);
  });

  it("не пропускает мусор", () => {
    assert.equal(clampOffset(Number.NaN), 0);
    assert.equal(clampOffset(1.7), 1);
  });
});

describe("scheduleDateWindow", () => {
  it("покрывает всё, что можно открыть перемоткой, с месяцем запаса", () => {
    const { from, to } = scheduleDateWindow(new Date("2026-11-23T10:00:00Z"));
    // Перемотка — с ноября 2025 по ноябрь 2027; запас — октябрь 2025 и декабрь 2027.
    assert.equal(from.toISOString(), "2025-10-01T00:00:00.000Z");
    assert.equal(to.toISOString(), "2028-01-01T00:00:00.000Z");
    for (const offset of [-12, 0, 12]) {
      const days = monthDates(shiftMonth(monthOf(new Date("2026-11-23T10:00:00Z")), offset));
      const first = new Date(`${days[0]}T00:00:00Z`);
      const last = new Date(`${days[days.length - 1]}T00:00:00Z`);
      assert.ok(first >= from && last < to, `месяц со сдвигом ${offset} внутри окна`);
    }
  });

  it("считает в UTC через границу года", () => {
    const { from, to } = scheduleDateWindow(new Date("2027-01-01T00:30:00Z"));
    assert.equal(from.toISOString(), "2025-12-01T00:00:00.000Z");
    assert.equal(to.toISOString(), "2028-03-01T00:00:00.000Z");
  });
});
