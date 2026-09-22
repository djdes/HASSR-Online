import assert from "node:assert/strict";
import test from "node:test";

import { patchDocumentConfig, type DocPatcherCtx } from "@/lib/journal-responsibles-doc-patchers";
import { getSchemaForJournal, rankKindForSlot } from "@/lib/journal-responsible-schemas";
import { rankRosterForSlot, type RosterUser } from "@/lib/journal-roster";

const people: Record<string, { name: string; title: string }> = {
  head: { name: "Овчинникова Ольга", title: "Заведующий производством" },
  cook: { name: "Абдулкадирова Индира", title: "Повар" },
  cleaner: { name: "Вера Уборщица", title: "" },
};

const ctx: DocPatcherCtx = {
  getName: (id) => (id ? people[id]?.name ?? "" : ""),
  getPositionTitle: (id) => (id ? people[id]?.title ?? "" : ""),
};

test("general_cleaning: утверждающий получает и ФИО, и должность", () => {
  const next = patchDocumentConfig(
    "general_cleaning",
    { approveRole: "Заведующий производством", approveEmployee: "Абдулкадирова Индира", approveEmployeeId: "cook" },
    { supervisor: "cook", manager: "head" },
    ctx
  );
  assert.equal(next?.approveEmployeeId, "head");
  assert.equal(next?.approveEmployee, "Овчинникова Ольга");
  assert.equal(next?.approveRole, "Заведующий производством");
  assert.equal(next?.responsibleEmployeeId, "cook");
  assert.equal(next?.responsibleEmployee, "Абдулкадирова Индира");
  assert.equal(next?.responsibleRole, "Повар");
});

test("пустая должность не затирает сохранённую", () => {
  const next = patchDocumentConfig(
    "training_plan",
    { approveRole: "Управляющий", approveEmployee: "Кто-то" },
    { main: "cleaner" },
    ctx
  );
  assert.equal(next?.approveEmployee, "Вера Уборщица");
  assert.equal(next?.approveRole, "Управляющий");
});

test("должность утверждающего пишется у 4 журналов с «УТВЕРЖДАЮ»", () => {
  for (const code of ["training_plan", "audit_plan", "equipment_calibration", "equipment_maintenance"]) {
    const next = patchDocumentConfig(code, { approveRole: "Управляющий" }, { main: "cook" }, ctx);
    assert.equal(next?.approveRole, "Повар", code);
    assert.equal(next?.approveEmployee, "Абдулкадирова Индира", code);
  }
});

test("audit_protocol: должность не трогаем (шапка её не печатает)", () => {
  const next = patchDocumentConfig("audit_protocol", { approveRole: "Управляющий" }, { main: "cook" }, ctx);
  assert.equal(next?.approveRole, "Управляющий");
  assert.equal(next?.approveEmployeeId, "cook");
});

test("утверждающий графика ген. уборок подбирается из руководства", () => {
  const slot = getSchemaForJournal("general_cleaning").slots.find((s) => s.id === "manager");
  assert.ok(slot);
  assert.equal(slot.kind ?? "filler", "filler");
  assert.equal(rankKindForSlot(slot), "verifier");

  const roster: RosterUser[] = [
    { id: "cook", name: "Абдулкадирова Индира", role: "cook", jobPositionName: "Повар", jobPositionCategory: "staff" },
    { id: "head", name: "Овчинникова Ольга", role: "manager", jobPositionName: "Шеф", jobPositionCategory: "management" },
  ];
  // Ни у кого нет подходящей по словам должности — руководство первым.
  const pick = rankRosterForSlot(roster, { kind: rankKindForSlot(slot), positionKeywords: slot.positionKeywords });
  assert.equal(pick?.id, "head");
  // Обычный заполняющий слот по-прежнему берёт линейный персонал.
  const filler = rankRosterForSlot(roster, { kind: "filler", positionKeywords: slot.positionKeywords });
  assert.equal(filler?.id, "cook");
});
