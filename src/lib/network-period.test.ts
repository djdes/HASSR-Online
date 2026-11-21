import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPeriodDays,
  networkPeriodDays,
  networkPeriodTotals,
  parseNetworkPeriod,
  periodDayKeys,
  periodOrgStats,
  periodPercent,
  periodStatus,
  shiftDayKey,
} from "./network-period";

test("период из адреса: 7 и 30 дней, остальное — «Сегодня»", () => {
  assert.equal(parseNetworkPeriod("7"), "7");
  assert.equal(parseNetworkPeriod("30"), "30");
  assert.equal(parseNetworkPeriod(["30", "7"]), "30");
  for (const raw of [undefined, null, "", "today", "14", "7d", 7]) assert.equal(parseNetworkPeriod(raw), "today");
  assert.equal(networkPeriodDays("7"), 7);
  assert.equal(networkPeriodDays("30"), 30);
  assert.equal(networkPeriodDays("today"), null);
});

test("дни периода — полные дни до сегодняшнего, по возрастанию, через границу месяца", () => {
  assert.equal(shiftDayKey("2026-11-01", -1), "2026-10-31");
  assert.equal(shiftDayKey("2026-12-31", 1), "2027-01-01");
  assert.throws(() => shiftDayKey("21.11.2026", 1));
  const week = periodDayKeys("2026-11-03", 7);
  assert.deepEqual(week, ["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  assert.equal(periodDayKeys("2026-11-21", 30).length, 30);
  assert.equal(periodDayKeys("2026-11-21", 30)[29], "2026-11-20");
  assert.deepEqual(periodDayKeys("2026-11-21", 0), []);
});

const days = periodDayKeys("2026-11-21", 7); // 14..20 ноября

test("сборка дней: обязательные — только с документом на день, записи — все журналы", () => {
  const data = buildPeriodDays({
    dayKeys: days,
    mandatoryTemplateIds: new Set(["hyg", "cold"]),
    documents: [
      { templateId: "hyg", fromKey: "2026-11-01", toKey: "2026-11-30" },
      // Холодильники ведут с 17-го.
      { templateId: "cold", fromKey: "2026-11-17", toKey: "2026-11-30" },
      // Непериодический журнал — не обязательный, хоть документ и есть.
      { templateId: "acc", fromKey: "2026-11-01", toKey: "2026-11-30" },
    ],
    marks: [
      { templateId: "hyg", dayKey: "2026-11-14", count: 3 },
      { templateId: "hyg", dayKey: "2026-11-17", count: 2 },
      { templateId: "cold", dayKey: "2026-11-17", count: 1 },
      { templateId: "acc", dayKey: "2026-11-18", count: 4 },
      // Вне периода и пустые — не считаются.
      { templateId: "hyg", dayKey: "2026-11-21", count: 9 },
      { templateId: "hyg", dayKey: "2026-11-13", count: 9 },
      { templateId: "cold", dayKey: "2026-11-18", count: 0 },
    ],
    closures: [{ templateId: "cold", dayKey: "2026-11-18" }, { templateId: "hyg", dayKey: "2026-11-30" }],
  });
  assert.deepEqual([...(data.mandatoryByDay.get("2026-11-14") ?? [])], ["hyg"]);
  assert.deepEqual([...(data.mandatoryByDay.get("2026-11-17") ?? [])].sort(), ["cold", "hyg"]);
  assert.equal(data.mandatoryByDay.get("2026-11-18")?.has("acc"), false);
  assert.deepEqual([...(data.filledByDay.get("2026-11-18") ?? [])].sort(), ["acc", "cold"]);
  assert.equal(data.recordsByDay.get("2026-11-14"), 3);
  assert.equal(data.recordsByDay.get("2026-11-17"), 3);
  assert.equal(data.recordsByDay.get("2026-11-18"), 4);
  assert.equal(data.recordsByDay.has("2026-11-21"), false);
  assert.equal(data.recordsByDay.has("2026-11-13"), false);

  const stats = periodOrgStats({ dayKeys: days, createdDayKey: "2026-01-01", lockedFromDayKey: null, data });
  // 14: hyg ✓ (cold ещё не вели) — заполнен; 15, 16: hyg ✗; 17: оба ✓; 18: hyg ✗ (cold закрыт); 19, 20: ✗.
  assert.deepEqual(stats, { days: 7, filledDays: 2, keptDays: 7, records: 10 });
  assert.equal(periodStatus(stats), "partial");
  assert.equal(periodPercent(stats), 29);
});

test("дни до создания и после закрытия организации не считаются", () => {
  const data = buildPeriodDays({
    dayKeys: days,
    mandatoryTemplateIds: new Set(["hyg"]),
    documents: [{ templateId: "hyg", fromKey: "2026-11-01", toKey: "2026-11-30" }],
    marks: days.map((dayKey) => ({ templateId: "hyg", dayKey, count: 1 })),
    closures: [],
  });
  // Создана 16-го, закрыта с 19-го: считаются 16, 17, 18.
  const stats = periodOrgStats({ dayKeys: days, createdDayKey: "2026-11-16", lockedFromDayKey: "2026-11-19", data });
  assert.deepEqual(stats, { days: 3, filledDays: 3, keptDays: 3, records: 3 });
  assert.equal(periodStatus(stats), "done");
  assert.equal(periodPercent(stats), 100);
  // Создана сегодня — дней в периоде нет.
  const fresh = periodOrgStats({ dayKeys: days, createdDayKey: "2026-11-21", lockedFromDayKey: null, data });
  assert.deepEqual(fresh, { days: 0, filledDays: 0, keptDays: 0, records: 0 });
  assert.equal(periodStatus(fresh), "empty");
  assert.equal(periodPercent(fresh), null);
});

test("статус: ни одного дня, журналов нет, не удалось посчитать", () => {
  assert.equal(periodStatus({ days: 7, filledDays: 0, keptDays: 7, records: 0 }), "none");
  // Обязательных журналов не было ни в один день — «журналов нет», а не «ни одного дня».
  assert.equal(periodStatus({ days: 7, filledDays: 0, keptDays: 0, records: 5 }), "empty");
  assert.equal(periodStatus(null), "unknown");
  assert.equal(periodPercent(null), null);
});

test("итоги: сумма дней, заполненных дней и записей; несчитанные строки не мешают", () => {
  const totals = networkPeriodTotals([
    { stats: { days: 7, filledDays: 5, keptDays: 7, records: 40 } },
    { stats: { days: 3, filledDays: 3, keptDays: 3, records: 2 } },
    { stats: null },
  ]);
  assert.deepEqual(totals, { organizations: 3, days: 10, filledDays: 8, records: 42 });
  assert.equal(periodPercent(totals), 80);
});
