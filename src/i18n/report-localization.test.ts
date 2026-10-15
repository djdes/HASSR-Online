import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveExportLocale } from "./export-locale";
import { loadMessages } from "./messages";
import { presentJournalField } from "./journal-presentation";
import { buildReportTable, formatReportDateTime, formatReportDay, formatReportValue, parseReportDate } from "../lib/report-export";

test("export date validation rejects ambiguous, impossible and timestamp dates before querying", () => {
  assert.equal(parseReportDate("2024-02-29"), Date.parse("2024-02-29T00:00:00Z"));
  for (const input of ["2025-02-29", "2026-02-30", "2026-13-01", "2026-00-01", "2026-10-00", "2026-1-2", "10/14/2026", "2026-10-14T00:00:00Z", "", "0000-01-01"]) {
    assert.equal(parseReportDate(input), null, input);
  }
});

test("export overrides are explicit and invalid values never silently switch language", () => {
  assert.equal(resolveExportLocale(null, { locale: "uz", organizationLocale: "en" }), "uz");
  assert.equal(resolveExportLocale("en", { locale: "uz" }), "en");
  assert.equal(resolveExportLocale(undefined, { organizationLocale: "en" }), "en");
  assert.equal(resolveExportLocale(null, {}), "ru");
  for (const value of ["", "en-US", "__proto__", {}, 1]) assert.equal(resolveExportLocale(value, { locale: "uz" }), null);
});

test("report presentation translates fixed fields and options without changing recorded values or people", async () => {
  const record = Object.freeze({ decision: "accepted", quantity: 1.25, comment: "Заказ клиента", checked: true });
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const decision = presentJournalField({ key: "decision", label: "Решение", options: [{ value: "accepted", label: "Принято" }] }, messages.journalFields.incoming_control.decision);
    const table = buildReportTable({
      fields: [{ ...decision, label: decision.displayLabel, options: decision.displayOptions }, { key: "quantity", label: messages.journalFields.incoming_control.quantity.label }],
      documentEntries: [{ date: new Date("2026-10-14T00:00:00Z"), employeeName: "Азиза", data: record }],
      timeZone: "Asia/Tashkent", locale,
      copy: { ...messages.reports, yes: messages.common.yes, no: messages.common.no },
    });
    assert.equal(table.headers[0], messages.reports.date);
    assert.equal(table.rows[0][1], "Азиза");
    assert.equal(table.rows[0][2], messages.journalFields.incoming_control.decision.options.accepted);
    assert.ok(table.rows[0].includes("Заказ клиента"));
    assert.ok(table.rows[0].includes(messages.common.yes));
    assert.equal(record.decision, "accepted");
    assert.equal(record.quantity, 1.25);
  }
});

test("report locale changes formatting without changing timezone, calendar day or small quantities", () => {
  const timestamp = new Date("2026-10-13T21:30:00Z");
  for (const locale of ["ru", "en", "uz"] as const) {
    assert.match(formatReportDateTime(timestamp, "Asia/Tashkent", locale), /14/);
    assert.match(formatReportDateTime(timestamp, "UTC", locale), /13/);
    assert.match(formatReportDay(new Date("2026-10-14T00:00:00Z"), locale), /14/);
  }
  assert.equal(formatReportValue(1.25, undefined, { locale: "en" }), "1.25");
  assert.equal(Number(formatReportValue(1e-25, undefined, { locale: "en" })), 1e-25);
});
