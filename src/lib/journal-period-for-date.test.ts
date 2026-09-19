import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveJournalPeriodForDate } from "@/lib/journal-period";

/**
 * Два десятка окон создания слали `dateTo = dateFrom` — однодневный
 * документ независимо от вида периода журнала. У годовых журналов он
 * пересекался с документом ночного крона (01.01–31.12).
 */
describe("resolveJournalPeriodForDate", () => {
  it("годовой журнал: любая дата года → весь год", () => {
    assert.deepEqual(resolveJournalPeriodForDate("pest_control", "2026-09-19"), {
      dateFrom: "2026-01-01",
      dateTo: "2026-12-31",
    });
    assert.deepEqual(
      resolveJournalPeriodForDate("accident_journal", "2026-03-02"),
      { dateFrom: "2026-01-01", dateTo: "2026-12-31" }
    );
    assert.deepEqual(
      resolveJournalPeriodForDate("ppe_issuance", "2027-12-31"),
      { dateFrom: "2027-01-01", dateTo: "2027-12-31" }
    );
    assert.deepEqual(
      resolveJournalPeriodForDate("breakdown_history", "2026-09-19"),
      { dateFrom: "2026-01-01", dateTo: "2026-12-31" }
    );
  });

  it("месячный журнал: середина месяца → месяц целиком", () => {
    assert.deepEqual(
      resolveJournalPeriodForDate("metal_impurity", "2026-02-17"),
      { dateFrom: "2026-02-01", dateTo: "2026-02-28" }
    );
  });

  it("полумесячный журнал: вторая половина", () => {
    assert.deepEqual(resolveJournalPeriodForDate("hygiene", "2026-09-19"), {
      dateFrom: "2026-09-16",
      dateTo: "2026-09-30",
    });
  });

  it("бессрочный журнал: с выбранного дня и без конца", () => {
    assert.deepEqual(
      resolveJournalPeriodForDate("intensive_cooling", "2026-09-19"),
      { dateFrom: "2026-09-19", dateTo: "2099-12-31" }
    );
  });

  it("per-org override побеждает дефолт журнала", () => {
    assert.deepEqual(
      resolveJournalPeriodForDate("pest_control", "2026-09-19", {
        pest_control: { kind: "monthly" },
      }),
      { dateFrom: "2026-09-01", dateTo: "2026-09-30" }
    );
  });

  it("мусор вместо даты не роняет окно создания", () => {
    const got = resolveJournalPeriodForDate("pest_control", "не дата");
    assert.match(got.dateFrom, /^\d{4}-01-01$/);
    assert.match(got.dateTo, /^\d{4}-12-31$/);
  });
});
