import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { journalQrHref } from "@/lib/journal-qr-target";
import { parseQrPostersRequest, type QrPostersRequest } from "@/lib/qr-posters-request";

/** Разбор относительного адреса страницы так же, как Next отдаёт searchParams. */
function parse(href: string): QrPostersRequest {
  const url = new URL(href, "http://x");
  assert.equal(url.pathname, "/settings/qr-posters");
  return parseQrPostersRequest(Object.fromEntries(url.searchParams.entries()));
}

const base = { selectedIds: null, format: null, autoprint: false, origin: null };

describe("parseQrPostersRequest — все входы на страницу QR-кодов", () => {
  it("без параметров — общий экран («Все журналы»)", () => {
    assert.deepEqual(parse("/settings/qr-posters"), { ...base, target: { type: "overview" } });
  });

  it("кнопка «QR-точка контроля» (journal-list-actions) — экран журнала", () => {
    assert.deepEqual(parse(journalQrHref("fryer_oil")), { ...base, target: { type: "journal", code: "fryer_oil", documentId: null } });
    assert.deepEqual(parse(journalQrHref("cold_equipment_control")), {
      ...base,
      target: { type: "journal", code: "cold_equipment_control", documentId: null },
    });
  });

  it("баннер гигиены — экран гигиены (оба основных QR отметит страница)", () => {
    assert.deepEqual(parse(journalQrHref("hygiene")), { ...base, target: { type: "journal", code: "hygiene", documentId: null } });
  });

  it("document-actions-bar: «QR-наклейки объектов» документа — журнал + doc", () => {
    assert.deepEqual(parse(journalQrHref("climate_control", { documentId: "d1" })), {
      ...base,
      target: { type: "journal", code: "climate_control", documentId: "d1" },
    });
  });

  it("старая кнопка журнала объектов (`kind=equipment&layout=sheet&journal=`)", () => {
    assert.deepEqual(parse("/settings/qr-posters?kind=equipment&layout=sheet&journal=cold_equipment_control&doc=d7"), {
      ...base,
      format: "sticker",
      target: { type: "journal", code: "cold_equipment_control", documentId: "d7" },
    });
    assert.deepEqual(parse("/settings/qr-posters?kind=rooms&layout=sheet&journal=climate_control"), {
      ...base,
      format: "sticker",
      target: { type: "journal", code: "climate_control", documentId: null },
    });
  });

  it("старая кнопка обычного журнала (`kind=journals&ids=код`) — отмечен ровно он", () => {
    assert.deepEqual(parse("/settings/qr-posters?kind=journals&ids=fryer_oil"), {
      ...base,
      selectedIds: ["fryer_oil"],
      target: { type: "journal", code: "fryer_oil", documentId: null },
    });
  });

  it("старая кнопка гигиены (`kind=journal` в единственном числе, два id)", () => {
    assert.deepEqual(parse("/settings/qr-posters?kind=journal&ids=hygiene,hygiene@verify"), {
      ...base,
      selectedIds: ["hygiene", "hygiene@verify"],
      target: { type: "journal", code: "hygiene", documentId: null },
    });
  });

  it("старая ссылка документа (`ids=код:документ`) — журнал, документ, отмечен только он", () => {
    assert.deepEqual(parse("/settings/qr-posters?kind=journals&ids=hygiene:d,hygiene@verify:d"), {
      ...base,
      selectedIds: ["hygiene:d", "hygiene@verify:d"],
      target: { type: "journal", code: "hygiene", documentId: "d" },
    });
  });

  it("qr-fill-preview «Плакат A4» журнала — формат A4 и печать сразу", () => {
    assert.deepEqual(parse("/settings/qr-posters?kind=journals&layout=poster&ids=fryer_oil%3Ad2&autoprint=1"), {
      ...base,
      selectedIds: ["fryer_oil:d2"],
      format: "a4",
      autoprint: true,
      target: { type: "journal", code: "fryer_oil", documentId: "d2" },
    });
  });

  it("qr-fill-preview «Наклейка» объекта — наклейка, только этот объект, печать сразу", () => {
    assert.deepEqual(parse("/settings/qr-posters?kind=equipment&layout=sheet&ids=eq1&autoprint=1"), {
      ...base,
      selectedIds: ["eq1"],
      format: "sticker",
      autoprint: true,
      target: { type: "objects", kind: "equipment", documentId: null },
    });
    assert.deepEqual(parse("/settings/qr-posters?kind=rooms&layout=poster&ids=r1&autoprint=1"), {
      ...base,
      selectedIds: ["r1"],
      format: "a4",
      autoprint: true,
      target: { type: "objects", kind: "room", documentId: null },
    });
  });

  it("qr-fill-preview «Все коды» — справочник или общий экран журналов", () => {
    assert.deepEqual(parse("/settings/qr-posters?kind=equipment"), { ...base, target: { type: "objects", kind: "equipment", documentId: null } });
    assert.deepEqual(parse("/settings/qr-posters?kind=rooms"), { ...base, target: { type: "objects", kind: "room", documentId: null } });
    assert.deepEqual(parse("/settings/qr-posters?kind=journals"), { ...base, target: { type: "overview" } });
  });

  it("выделение строк холодильников — наклейки только выбранных", () => {
    assert.deepEqual(parse("/settings/qr-posters?kind=equipment&layout=sheet&ids=a%2Cb"), {
      ...base,
      selectedIds: ["a", "b"],
      format: "sticker",
      target: { type: "objects", kind: "equipment", documentId: null },
    });
  });

  it("меню климата и холодильников (`kind=…&doc=`) — документ, экран решит журнал", () => {
    assert.deepEqual(parse("/settings/qr-posters?kind=rooms&doc=c1"), { ...base, target: { type: "objects", kind: "room", documentId: "c1" } });
    assert.deepEqual(parse("/settings/qr-posters?kind=equipment&doc=e1"), {
      ...base,
      target: { type: "objects", kind: "equipment", documentId: "e1" },
    });
  });

  it("/settings/equipment (наклейки и плакаты) и /settings/buildings", () => {
    assert.equal(parse("/settings/qr-posters?kind=equipment&layout=sheet").format, "sticker");
    assert.equal(parse("/settings/qr-posters?kind=equipment").format, null);
    assert.deepEqual(parse("/settings/qr-posters?kind=rooms").target, { type: "objects", kind: "room", documentId: null });
  });

  it("старый /settings/equipment/qr-sheet (редирект с origin)", () => {
    assert.deepEqual(parse("/settings/qr-posters?kind=equipment&layout=sheet&origin=http%3A%2F%2Flocalhost%3A3025"), {
      ...base,
      format: "sticker",
      origin: "http://localhost:3025",
      target: { type: "objects", kind: "equipment", documentId: null },
    });
  });

  it("журнал объектов в `ids=` — экран журнала с отметками по умолчанию (бывший редирект)", () => {
    assert.deepEqual(parse("/settings/qr-posters?kind=journals&ids=cold_equipment_control:d3"), {
      ...base,
      target: { type: "journal", code: "cold_equipment_control", documentId: "d3" },
    });
  });

  it("несколько журналов или «Все журналы» — общий экран, отмечены эти id", () => {
    assert.deepEqual(parse("/settings/qr-posters?kind=journals&ids=all,fryer_oil"), {
      ...base,
      selectedIds: ["all", "fryer_oil"],
      target: { type: "overview" },
    });
    assert.deepEqual(parse("/settings/qr-posters?kind=journals&ids=fryer_oil,metal_impurity").target, { type: "overview" });
  });

  it("мусор: пустые и повторные id, неизвестный формат", () => {
    assert.deepEqual(parse("/settings/qr-posters?kind=journals&ids=,fryer_oil,,fryer_oil&layout=zzz"), {
      ...base,
      selectedIds: ["fryer_oil"],
      target: { type: "journal", code: "fryer_oil", documentId: null },
    });
    assert.equal(parse("/settings/qr-posters?journal=fryer_oil&format=a5").format, "a5");
    assert.equal(parse("/settings/qr-posters?kind=journals&autoprint=true").autoprint, false);
  });

  it("массив значений (повтор параметра) — берётся первое", () => {
    assert.deepEqual(parseQrPostersRequest({ journal: ["fryer_oil", "hygiene"] }).target, { type: "journal", code: "fryer_oil", documentId: null });
  });
});
