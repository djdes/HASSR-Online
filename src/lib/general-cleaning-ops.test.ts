import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GeneralCleaningOpError,
  applyGeneralCleaningOp,
  diffCleaningPlans,
  parseGeneralCleaningOp,
  type GeneralCleaningOp,
  type GeneralCleaningOpContext,
} from "@/lib/general-cleaning-ops";
import { normalizeSanitationDayConfig, type SanitationDayConfig } from "@/lib/sanitation-day-document";

const FRIDAY = 1 << 4;
const TODAY = "2026-09-22";

const ctx: GeneralCleaningOpContext = {
  todayKey: TODAY,
  userId: "u-manager",
  schedules: new Map([["R1", { scheduleType: "weekly", weekdayMask: FRIDAY, monthDays: [] }]]),
};

function base(): SanitationDayConfig {
  return normalizeSanitationDayConfig({
    year: 2026,
    documentDate: "2026-01-01",
    rows: [
      {
        id: "r1",
        roomId: "R1",
        roomName: "Кухня",
        cleanings: [
          { planned: "2026-09-04", done: "2026-09-04", doneSource: "manual" },
          { planned: "2026-09-11", done: null },
          { planned: "2026-10-02", done: null },
        ],
      },
      { id: "r2", roomName: "Склад (без связи)", plan: { sep: "15, ✓" }, fact: { sep: "✓" } },
    ],
  });
}

function run(op: GeneralCleaningOp, config = base()) {
  return applyGeneralCleaningOp(config, op, ctx);
}

function slots(config: SanitationDayConfig, rowId = "r1") {
  return config.rows
    .find((row) => row.id === rowId)!
    .cleanings.map((c) => [c.id, c.done]);
}

describe("addPlanned / removePlanned / movePlanned", () => {
  it("добавить дату в план", () => {
    const result = run({ type: "addPlanned", rowId: "r1", date: "2026-09-25" });
    assert.equal(result.changed, true);
    assert.deepEqual(result.touchedDates, ["2026-09-25"]);
    assert.equal(result.config.rows[0].plan.sep, "04, 11, 25");
    // Повтор — без изменений.
    assert.equal(run({ type: "addPlanned", rowId: "r1", date: "2026-09-11" }).changed, false);
  });

  it("дата вне года документа — ошибка", () => {
    assert.throws(
      () => run({ type: "addPlanned", rowId: "r1", date: "2027-01-08" }),
      GeneralCleaningOpError,
    );
    assert.throws(() => run({ type: "addPlanned", rowId: "nope", date: "2026-09-25" }), /не найдена/);
  });

  it("внеплановая в этот день становится плановой выполненной", () => {
    const withUnplanned = run({ type: "addUnplanned", rowId: "r1", date: "2026-09-20" }).config;
    const result = run({ type: "addPlanned", rowId: "r1", date: "2026-09-20" }, withUnplanned);
    assert.deepEqual(slots(result.config).find(([id]) => id === "p:2026-09-20"), [
      "p:2026-09-20",
      "2026-09-20",
    ]);
    assert.equal(slots(result.config).some(([id]) => id === "u:2026-09-20"), false);
  });

  it("убрать из плана: открытую — совсем, выполненную — в внеплановые или совсем", () => {
    assert.deepEqual(
      slots(run({ type: "removePlanned", rowId: "r1", date: "2026-09-11" }).config),
      [
        ["p:2026-09-04", "2026-09-04"],
        ["p:2026-10-02", null],
      ],
    );
    assert.deepEqual(
      slots(run({ type: "removePlanned", rowId: "r1", date: "2026-09-04" }).config),
      [
        ["u:2026-09-04", "2026-09-04"],
        ["p:2026-09-11", null],
        ["p:2026-10-02", null],
      ],
    );
    assert.deepEqual(
      slots(run({ type: "removePlanned", rowId: "r1", date: "2026-09-04", dropDone: true }).config),
      [
        ["p:2026-09-11", null],
        ["p:2026-10-02", null],
      ],
    );
  });

  it("перенести открытую уборку; выполненную и на занятую дату — нельзя", () => {
    const moved = run({ type: "movePlanned", rowId: "r1", from: "2026-09-11", to: "2026-09-12" });
    assert.deepEqual(moved.touchedDates, ["2026-09-11", "2026-09-12"]);
    assert.equal(moved.config.rows[0].plan.sep, "04, 12");
    assert.throws(
      () => run({ type: "movePlanned", rowId: "r1", from: "2026-09-04", to: "2026-09-05" }),
      /выполнена/,
    );
    assert.throws(
      () => run({ type: "movePlanned", rowId: "r1", from: "2026-09-11", to: "2026-10-02" }),
      /уже в плане/,
    );
  });
});

describe("markDone / unmarkDone", () => {
  it("отметить выполненной — сегодня или раньше, не раньше плана больше чем на неделю", () => {
    const result = run({ type: "markDone", rowId: "r1", date: "2026-09-11", doneDate: "2026-09-12" });
    const slot = result.config.rows[0].cleanings.find((c) => c.id === "p:2026-09-11")!;
    assert.equal(slot.done, "2026-09-12");
    assert.equal(slot.doneBy, "u-manager");
    assert.equal(slot.doneSource, "manual");
    assert.equal(result.config.rows[0].fact.sep, "04, 12");
    assert.throws(
      () => run({ type: "markDone", rowId: "r1", date: "2026-10-02", doneDate: "2026-09-23" }),
      /будущ/,
    );
    assert.throws(
      () => run({ type: "markDone", rowId: "r1", date: "2026-09-11", doneDate: "2026-09-03" }),
      /недел/,
    );
    // Раньше плана в пределах недели — можно; больше недели — нет.
    const with25 = run({ type: "addPlanned", rowId: "r1", date: "2026-09-25" }).config;
    assert.equal(
      run({ type: "markDone", rowId: "r1", date: "2026-09-25", doneDate: "2026-09-22" }, with25).changed,
      true,
    );
    assert.throws(
      () => run({ type: "markDone", rowId: "r1", date: "2026-10-02", doneDate: "2026-09-22" }),
      /недел/,
    );
  });

  it("снять отметку: плановая открывается, внеплановая удаляется", () => {
    assert.deepEqual(
      slots(run({ type: "unmarkDone", rowId: "r1", slotId: "p:2026-09-04" }).config)[0],
      ["p:2026-09-04", null],
    );
    const withUnplanned = run({ type: "addUnplanned", rowId: "r1", date: "2026-09-20" }).config;
    assert.equal(
      slots(run({ type: "unmarkDone", rowId: "r1", slotId: "u:2026-09-20" }, withUnplanned).config).some(
        ([id]) => id === "u:2026-09-20",
      ),
      false,
    );
  });
});

describe("внеплановые уборки", () => {
  it("только сегодня или раньше", () => {
    assert.throws(() => run({ type: "addUnplanned", rowId: "r1", date: "2026-09-23" }), /прошедш/);
  });

  it("в день открытого плана — закрывает его", () => {
    const result = run({ type: "addUnplanned", rowId: "r1", date: "2026-09-11" });
    assert.deepEqual(slots(result.config)[1], ["p:2026-09-11", "2026-09-11"]);
  });

  it("добавить и удалить", () => {
    const added = run({ type: "addUnplanned", rowId: "r1", date: "2026-09-20" });
    assert.equal(added.config.rows[0].fact.sep, "04, 20");
    const removed = run({ type: "removeUnplanned", rowId: "r1", date: "2026-09-20" }, added.config);
    assert.equal(removed.config.rows[0].fact.sep, "04");
  });
});

describe("заметки старых ячеек", () => {
  it("убрать заметку", () => {
    const result = run({ type: "clearLegacyNote", rowId: "r2", month: "sep", kind: "plan" });
    assert.equal(result.config.rows[1].plan.sep, "15");
    assert.deepEqual(result.config.rows[1].legacyNotes, { sep: { fact: "✓" } });
  });

  it("«✓» → отметка датой", () => {
    const result = run({ type: "legacyNoteToDone", rowId: "r2", month: "sep", date: "2026-09-15" });
    assert.equal(result.config.rows[1].fact.sep, "15");
    assert.equal(result.config.rows[1].legacyNotes?.sep?.fact, undefined);
    assert.deepEqual(slots(result.config, "r2"), [["p:2026-09-15", "2026-09-15"]]);
    assert.throws(
      () => run({ type: "legacyNoteToDone", rowId: "r2", month: "sep", date: "2026-10-01" }),
      /месяц/,
    );
  });
});

describe("fillFromSchedule", () => {
  it("fill-empty: пустые месяцы с сегодняшнего дня, строка без связи не трогается", () => {
    const empty = normalizeSanitationDayConfig({
      year: 2026,
      rows: [
        { id: "r1", roomId: "R1", roomName: "Кухня", cleanings: [{ planned: "2026-10-09", done: null }] },
        { id: "r2", roomName: "Без связи", cleanings: [] },
      ],
    });
    const result = run(
      { type: "fillFromSchedule", mode: "fill-empty", fromDate: "2026-01-01" },
      empty,
    );
    // Сентябрь: с сегодня (22.09) — 25-е. Октябрь уже был в плане — не трогаем.
    assert.equal(result.config.rows[0].plan.sep, "25");
    assert.equal(result.config.rows[0].plan.oct, "09");
    assert.equal(result.config.rows[0].plan.nov, "06, 13, 20, 27");
    assert.equal(result.config.rows[0].plan.aug, "-");
    assert.deepEqual(result.config.rows[1].cleanings, []);
  });

  it("фильтры строк и месяцев", () => {
    const empty = normalizeSanitationDayConfig({
      year: 2026,
      rows: [{ id: "r1", roomId: "R1", roomName: "Кухня", cleanings: [] }],
    });
    const result = run(
      { type: "fillFromSchedule", mode: "fill-empty", fromDate: TODAY, rowIds: ["r1"], months: [10] },
      empty,
    );
    assert.equal(result.config.rows[0].plan.nov, "06, 13, 20, 27");
    assert.equal(result.config.rows[0].plan.dec, "-");
    assert.equal(
      run({ type: "fillFromSchedule", mode: "fill-empty", fromDate: TODAY, rowIds: ["zzz"] }, empty).changed,
      false,
    );
  });

  it("replace-future: будущие открытые заменяются, прошлое и отметки — нет", () => {
    const result = run({ type: "fillFromSchedule", mode: "replace-future", fromDate: TODAY, rowIds: ["r1"] });
    const row = result.config.rows[0];
    // 04.09 (выполнена) и 11.09 (просрочена, в прошлом) остаются.
    assert.equal(row.plan.sep, "04, 11, 25");
    assert.equal(row.plan.oct, "02, 09, 16, 23, 30");
    assert.equal(row.cleanings.find((c) => c.id === "p:2026-09-04")!.done, "2026-09-04");
  });
});

describe("shiftYear", () => {
  it("все даты на новый год", () => {
    const result = run({ type: "shiftYear", year: 2027 });
    assert.equal(result.config.year, 2027);
    assert.equal(result.config.rows[0].cleanings[0].planned, "2027-09-04");
    assert.equal(result.config.rows[0].cleanings[0].done, "2027-09-04");
    assert.equal(run({ type: "shiftYear", year: 2026 }).changed, false);
  });
});

describe("diffCleaningPlans и parseGeneralCleaningOp", () => {
  it("что добавится и что уйдёт по строкам", () => {
    const before = base();
    const after = run({ type: "fillFromSchedule", mode: "replace-future", fromDate: TODAY, rowIds: ["r1"] }).config;
    const diff = diffCleaningPlans(before, after);
    assert.deepEqual(diff.get("r1")?.removed, []);
    assert.deepEqual(diff.get("r1")?.added.slice(0, 2), ["2026-09-25", "2026-10-09"]);
    assert.equal(diff.has("r2"), false);
  });

  it("разбор запроса", () => {
    assert.deepEqual(parseGeneralCleaningOp({ type: "addPlanned", rowId: "r1", date: "2026-09-25" }), {
      type: "addPlanned",
      rowId: "r1",
      date: "2026-09-25",
    });
    assert.equal(parseGeneralCleaningOp({ type: "addPlanned", rowId: "r1", date: "25.09" }), null);
    assert.equal(parseGeneralCleaningOp({ type: "hack" }), null);
    assert.deepEqual(
      parseGeneralCleaningOp({ type: "fillFromSchedule", mode: "fill-empty", fromDate: TODAY, months: [8, 99] }),
      null,
    );
  });
});
