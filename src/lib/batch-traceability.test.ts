import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { loadMessages } from "@/i18n/messages";
import { acceptanceJournalHref, traceSummary, traceVsdRows, type TraceVsdSource } from "@/lib/batch-traceability";

/**
 * История партии по ВСД (спека mercury-iiko-acceptance-2026-11-21, Р3/AC3).
 */

function vsd(overrides: Partial<TraceVsdSource> = {}): TraceVsdSource {
  return {
    id: "v1",
    uuid: "0f6a3c1e-1111-2222-3333-444455556666",
    number: "123456789",
    productName: "Говядина охлаждённая",
    volume: 12.5,
    unit: "kg",
    consignorName: "ООО «Мясной двор»",
    deliveryDate: new Date("2026-11-20T08:00:00Z"),
    processedAt: new Date("2026-11-20T09:00:00Z"),
    firstSeenAt: new Date("2026-11-19T22:00:00Z"),
    journalDocumentId: "doc-1",
    ...overrides,
  };
}

test("AC3: ссылка на журнал — по коду шаблона документа; без кода или документа — нет ссылки", () => {
  assert.equal(acceptanceJournalHref("incoming_control", "doc-1"), "/journals/incoming_control/documents/doc-1");
  assert.equal(acceptanceJournalHref("incoming_raw_materials_control", "doc-2"), "/journals/incoming_raw_materials_control/documents/doc-2");
  assert.equal(acceptanceJournalHref(undefined, "doc-1"), null);
  assert.equal(acceptanceJournalHref("incoming_control", null), null);
});

test("AC3: строки ВСД — номер (или начало UUID), поставщик, объём, дата; документ не своей организации — без ссылки", () => {
  const codes = new Map([["doc-1", "incoming_control"]]);
  const rows = traceVsdRows(
    [
      vsd({ id: "late", deliveryDate: new Date("2026-11-21T08:00:00Z") }),
      vsd({ id: "early", number: null, deliveryDate: null, processedAt: null, journalDocumentId: "foreign-doc" }),
    ],
    codes,
  );
  assert.deepEqual(rows.map((row) => row.id), ["early", "late"], "по дате: доставка, оформление, первое появление");
  assert.equal(rows[0].number, "0f6a3c1e");
  assert.equal(rows[0].date.toISOString(), "2026-11-19T22:00:00.000Z");
  assert.equal(rows[0].journalHref, null, "документа нет в карте своей организации");
  assert.deepEqual(
    { number: rows[1].number, product: rows[1].product, supplier: rows[1].supplier, volume: rows[1].volume, unit: rows[1].unit, href: rows[1].journalHref },
    { number: "123456789", product: "Говядина охлаждённая", supplier: "ООО «Мясной двор»", volume: 12.5, unit: "kg", href: "/journals/incoming_control/documents/doc-1" },
  );
  const blank = traceVsdRows([vsd({ productName: "  ", consignorName: null, unit: " " })], codes)[0];
  assert.deepEqual({ product: blank.product, supplier: blank.supplier, unit: blank.unit }, { product: null, supplier: null, unit: null });
});

test("AC3: подзаголовок — записи и ВСД вместе; одна партия без записей — свой текст", () => {
  assert.deepEqual(traceSummary({ entries: 2, vsd: 1, batch: true }), { kind: "found", count: 3 });
  assert.deepEqual(traceSummary({ entries: 0, vsd: 0, batch: true }), { kind: "batchOnly" });
  assert.deepEqual(traceSummary({ entries: 0, vsd: 0, batch: false }), { kind: "empty" });
});

test("AC3: страница читает ВСД и партию только своей организации и не показывает чужую точку", () => {
  const page = readFileSync(new URL("../app/(dashboard)/journals/traceability/[key]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /db\.mercuryVetDocument\.findMany\(\{\s*where: \{ organizationId, batchKey \}/);
  assert.match(page, /db\.batch\.findUnique\(\{\s*where: \{ organizationId_code: \{ organizationId, code: batchKey \} \}/);
  assert.match(page, /db\.journalDocument\.findMany\(\{\s*where: \{ organizationId, id: \{ in: journalDocIds \} \}/);
  assert.match(page, /pointRecordVisible\(buildingContext, row\.buildingId\)/);
  assert.match(page, /pointRecordVisible\(buildingContext, batchRow\.buildingId\)/);
  assert.match(page, /canAccessWebPath\(session\.user, "\/batches"\)/, "ссылка на партию — только тем, кому открыт раздел");
  const mercury = readFileSync(new URL("../app/(dashboard)/mercury/incoming-vsd-client.tsx", import.meta.url), "utf8");
  assert.match(mercury, /href=\{`\/journals\/traceability\/\$\{encodeURIComponent\(doc\.batchKey\)\}`\}/);
  const batchPage = readFileSync(new URL("../app/(dashboard)/batches/[id]/page.tsx", import.meta.url), "utf8");
  assert.match(batchPage, /href=\{`\/journals\/traceability\/\$\{encodeURIComponent\(batch\.code\)\}`\}/);
});

test("AC4: тексты истории партии и ссылок — на ru, en, uz", async () => {
  const keys = [
    "batchOnlyDescription", "batchSection", "vsdSection", "entriesSection", "supplierLabel", "receivedOn",
    "openBatch", "vsdUntitled", "vsdNumber", "openAcceptanceJournal", "batchRejected",
  ] as const;
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const page = messages.journals.ui.traceabilityPage;
    for (const key of keys) assert.ok(page[key].trim(), `${locale}: ${key}`);
    assert.ok(messages.mercuryUi.incomingVsdClient.batchHistory.trim(), `${locale}: mercury batchHistory`);
    assert.ok(messages.productionBatches.batchHistory.trim(), `${locale}: batches batchHistory`);
  }
});

test("AC4: docs/MERCURY.md — журнал приёмки и история партии сделаны, в «не сделано» — стадия 1", () => {
  const doc = readFileSync(new URL("../../docs/MERCURY.md", import.meta.url), "utf8");
  const todo = doc.slice(doc.indexOf("## Что ещё не сделано"));
  assert.match(doc, /## Журнал приёмки и прослеживаемость \(21\.11\.2026\)/);
  assert.match(todo, /Стадия 1/);
  assert.doesNotMatch(todo, /IikoDialog/, "заглушки больше нет");
  assert.doesNotMatch(todo, /UI сопоставления с точками/, "площадки уже сопоставляются");
});
