import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSanitationDayConfigFromRooms,
  cleaningStatus,
  copySanitationRowToYear,
  createEmptySanitationRow,
  getSanitationDayDefaultConfig,
  monthCleanings,
  monthFactMarks,
  normalizeSanitationDayConfig,
  parseMonthCellTokens,
  projectMonthCell,
  reconcileRowCleanings,
  reprojectSanitationRow,
  sanitationScheduleFromKey,
  shiftCleaningsToYear,
  summarizeCleanings,
  type SanitationCleaning,
  type SanitationDayConfig,
} from "@/lib/sanitation-day-document";

const FRIDAY = 1 << 4;

function config(rows: unknown[], year = 2026): SanitationDayConfig {
  return normalizeSanitationDayConfig({ year, documentDate: `${year}-01-01`, rows });
}

describe("parseMonthCellTokens", () => {
  it("числа через запятую, точку с запятой и пробел", () => {
    assert.deepEqual(parseMonthCellTokens("10, 17; 24", 2026, 3), { days: [10, 17, 24], notes: "" });
    assert.deepEqual(parseMonthCellTokens("4 11 18", 2026, 8), { days: [4, 11, 18], notes: "" });
    assert.deepEqual(parseMonthCellTokens("01", 2026, 8), { days: [1], notes: "" });
  });

  it("ДД.ММ(.ГГГГ) своего месяца — дата, чужого — заметка", () => {
    assert.deepEqual(parseMonthCellTokens("05.09, 12.09.2026", 2026, 8), { days: [5, 12], notes: "" });
    assert.deepEqual(parseMonthCellTokens("15.10", 2026, 8), { days: [], notes: "15.10" });
    assert.deepEqual(parseMonthCellTokens("05.09.2025", 2026, 8), { days: [], notes: "05.09.2025" });
  });

  it("пусто, прочерки и нераспознанное", () => {
    assert.deepEqual(parseMonthCellTokens("-", 2026, 8), { days: [], notes: "" });
    assert.deepEqual(parseMonthCellTokens("  ", 2026, 8), { days: [], notes: "" });
    assert.deepEqual(parseMonthCellTokens("—", 2026, 8), { days: [], notes: "" });
    assert.deepEqual(parseMonthCellTokens("✓", 2026, 8), { days: [], notes: "✓" });
    assert.deepEqual(parseMonthCellTokens("10 (перенос), по графику", 2026, 8), {
      days: [],
      notes: "10 (перенос), по графику",
    });
    // 31 сентября не бывает.
    assert.deepEqual(parseMonthCellTokens("31", 2026, 8), { days: [], notes: "31" });
  });
});

describe("projectMonthCell", () => {
  const cleanings: SanitationCleaning[] = [
    { id: "p:2026-09-04", planned: "2026-09-04", done: "2026-09-04" },
    { id: "p:2026-09-11", planned: "2026-09-11", done: null },
    { id: "u:2026-09-20", planned: null, done: "2026-09-20" },
  ];

  it("план — две цифры через запятую, факт — дни выполнения", () => {
    assert.equal(projectMonthCell(cleanings, undefined, 2026, 8, "plan"), "04, 11");
    assert.equal(projectMonthCell(cleanings, undefined, 2026, 8, "fact"), "04, 20");
    assert.equal(projectMonthCell(cleanings, undefined, 2026, 9, "plan"), "-");
  });

  it("заметка старой ячейки дописывается в конец", () => {
    assert.equal(
      projectMonthCell(cleanings, { sep: { fact: "✓" } }, 2026, 8, "fact"),
      "04, 20, ✓",
    );
    assert.equal(projectMonthCell([], { sep: { plan: "по графику" } }, 2026, 8, "plan"), "по графику");
  });

  it("выполнение в другом году — ДД.ММ в месяце плана", () => {
    const late: SanitationCleaning[] = [
      { id: "p:2026-12-31", planned: "2026-12-31", done: "2027-01-02" },
    ];
    assert.equal(projectMonthCell(late, undefined, 2026, 11, "fact"), "02.01");
  });
});

describe("старый формат → уборки (ленивая миграция)", () => {
  it("строки плана и факта превращаются в уборки", () => {
    const cfg = config([
      {
        id: "r1",
        roomName: "Кухня",
        plan: { sep: "04, 11" },
        fact: { sep: "04" },
      },
    ]);
    assert.deepEqual(cfg.rows[0].cleanings, [
      { id: "p:2026-09-04", planned: "2026-09-04", done: "2026-09-04", doneSource: "manual" },
      { id: "p:2026-09-11", planned: "2026-09-11", done: null },
    ]);
    assert.equal(cfg.rows[0].plan.sep, "04, 11");
    assert.equal(cfg.rows[0].fact.sep, "04");
    assert.equal(cfg.rows[0].plan.jan, "-");
  });

  it("факт спаривается: тот же день → ±3 дня → внеплановая", () => {
    const cfg = config([
      {
        id: "r1",
        roomName: "Кухня",
        plan: { sep: "10, 24" },
        fact: { sep: "09, 10, 16" },
      },
    ]);
    // 10 — в тот же день; 09 — рядом с 10, но 10 уже занят, 24 далеко →
    // внеплановая; 16 — ни одного плана в ±3 дня → внеплановая.
    assert.deepEqual(
      cfg.rows[0].cleanings.map((c) => [c.id, c.done]),
      [
        ["u:2026-09-09", "2026-09-09"],
        ["p:2026-09-10", "2026-09-10"],
        ["u:2026-09-16", "2026-09-16"],
        ["p:2026-09-24", null],
      ],
    );
  });

  it("факт в пределах трёх дней закрывает ближайший план", () => {
    const cfg = config([
      { id: "r1", roomName: "Кухня", plan: { sep: "10, 24" }, fact: { sep: "12" } },
    ]);
    assert.deepEqual(
      cfg.rows[0].cleanings.map((c) => [c.id, c.done]),
      [
        ["p:2026-09-10", "2026-09-12"],
        ["p:2026-09-24", null],
      ],
    );
    assert.equal(cfg.rows[0].fact.sep, "12");
  });

  it("нераспознанный текст сохраняется заметкой и печатается", () => {
    const cfg = config([
      { id: "r1", roomName: "Кухня", plan: { sep: "10, по графику" }, fact: { sep: "✓" } },
    ]);
    assert.deepEqual(cfg.rows[0].legacyNotes, { sep: { plan: "по графику", fact: "✓" } });
    assert.equal(cfg.rows[0].plan.sep, "10, по графику");
    assert.equal(cfg.rows[0].fact.sep, "✓");
  });

  it("нормализация идемпотентна", () => {
    const once = config([
      { id: "r1", roomId: "R1", roomName: "Кухня", plan: { sep: "10, 24", apr: "10, 17, 24" }, fact: { sep: "12", feb: "✓" } },
      { id: "r2", roomName: "Склад", plan: { jan: "1" }, fact: {} },
    ]);
    const twice = normalizeSanitationDayConfig(once);
    assert.deepEqual(twice, once);
    assert.deepEqual(normalizeSanitationDayConfig(JSON.parse(JSON.stringify(once))), once);
  });

  it("roomId сохраняется, у строки без связи его нет", () => {
    const cfg = config([
      { id: "a", roomId: "R1", roomName: "x" },
      { id: "b", roomName: "y" },
    ]);
    assert.equal(cfg.rows[0].roomId, "R1");
    assert.equal("roomId" in cfg.rows[1], false);
  });

  it("заглушка по умолчанию тоже в новом формате", () => {
    const stub = getSanitationDayDefaultConfig(new Date("2026-03-05T00:00:00Z"));
    assert.equal(stub.rows[0].plan.apr, "10, 17, 24");
    assert.ok(stub.rows[0].cleanings.some((c) => c.planned === "2026-04-17"));
  });
});

describe("уборки — источник правды, строки — проекция", () => {
  const v2Row = {
    id: "r1",
    roomId: "R1",
    roomName: "Кухня",
    cleanings: [
      { id: "p:2026-09-04", planned: "2026-09-04", done: "2026-09-05", doneBy: "u1", doneSource: "task" },
      { id: "p:2026-09-11", planned: "2026-09-11", done: null },
    ],
  };

  it("без строк plan/fact уборки не трогаются, проекция считается", () => {
    const cfg = config([v2Row]);
    assert.deepEqual(cfg.rows[0].cleanings, v2Row.cleanings);
    assert.equal(cfg.rows[0].plan.sep, "04, 11");
    assert.equal(cfg.rows[0].fact.sep, "05");
  });

  it("правка строки плана со стороны (старая вкладка) — побеждает строка, отметки живут", () => {
    const base = config([v2Row]).rows[0];
    const edited = config([{ ...base, plan: { ...base.plan, sep: "04, 18" } }]);
    assert.deepEqual(edited.rows[0].cleanings, [
      { id: "p:2026-09-04", planned: "2026-09-04", done: "2026-09-05", doneBy: "u1", doneSource: "task" },
      { id: "p:2026-09-18", planned: "2026-09-18", done: null },
    ]);
  });

  it("убрали из плана выполненную дату — отметка переезжает к ближайшему плану", () => {
    const base = config([v2Row]).rows[0];
    const edited = config([{ ...base, plan: { ...base.plan, sep: "07, 11" } }]);
    // 04 ушёл из плана; факт 05 ближе всего к новому 07 (2 дня).
    assert.deepEqual(
      edited.rows[0].cleanings.map((c) => [c.id, c.done, c.doneBy ?? null]),
      [
        ["p:2026-09-07", "2026-09-05", "u1"],
        ["p:2026-09-11", null, null],
      ],
    );
  });

  it("правка строки факта: убрали день — отметка снята, добавили — внеплановая", () => {
    const base = config([v2Row]).rows[0];
    const cleared = config([{ ...base, fact: { ...base.fact, sep: "-" } }]);
    assert.deepEqual(
      cleared.rows[0].cleanings.map((c) => [c.id, c.done]),
      [
        ["p:2026-09-04", null],
        ["p:2026-09-11", null],
      ],
    );
    const added = config([{ ...base, fact: { ...base.fact, sep: "05, 20" } }]);
    assert.deepEqual(
      added.rows[0].cleanings.map((c) => [c.id, c.done, c.doneSource ?? null]),
      [
        ["p:2026-09-04", "2026-09-05", "task"],
        ["p:2026-09-11", null, null],
        ["u:2026-09-20", "2026-09-20", "manual"],
      ],
    );
  });

  it("внеплановая в день открытого плана сливается с ним", () => {
    const cfg = config([
      {
        id: "r1",
        roomName: "Кухня",
        cleanings: [
          { id: "p:2026-09-11", planned: "2026-09-11", done: null },
          { id: "u:2026-09-11", planned: null, done: "2026-09-11", doneBy: "u2", doneSource: "manual" },
        ],
      },
    ]);
    assert.deepEqual(cfg.rows[0].cleanings, [
      { id: "p:2026-09-11", planned: "2026-09-11", done: "2026-09-11", doneBy: "u2", doneSource: "manual" },
    ]);
  });

  it("мусор и повторы отбрасываются, порядок — по дате", () => {
    const cfg = config([
      {
        id: "r1",
        roomName: "Кухня",
        cleanings: [
          { planned: "2026-09-18", done: null },
          { planned: "2026-02-30", done: null },
          "junk",
          { planned: null, done: null },
          { planned: "2026-09-04", done: null },
          { planned: "2026-09-04", done: "2026-09-04" },
        ],
      },
    ]);
    assert.deepEqual(
      cfg.rows[0].cleanings.map((c) => [c.id, c.done]),
      [
        ["p:2026-09-04", "2026-09-04"],
        ["p:2026-09-18", null],
      ],
    );
  });

  it("уборки чужого года переносятся в год документа (числа и месяцы те же)", () => {
    const cfg = config(
      [
        {
          id: "r1",
          roomName: "Кухня",
          cleanings: [{ planned: "2025-09-04", done: "2025-09-05" }],
        },
      ],
      2026,
    );
    assert.deepEqual(
      cfg.rows[0].cleanings.map((c) => [c.planned, c.done]),
      [["2026-09-04", "2026-09-05"]],
    );
  });
});

describe("shiftCleaningsToYear", () => {
  const cfg = config([
    {
      id: "r1",
      roomName: "Кухня",
      cleanings: [
        { planned: "2028-02-29", done: "2028-02-29", doneSource: "manual" },
        { planned: "2028-09-11", done: null },
        { planned: null, done: "2028-09-20", doneSource: "manual" },
      ],
      legacyNotes: { oct: { plan: "по графику", fact: "✓" } },
    },
  ], 2028);

  it("с отметками: все даты в новый год, 29 февраля → 28", () => {
    const shifted = shiftCleaningsToYear(cfg, 2029);
    assert.equal(shifted.year, 2029);
    assert.deepEqual(
      shifted.rows[0].cleanings.map((c) => [c.planned, c.done]),
      [
        ["2029-02-28", "2029-02-28"],
        ["2029-09-11", null],
        [null, "2029-09-20"],
      ],
    );
    assert.deepEqual(shifted.rows[0].legacyNotes, { oct: { plan: "по графику", fact: "✓" } });
    assert.equal(shifted.rows[0].plan.feb, "28");
  });

  it("без факта: только план, заметки факта убраны", () => {
    const shifted = shiftCleaningsToYear(cfg, 2029, { keepFacts: false });
    assert.deepEqual(
      shifted.rows[0].cleanings.map((c) => [c.planned, c.done]),
      [
        ["2029-02-28", null],
        ["2029-09-11", null],
      ],
    );
    assert.deepEqual(shifted.rows[0].legacyNotes, { oct: { plan: "по графику" } });
    assert.equal(shifted.rows[0].fact.feb, "-");
    assert.equal(shifted.rows[0].fact.oct, "-");
    // Результат устойчив к повторной нормализации.
    assert.deepEqual(normalizeSanitationDayConfig(shifted), shifted);
  });

  it("копия строки на новый год", () => {
    const row = copySanitationRowToYear(cfg.rows[0], 2028, 2029);
    assert.deepEqual(
      row.cleanings.map((c) => c.planned),
      ["2029-02-28", "2029-09-11"],
    );
    assert.ok(row.cleanings.every((c) => c.done === null));
  });
});

describe("сидирование из графика помещения", () => {
  const rooms = [
    { id: "R1", name: "Кухня", generalScheduleType: "weekly", generalDays: FRIDAY, generalMonthDays: [] },
    { id: "R2", name: "Склад", generalScheduleType: "monthly", generalDays: 0, generalMonthDays: [] },
  ];

  it("с сегодняшнего дня до конца года", () => {
    const cfg = buildSanitationDayConfigFromRooms(rooms, new Date("2026-01-01T00:00:00Z"), {
      fromKey: "2026-12-10",
    });
    assert.deepEqual(
      cfg.rows[0].cleanings.map((c) => c.planned),
      ["2026-12-11", "2026-12-18", "2026-12-25"],
    );
    assert.equal(cfg.rows[0].plan.dec, "11, 18, 25");
    // Без графика — пустая строка.
    assert.deepEqual(cfg.rows[1].cleanings, []);
  });

  it("документ следующего года — весь год", () => {
    const cfg = buildSanitationDayConfigFromRooms(rooms, new Date("2027-01-01T00:00:00Z"), {
      fromKey: "2026-09-22",
    });
    assert.equal(cfg.year, 2027);
    assert.equal(cfg.rows[0].cleanings[0].planned, "2027-01-01");
    assert.equal(cfg.rows[0].cleanings.length, 53);
  });

  it("новая строка помещения", () => {
    const row = createEmptySanitationRow(
      "Кухня",
      "R1",
      { scheduleType: "weekly", weekdayMask: FRIDAY, monthDays: [] },
      "2026-12-20",
    );
    assert.equal(row.id, "row-room-R1");
    assert.deepEqual(row.cleanings.map((c) => c.planned), ["2026-12-25"]);
    assert.equal(createEmptySanitationRow("Без графика").cleanings.length, 0);
  });

  it("с какой даты сеять план для года документа", () => {
    assert.equal(sanitationScheduleFromKey(2026, "2026-09-22"), "2026-09-22");
    assert.equal(sanitationScheduleFromKey(2027, "2026-09-22"), "2027-01-01");
    assert.equal(sanitationScheduleFromKey(2025, "2026-09-22"), null);
  });
});

describe("разбор по месяцам и сводки", () => {
  const row = config([
    {
      id: "r1",
      roomName: "Кухня",
      cleanings: [
        { planned: "2026-09-04", done: "2026-09-04" },
        { planned: "2026-09-11", done: null },
        { planned: "2026-09-25", done: null },
        { planned: null, done: "2026-09-20" },
        { planned: "2026-10-02", done: null },
      ],
    },
  ]).rows[0];

  it("monthCleanings", () => {
    const sep = monthCleanings(row, 8);
    assert.deepEqual(sep.planned.map((c) => c.planned), ["2026-09-04", "2026-09-11", "2026-09-25"]);
    assert.deepEqual(sep.unplanned.map((c) => c.done), ["2026-09-20"]);
    assert.deepEqual(sep.done.map((c) => c.done), ["2026-09-04", "2026-09-20"]);
    assert.equal(monthCleanings(row, 8, 2027).planned.length, 0);
  });

  it("monthFactMarks — как на бланке, включая выполнение в другом году", () => {
    assert.deepEqual(
      monthFactMarks(row, 2026, 8).map((m) => m.label),
      ["04", "20"],
    );
    const late = config([
      { id: "r1", roomName: "Кухня", cleanings: [{ planned: "2026-12-31", done: "2027-01-02" }] },
    ]).rows[0];
    assert.deepEqual(monthFactMarks(late, 2026, 11).map((m) => m.label), ["02.01"]);
    assert.deepEqual(monthFactMarks(late, 2026, 0), []);
  });

  it("статус уборки на сегодня", () => {
    const [done, overdue, future] = monthCleanings(row, 8).planned;
    assert.equal(cleaningStatus(done, "2026-09-22"), "done");
    assert.equal(cleaningStatus(overdue, "2026-09-22"), "overdue");
    assert.equal(cleaningStatus(future, "2026-09-22"), "planned");
    assert.equal(cleaningStatus(future, "2026-09-25"), "today");
  });

  it("сводка по строке", () => {
    assert.deepEqual(summarizeCleanings(row.cleanings, "2026-09-22"), {
      planned: 4,
      done: 2,
      overdue: 1,
      unplanned: 1,
    });
  });

  it("reconcile без правок возвращает то же", () => {
    const again = reconcileRowCleanings(row, 2026);
    assert.deepEqual(again.cleanings, row.cleanings);
  });

  it("reprojectSanitationRow пересчитывает строки после правки уборок", () => {
    const next = reprojectSanitationRow(
      { ...row, cleanings: [...row.cleanings, { id: "p:2026-09-30", planned: "2026-09-30", done: null }] },
      2026,
    );
    assert.equal(next.plan.sep, "04, 11, 25, 30");
  });
});
