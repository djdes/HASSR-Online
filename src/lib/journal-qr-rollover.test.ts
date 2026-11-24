import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { qrRolloverMessage, resolveTokenDocuments, rolloverTargets } from "@/lib/journal-qr-rollover";

/**
 * Плакат, напечатанный из документа, несёт в токене id ЭТОГО документа.
 * Когда период кончился, скан должен вести в документ нового периода той
 * же «линии» (тот же журнал, та же точка), а не в «документ не активен».
 */
const TODAY = "2026-10-01";
const token = (over: Partial<{ id: string; status: string; buildingId: string | null; dateFrom: string; dateTo: string }> = {}) => ({
  id: "old",
  status: "active",
  buildingId: null as string | null,
  dateFrom: "2026-09-16",
  dateTo: "2026-09-30",
  ...over,
});
const doc = (id: string, buildingId: string | null = null) => ({ id, buildingId });

describe("resolveTokenDocuments", () => {
  it("документ токена активен сегодня — только он", () => {
    const got = resolveTokenDocuments({
      tokenDocument: token({ dateFrom: "2026-10-01", dateTo: "2026-10-15" }),
      activeDocuments: [doc("x"), { id: "old", buildingId: null }],
      todayKey: TODAY,
    });
    assert.deepEqual(got.documents.map((d) => d.id), ["old"]);
    assert.equal(got.reason, undefined);
  });

  it("период кончился — преемник той же точки", () => {
    const got = resolveTokenDocuments({
      tokenDocument: token({ buildingId: "b1" }),
      activeDocuments: [doc("new-b2", "b2"), doc("new-b1", "b1")],
      todayKey: TODAY,
    });
    assert.deepEqual(got.documents.map((d) => d.id), ["new-b1"]);
  });

  it("у точки нет своего — общий документ (без точки)", () => {
    const got = resolveTokenDocuments({
      tokenDocument: token({ buildingId: "b1" }),
      activeDocuments: [doc("shared"), doc("new-b2", "b2")],
      todayKey: TODAY,
    });
    assert.deepEqual(got.documents.map((d) => d.id), ["shared"]);
  });

  it("общий документ, а организация перешла на точки — выбор из всех", () => {
    const got = resolveTokenDocuments({
      tokenDocument: token({ buildingId: null }),
      activeDocuments: [doc("b1-doc", "b1"), doc("b2-doc", "b2")],
      todayKey: TODAY,
    });
    assert.deepEqual(got.documents.map((d) => d.id), ["b1-doc", "b2-doc"]);
  });

  it("документ закрыт руководителем на этот период — не подменяем, объясняем", () => {
    const got = resolveTokenDocuments({
      tokenDocument: token({ status: "closed", dateFrom: "2026-10-01", dateTo: "2026-10-15" }),
      activeDocuments: [],
      todayKey: TODAY,
    });
    assert.deepEqual(got.documents, []);
    assert.equal(got.reason, "period-closed");
  });

  it("закрыт, но руководитель завёл новый документ той же точки — ведём в новый", () => {
    const got = resolveTokenDocuments({
      tokenDocument: token({ status: "closed", dateFrom: "2026-10-01", dateTo: "2026-10-15", buildingId: "b1" }),
      activeDocuments: [doc("fresh", "b1")],
      todayKey: TODAY,
    });
    assert.deepEqual(got.documents.map((d) => d.id), ["fresh"]);
  });

  it("преемника нет и не будет — пусто с причиной", () => {
    const got = resolveTokenDocuments({ tokenDocument: token({ buildingId: "b1" }), activeDocuments: [doc("b2-doc", "b2")], todayKey: TODAY });
    assert.deepEqual(got.documents, []);
    assert.equal(got.reason, "no-successor");
  });

  it("документ токена удалён или чужой — пусто с причиной", () => {
    const got = resolveTokenDocuments({ tokenDocument: null, activeDocuments: [doc("x")], todayKey: TODAY });
    assert.deepEqual(got.documents, []);
    assert.equal(got.reason, "token-document-missing");
  });
});

describe("qrRolloverMessage — что увидит сотрудник у плаката", () => {
  it("закрытый период и приостановленный кабинет — свои объяснения", () => {
    assert.equal(qrRolloverMessage("period-closed"), "Документ за этот период закрыт руководителем — попросите вернуть его в активные.");
    assert.match(qrRolloverMessage("org-paused"), /^Кабинет организации приостановлен/);
  });

  it("остальное — прежняя подсказка «попросите создать документ»", () => {
    assert.match(qrRolloverMessage("no-previous-document"), /Попросите руководителя создать документ/);
    assert.match(qrRolloverMessage(undefined), /Попросите руководителя создать документ/);
  });
});

/**
 * Офис — не объект (владелец, 2026-11-23): переход периода по QR заводит
 * документы только объектам. Цели — `documentBuildingTargets` (офиса в них
 * нет); якорь на офисе (старый документ офиса, плакат офиса) целью не
 * становится — документ получают объекты (проверка 2026-11-24).
 */
describe("rolloverTargets", () => {
  const points = ["p1", "p2"];
  it("якорь на объекте — только он", () => {
    assert.deepEqual(rolloverTargets(points, "p2"), ["p2"]);
  });
  it("якорь на офисе — не цель: объекты", () => {
    assert.deepEqual(rolloverTargets(points, "office"), ["p1", "p2"]);
  });
  it("без якоря — все объекты", () => {
    assert.deepEqual(rolloverTargets(points, null), ["p1", "p2"]);
  });
  it("без деления по объектам — один общий документ", () => {
    assert.deepEqual(rolloverTargets([null], "office"), [null]);
  });
});
