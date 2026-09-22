import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MONTH_NAMES_RU,
  MONTH_NAMES_RU_GENITIVE,
  WEEKDAY_FULL_RU,
  WEEKDAY_SHORT_RU,
  buildDayOptions,
  clampDay,
  daysInMonth,
  formatDayMonth,
  formatDayMonthWeekday,
  indexFromScrollTop,
  isoDate,
  nearestEnabledIndex,
  parseIsoDate,
  weekdayIndex,
  wheelSteps,
} from "@/lib/wheel-date";

describe("календарные мелочи", () => {
  it("названия месяцев и дней недели", () => {
    assert.equal(MONTH_NAMES_RU.length, 12);
    assert.equal(MONTH_NAMES_RU[8], "Сентябрь");
    assert.equal(MONTH_NAMES_RU_GENITIVE[8], "сентября");
    // JS-порядок: 0 — воскресенье.
    assert.equal(WEEKDAY_SHORT_RU[5], "пт");
    assert.equal(WEEKDAY_FULL_RU[0], "воскресенье");
  });

  it("дней в месяце, високосный февраль", () => {
    assert.equal(daysInMonth(2026, 1), 28);
    assert.equal(daysInMonth(2028, 1), 29);
    assert.equal(daysInMonth(2026, 8), 30);
    assert.equal(daysInMonth(2026, 11), 31);
  });

  it("день подрезается под месяц", () => {
    assert.equal(clampDay(2026, 1, 31), 28);
    assert.equal(clampDay(2026, 0, 0), 1);
    assert.equal(clampDay(2026, 3, 15), 15);
  });

  it("ISO-дата и разбор обратно", () => {
    assert.equal(isoDate(2026, 8, 5), "2026-09-05");
    assert.deepEqual(parseIsoDate("2026-09-05"), { year: 2026, monthIndex: 8, day: 5 });
    assert.equal(parseIsoDate("2026-02-30"), null);
    assert.equal(parseIsoDate("25.09.2026"), null);
  });

  it("день недели и короткие подписи", () => {
    assert.equal(weekdayIndex("2026-09-25"), 5); // пятница
    assert.equal(formatDayMonth("2026-09-25"), "25.09");
    assert.equal(formatDayMonthWeekday("2026-09-25"), "25.09 (пт)");
  });
});

describe("buildDayOptions", () => {
  it("дни месяца с днём недели и выходными", () => {
    const options = buildDayOptions(2026, 8);
    assert.equal(options.length, 30);
    const friday = options[24];
    assert.deepEqual(friday, {
      value: 25,
      label: "25",
      hint: "пт",
      tone: undefined,
      disabled: false,
      marked: false,
      note: undefined,
    });
    assert.equal(options[25].tone, "weekend"); // сб 26
    assert.equal(options[26].tone, "weekend"); // вс 27
  });

  it("отмеченные дни и дни «в плане»", () => {
    const options = buildDayOptions(2026, 8, {
      markedDays: [4, 25],
      disabledDays: [11],
      disabledNote: "в плане",
    });
    assert.equal(options[3].marked, true);
    assert.equal(options[24].marked, true);
    assert.equal(options[10].disabled, true);
    assert.equal(options[10].note, "в плане");
  });

  it("maxDate закрывает дни после себя", () => {
    const options = buildDayOptions(2026, 8, { maxDate: "2026-09-22" });
    assert.equal(options[21].disabled, false);
    assert.equal(options[22].disabled, true);
    assert.equal(options[29].disabled, true);
    // maxDate в следующем месяце — открыто всё, в прошлом — ничего.
    assert.ok(buildDayOptions(2026, 8, { maxDate: "2026-10-01" }).every((o) => !o.disabled));
    assert.ok(buildDayOptions(2026, 8, { maxDate: "2026-08-31" }).every((o) => o.disabled));
  });

  it("minDate закрывает дни до себя", () => {
    const options = buildDayOptions(2026, 8, { minDate: "2026-09-10" });
    assert.equal(options[8].disabled, true);
    assert.equal(options[9].disabled, false);
  });
});

describe("wheelSteps — колесо мыши и тачпад", () => {
  it("щелчок колеса — ровно одна строка", () => {
    assert.deepEqual(wheelSteps(0, 100, 0, 40), { steps: 1, acc: 0 });
    assert.deepEqual(wheelSteps(0, -120, 0, 40), { steps: -1, acc: 0 });
    // Firefox: строки, а не пиксели.
    assert.deepEqual(wheelSteps(0, 3, 1, 40), { steps: 1, acc: 0 });
  });

  it("тачпад накапливает мелкие сдвиги", () => {
    let state = wheelSteps(0, 15, 0, 40);
    assert.deepEqual(state, { steps: 0, acc: 15 });
    state = wheelSteps(state.acc, 15, 0, 40);
    assert.deepEqual(state, { steps: 0, acc: 30 });
    state = wheelSteps(state.acc, 15, 0, 40);
    assert.deepEqual(state, { steps: 1, acc: 5 });
  });

  it("смена направления сбрасывает накопленное", () => {
    assert.deepEqual(wheelSteps(30, -10, 0, 40), { steps: 0, acc: -10 });
  });

  it("нулевой сдвиг ничего не меняет", () => {
    assert.deepEqual(wheelSteps(12, 0, 0, 40), { steps: 0, acc: 12 });
  });
});

describe("indexFromScrollTop", () => {
  it("округляет к ближайшей строке и держит границы", () => {
    assert.equal(indexFromScrollTop(0, 40, 5), 0);
    assert.equal(indexFromScrollTop(19, 40, 5), 0);
    assert.equal(indexFromScrollTop(21, 40, 5), 1);
    assert.equal(indexFromScrollTop(1000, 40, 5), 4);
    assert.equal(indexFromScrollTop(-30, 40, 5), 0);
    assert.equal(indexFromScrollTop(10, 40, 0), 0);
  });
});

describe("nearestEnabledIndex", () => {
  const opts = [
    { disabled: true },
    { disabled: false },
    { disabled: true },
    { disabled: true },
    { disabled: false },
  ];

  it("доступная строка остаётся", () => {
    assert.equal(nearestEnabledIndex(opts, 1), 1);
  });

  it("ближайшая доступная; при равенстве — меньшая", () => {
    assert.equal(nearestEnabledIndex(opts, 2), 1);
    assert.equal(nearestEnabledIndex(opts, 3), 4);
    assert.equal(nearestEnabledIndex(opts, 0), 1);
  });

  it("направление: сначала по ходу движения", () => {
    assert.equal(nearestEnabledIndex(opts, 2, 1), 4);
    assert.equal(nearestEnabledIndex(opts, 3, -1), 1);
    // По ходу нет — разворачиваемся.
    assert.equal(nearestEnabledIndex([{ disabled: false }, { disabled: true }], 1, 1), 0);
  });

  it("всё закрыто — -1", () => {
    assert.equal(nearestEnabledIndex([{ disabled: true }], 0), -1);
    assert.equal(nearestEnabledIndex([], 0), -1);
  });
});
