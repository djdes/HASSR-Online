import assert from "node:assert/strict";
import test from "node:test";
import { presentDocumentTitle } from "./journal-document-presentation";
import { buildDocumentAutoTitle, formatJournalPeriodLabel } from "@/lib/journal-document-title";

test("only exact generated journal titles are localized, including their period", () => {
  const input = {
    templateCode: "glass_items_list", sourceNames: ["Перечень изделий", "Перечень изделий из стекла и хрупкого пластика"],
    localizedName: "Glass inventory", dateFrom: "2026-10-01", dateTo: "2026-10-31",
    locale: "en" as const, formatTitle: (name: string, period: string) => `${name} — ${period}`,
  };
  const saved = buildDocumentAutoTitle({ ...input, journalName: input.sourceNames[1] });
  assert.equal(presentDocumentTitle({ ...input, title: saved }), "Glass inventory — 2026");
  assert.equal(presentDocumentTitle({ ...input, title: "Перечень изделий" }), "Glass inventory");
  for (const title of ["Мой журнал O‘tkir", `${saved} (особый)`, "  Перечень изделий  "]) {
    assert.equal(presentDocumentTitle({ ...input, title }), title);
  }
  assert.equal(presentDocumentTitle({ ...input, title: saved, locale: "ru" }), saved);
});

test("localized periods preserve calendar dates, month/year boundaries and Russian storage formatting", () => {
  assert.equal(formatJournalPeriodLabel("2026-10-01", "2026-10-31"), "октябрь 2026");
  assert.equal(formatJournalPeriodLabel("2026-10-01", "2026-10-31", "en"), "October 2026");
  assert.equal(formatJournalPeriodLabel("2026-10-01", "2026-10-31", "uz"), "oktabr, 2026");
  assert.match(formatJournalPeriodLabel("2026-12-31", "2027-01-01", "en"), /31 December 2026.*1 January 2027/);
  assert.equal(formatJournalPeriodLabel("invalid", "2026-10-31", "uz"), "");
});
