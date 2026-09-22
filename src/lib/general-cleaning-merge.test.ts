import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mergeSanitationTaskMarks } from "@/lib/general-cleaning-merge";
import { normalizeSanitationDayConfig } from "@/lib/sanitation-day-document";

const current = normalizeSanitationDayConfig({
  year: 2026,
  rows: [
    {
      id: "r1",
      roomId: "R1",
      roomName: "Кухня",
      cleanings: [
        { planned: "2026-09-04", done: "2026-09-04", doneSource: "manual", doneBy: "m1" },
        { planned: "2026-09-11", done: "2026-09-11", doneSource: "task" },
        { planned: null, done: "2026-09-20", doneSource: "task" },
      ],
    },
    { id: "r2", roomName: "Склад", cleanings: [{ planned: "2026-09-15", done: "2026-09-15", doneSource: "task" }] },
  ],
});

function slots(config: ReturnType<typeof normalizeSanitationDayConfig>, rowId = "r1") {
  return config.rows.find((row) => row.id === rowId)?.cleanings.map((c) => [c.id, c.done, c.doneSource ?? null]);
}

describe("mergeSanitationTaskMarks", () => {
  it("устаревшая вкладка не стирает отметки из задач", () => {
    const stale = normalizeSanitationDayConfig({
      year: 2026,
      rows: [
        {
          id: "r1",
          roomId: "R1",
          roomName: "Кухня (переименована)",
          cleanings: [
            { planned: "2026-09-04", done: null },
            { planned: "2026-09-11", done: null },
          ],
        },
      ],
    });
    const merged = mergeSanitationTaskMarks({ incoming: stale, current });
    assert.equal(merged.rows[0].roomName, "Кухня (переименована)");
    assert.deepEqual(slots(merged), [
      // Ручную отметку устаревшая вкладка сняла — её не возвращаем.
      ["p:2026-09-04", null, null],
      ["p:2026-09-11", "2026-09-11", "task"],
      ["u:2026-09-20", "2026-09-20", "task"],
    ]);
    // Удалённая строка не воскресает.
    assert.equal(merged.rows.some((row) => row.id === "r2"), false);
    assert.equal(merged.rows[0].fact.sep, "11, 20");
  });

  it("убранная старой вкладкой плановая дата с отметкой задачи возвращается", () => {
    const stale = normalizeSanitationDayConfig({
      year: 2026,
      rows: [{ id: "r1", roomId: "R1", roomName: "Кухня", plan: { sep: "04" }, fact: { sep: "04" } }],
    });
    const merged = mergeSanitationTaskMarks({ incoming: stale, current });
    assert.deepEqual(slots(merged), [
      ["p:2026-09-04", "2026-09-04", "manual"],
      ["p:2026-09-11", "2026-09-11", "task"],
      ["u:2026-09-20", "2026-09-20", "task"],
    ]);
  });

  it("другой год — осознанная смена, ничего не подмешиваем", () => {
    const moved = normalizeSanitationDayConfig({
      year: 2027,
      rows: [{ id: "r1", roomId: "R1", roomName: "Кухня", cleanings: [] }],
    });
    const merged = mergeSanitationTaskMarks({ incoming: moved, current });
    assert.equal(merged.year, 2027);
    assert.deepEqual(merged.rows[0].cleanings, []);
  });

  it("совпадающий конфиг не меняется", () => {
    assert.deepEqual(mergeSanitationTaskMarks({ incoming: current, current }), current);
  });

  it("прочие ключи конфига (шапка, дата закрытия) не теряются", () => {
    const merged = mergeSanitationTaskMarks({
      incoming: { ...current, controlPeriodicity: "Ежемесячно", closedAt: "2026-12-31" },
      current,
    }) as unknown as Record<string, unknown>;
    assert.equal(merged.controlPeriodicity, "Ежемесячно");
    assert.equal(merged.closedAt, "2026-12-31");
  });

  it("сырые конфиги тоже принимаются", () => {
    const merged = mergeSanitationTaskMarks({
      incoming: { year: 2026, rows: [{ id: "r2", roomName: "Склад", plan: { sep: "15" }, fact: {} }] },
      current: JSON.parse(JSON.stringify(current)),
    });
    assert.deepEqual(slots(merged, "r2"), [["p:2026-09-15", "2026-09-15", "task"]]);
  });
});
