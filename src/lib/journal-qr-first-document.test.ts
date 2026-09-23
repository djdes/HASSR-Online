import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decideQrFirstDocument,
  documentInTokenLine,
  qrRolloverMessage,
  resolveTokenDocuments,
} from "@/lib/journal-qr-rollover";
import { formatResponsiblePerson } from "@/lib/journal-responsible-person";

/**
 * Ядро страницы QR-кодов (2026-09-23): дополнительный QR документа
 * «прибит» к своему документу, submit сверяет документ с токеном, первый
 * документ при скане создаёт только собственный основной QR журнала.
 */
const TODAY = "2026-10-01";
const tokenDoc = (over: Partial<{ id: string; status: string; buildingId: string | null; dateFrom: string; dateTo: string }> = {}) => ({
  id: "old",
  status: "active",
  buildingId: null as string | null,
  dateFrom: "2026-09-16",
  dateTo: "2026-09-30",
  ...over,
});
const doc = (id: string, buildingId: string | null = null) => ({ id, buildingId });

describe("resolveTokenDocuments — режим pinned (QR документа со сроком)", () => {
  it("свой документ активен — он", () => {
    const got = resolveTokenDocuments({
      tokenDocument: tokenDoc({ dateFrom: "2026-10-01", dateTo: "2026-10-15" }),
      activeDocuments: [doc("x"), doc("old")],
      todayKey: TODAY,
      mode: "pinned",
    });
    assert.deepEqual(got.documents.map((d) => d.id), ["old"]);
  });

  it("есть документ следующего периода — pinned туда не ведёт", () => {
    const got = resolveTokenDocuments({
      tokenDocument: tokenDoc({ buildingId: "b1" }),
      activeDocuments: [doc("new-b1", "b1"), doc("shared")],
      todayKey: TODAY,
      mode: "pinned",
    });
    assert.deepEqual(got.documents, []);
    assert.equal(got.reason, "no-successor");
  });

  it("закрыт руководителем — period-closed; удалён — token-document-missing", () => {
    const closed = resolveTokenDocuments({
      tokenDocument: tokenDoc({ status: "closed", dateFrom: "2026-10-01", dateTo: "2026-10-15" }),
      activeDocuments: [doc("fresh")],
      todayKey: TODAY,
      mode: "pinned",
    });
    assert.deepEqual(closed.documents, []);
    assert.equal(closed.reason, "period-closed");
    const missing = resolveTokenDocuments({ tokenDocument: null, activeDocuments: [doc("x")], todayKey: TODAY, mode: "pinned" });
    assert.equal(missing.reason, "token-document-missing");
  });

  it("без режима — прежняя линейка (старые QR документов)", () => {
    const got = resolveTokenDocuments({ tokenDocument: tokenDoc({ buildingId: "b1" }), activeDocuments: [doc("new-b1", "b1")], todayKey: TODAY });
    assert.deepEqual(got.documents.map((d) => d.id), ["new-b1"]);
  });
});

describe("documentInTokenLine — submit не принимает чужой документ", () => {
  it("тот же документ — да", () => {
    assert.equal(documentInTokenLine({ id: "d1", buildingId: "b1" }, { id: "d1", buildingId: "b1" }), true);
  });
  it("документ точки: та же точка или общий — да, другая точка — нет", () => {
    const token = { id: "d1", buildingId: "b1" };
    assert.equal(documentInTokenLine(token, { id: "d2", buildingId: "b1" }), true);
    assert.equal(documentInTokenLine(token, { id: "d3", buildingId: null }), true);
    assert.equal(documentInTokenLine(token, { id: "d4", buildingId: "b2" }), false);
  });
  it("общий документ — вся линия журнала (организация перешла на точки)", () => {
    assert.equal(documentInTokenLine({ id: "d1", buildingId: null }, { id: "d9", buildingId: "b2" }), true);
  });
});

describe("decideQrFirstDocument — кто может создать первый документ", () => {
  const base = { hub: false, documentId: null, buildingId: null, orgTargets: [null] as Array<string | null> };
  const cases: Array<[string, Parameters<typeof decideQrFirstDocument>[0], boolean]> = [
    ["основной QR, организация без точек", base, true],
    ["хаб «Все журналы» — никогда", { ...base, hub: true }, false],
    ["QR документа (старый)", { ...base, documentId: "d1" }, false],
    ["QR документа со сроком", { ...base, documentId: "d1" }, false],
    ["основной QR точки, точка организации", { ...base, buildingId: "b1", orgTargets: ["b1", "b2"] }, true],
    ["основной QR точки, точки выключены — общий документ", { ...base, buildingId: "b1", orgTargets: [null] }, true],
    ["основной QR точки, точка не из организации", { ...base, buildingId: "bx", orgTargets: ["b1", "b2"] }, false],
    ["старый основной QR в организации с точками", { ...base, orgTargets: ["b1", "b2"] }, false],
  ];
  for (const [name, input, expected] of cases) {
    it(name, () => assert.equal(decideQrFirstDocument(input), expected));
  }
});

describe("кто должен настроить журнал", () => {
  it("ФИО и должность ответственного; никого — «руководитель»", () => {
    assert.equal(formatResponsiblePerson({ name: "Иванова Мария", positionTitle: "Заведующая" }), "Иванова Мария, заведующая");
    assert.equal(formatResponsiblePerson({ name: "Иванова Мария", positionTitle: null }), "Иванова Мария");
    assert.equal(formatResponsiblePerson(null), "руководитель");
  });

  it("qrRolloverMessage называет ответственного", () => {
    const text = qrRolloverMessage("no-previous-document", "Иванова Мария, заведующая");
    assert.match(text, /Иванова Мария, заведующая/);
    assert.match(text, /создать документ/);
    // Без имени — прежний текст.
    assert.match(qrRolloverMessage("no-document"), /Попросите руководителя создать документ/);
  });
});
