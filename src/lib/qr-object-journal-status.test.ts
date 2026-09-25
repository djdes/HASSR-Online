import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { coldEquipmentDaySummary, objectJournalSetupHref, renderObjectJournalStatus } from "@/lib/qr-object-journal-status";

/**
 * Основной QR журнала объектов — только статус: заполнять холодильник «из
 * списка» нельзя (решение 33d8559b), ссылок на заполнение нет.
 */
describe("renderObjectJournalStatus", () => {
  const groups = [
    {
      name: "Горячий цех",
      items: [
        { id: "e1", name: "Холодильник №1", state: "done" as const, summary: "замер снят: +3 °C" },
        { id: "e2", name: "Морозильник", state: "todo" as const, summary: "сегодня замера ещё нет" },
      ],
    },
  ];

  it("статус за сегодня и просьба отсканировать наклейку — без ссылок на заполнение", () => {
    const html = renderObjectJournalStatus({ code: "cold_equipment_control", groups, responsible: "" });
    assert.match(html, /Отсканируйте наклейку на самом холодильнике/);
    assert.match(html, /Сегодня: 1 из 2/);
    assert.match(html, /Холодильник №1/);
    assert.doesNotMatch(html, /equipment-fill|room-fill|token=|<a /);
  });

  it("объектов нет — ответственный и вход в настройки оборудования", () => {
    const html = renderObjectJournalStatus({ code: "cold_equipment_control", groups: [], responsible: "Иванова Мария, заведующая" });
    assert.match(html, /Ответственный за журнал — Иванова Мария, заведующая — должен войти и добавить оборудование/);
    assert.match(html, /href="\/login\?next=\/settings\/equipment"/);
  });

  it("климат — настройки помещений, УФ — оборудование", () => {
    assert.equal(objectJournalSetupHref("climate_control"), "/login?next=/settings/buildings");
    assert.equal(objectJournalSetupHref("uv_lamp_runtime"), "/login?next=/settings/equipment");
    const html = renderObjectJournalStatus({ code: "uv_lamp_runtime", groups, responsible: "" });
    assert.match(html, /наклейку на самой УФ-лампе/);
  });

  it("имена экранируются", () => {
    const html = renderObjectJournalStatus({
      code: "climate_control",
      groups: [{ name: "<b>", items: [{ id: "r", name: "<script>x</script>", state: "todo", summary: "" }] }],
      responsible: "",
    });
    assert.doesNotMatch(html, /<script>/);
  });
});

describe("coldEquipmentDaySummary", () => {
  it("«обсл»/«рем» за сегодня — отметка дня, а не «замера ещё нет»; показание важнее", () => {
    assert.deepEqual(coldEquipmentDaySummary(3, null), { state: "done", summary: "замер снят: +3 °C" });
    assert.deepEqual(coldEquipmentDaySummary(null, "repair"), { state: "done", summary: "ремонт — в журнале «рем»" });
    assert.deepEqual(coldEquipmentDaySummary(null, "service"), { state: "done", summary: "обслуживание — в журнале «обсл»" });
    assert.deepEqual(coldEquipmentDaySummary(-18, "repair"), { state: "done", summary: "замер снят: -18 °C" });
    assert.deepEqual(coldEquipmentDaySummary(null, null), { state: "todo", summary: "сегодня замера ещё нет" });
  });
});
