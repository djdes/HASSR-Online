import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  JOURNAL_OBJECT_QR_KINDS,
  isJournalObjectQrCode,
  journalQrHref,
  parseQrPosterKind,
  splitJournalPosterId,
} from "@/lib/journal-qr-target";

function parse(href: string) {
  const url = new URL(href, "http://x");
  return { path: url.pathname, params: Object.fromEntries(url.searchParams.entries()) };
}

describe("journalQrHref — куда ведёт кнопка QR журнала", () => {
  it("холодильники — наклейки на оборудование этого журнала", () => {
    assert.deepEqual(parse(journalQrHref("cold_equipment_control")), {
      path: "/settings/qr-posters",
      params: { kind: "equipment", layout: "sheet", journal: "cold_equipment_control" },
    });
  });

  it("климат — наклейки на помещения, УФ — на лампы", () => {
    assert.equal(parse(journalQrHref("climate_control")).params.kind, "rooms");
    assert.equal(parse(journalQrHref("climate_control")).params.journal, "climate_control");
    assert.equal(parse(journalQrHref("uv_lamp_runtime")).params.kind, "equipment");
    assert.equal(parse(journalQrHref("uv_lamp_runtime")).params.layout, "sheet");
  });

  it("журнал объектов из документа — наклейки объектов этого документа", () => {
    assert.deepEqual(parse(journalQrHref("cold_equipment_control", { documentId: "doc-1" })).params, {
      kind: "equipment",
      layout: "sheet",
      journal: "cold_equipment_control",
      doc: "doc-1",
    });
  });

  it("обычный журнал — его плакат (множественное kind)", () => {
    assert.deepEqual(parse(journalQrHref("fryer_oil")).params, { kind: "journals", ids: "fryer_oil" });
  });

  it("из документа — плакат именно этого документа (id `код:документ`)", () => {
    assert.deepEqual(parse(journalQrHref("fryer_oil", { documentId: "doc-9" })).params, {
      kind: "journals",
      ids: "fryer_oil:doc-9",
    });
  });

  it("гигиена — оба плаката: сотрудникам и «допуск» ответственному", () => {
    assert.equal(parse(journalQrHref("hygiene")).params.ids, "hygiene,hygiene@verify");
    assert.equal(parse(journalQrHref("hygiene", { documentId: "d" })).params.ids, "hygiene:d,hygiene@verify:d");
  });

  it("спецсимволы кода и документа кодируются", () => {
    const href = journalQrHref("a b&c", { documentId: "x/y" });
    assert.equal(parse(href).params.ids, "a b&c:x/y");
    assert.ok(!href.includes(" "));
  });
});

describe("журналы объектов", () => {
  it("список — холодильники, климат, УФ-лампы", () => {
    assert.deepEqual(Object.keys(JOURNAL_OBJECT_QR_KINDS).sort(), [
      "climate_control",
      "cold_equipment_control",
      "uv_lamp_runtime",
    ]);
    assert.equal(isJournalObjectQrCode("cold_equipment_control"), true);
    assert.equal(isJournalObjectQrCode("hygiene"), false);
    assert.equal(isJournalObjectQrCode(null), false);
    // Наследование от Object.prototype не делает код «журналом объектов».
    assert.equal(isJournalObjectQrCode("toString"), false);
  });
});

describe("parseQrPosterKind — вид плакатов из адреса", () => {
  it("единственное и множественное число", () => {
    assert.equal(parseQrPosterKind("journals"), "journal");
    assert.equal(parseQrPosterKind("journal"), "journal");
    assert.equal(parseQrPosterKind("rooms"), "room");
    assert.equal(parseQrPosterKind("room"), "room");
    assert.equal(parseQrPosterKind("equipment"), "equipment");
  });

  it("пусто и мусор — помещения, как раньше", () => {
    assert.equal(parseQrPosterKind(undefined), "room");
    assert.equal(parseQrPosterKind(""), "room");
    assert.equal(parseQrPosterKind("fridges"), "room");
  });
});

describe("splitJournalPosterId", () => {
  it("код, документ и второй плакат гигиены", () => {
    assert.deepEqual(splitJournalPosterId("hygiene@verify:doc-1"), { code: "hygiene", documentId: "doc-1", verify: true });
    assert.deepEqual(splitJournalPosterId("fryer_oil"), { code: "fryer_oil", documentId: null, verify: false });
    assert.deepEqual(splitJournalPosterId(""), { code: "", documentId: null, verify: false });
  });
});
