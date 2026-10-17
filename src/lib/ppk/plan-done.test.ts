import test from "node:test";
import assert from "node:assert/strict";

import { markPlanDone, nextDueAfterDone } from "./plan-done";
import { PPK_RECORD_SCHEMAS, type LabPlanItem, type PestPlanItem } from "./records";

const lab: LabPlanItem = { object: "water", subject: "Вода", indicator: "", everyMonths: 2, laboratory: "", lastDate: "2026-01-01" };
const pest: PestPlanItem = { kind: "disinsection", object: "Кухня", frequency: "Ежемесячно", contractor: "", lastDate: null, nextDate: "2026-10-01" };

test("markPlanDone: лаборатория — lastDate = сегодня, результат проходит схему", () => {
  const out = markPlanDone("lab-plan", lab, "2026-10-17") as LabPlanItem;
  assert.equal(out.lastDate, "2026-10-17");
  assert.equal(PPK_RECORD_SCHEMAS["lab-plan"].safeParse(out).success, true);
  assert.equal(nextDueAfterDone("lab-plan", out), "2026-12-17");
});

test("markPlanDone: дезинсекция — следующий срок по периодичности", () => {
  const out = markPlanDone("pest-plan", pest, "2026-10-17") as PestPlanItem;
  assert.equal(out.lastDate, "2026-10-17");
  assert.equal(out.nextDate, "2026-11-17");
  assert.equal(PPK_RECORD_SCHEMAS["pest-plan"].safeParse(out).success, true);
  assert.equal(nextDueAfterDone("pest-plan", out), "2026-11-17");
});

test("markPlanDone: «По заявке» — следующего срока нет", () => {
  const out = markPlanDone("pest-plan", { ...pest, frequency: "По заявке" }, "2026-10-17") as PestPlanItem;
  assert.equal(out.nextDate, null);
  assert.equal(nextDueAfterDone("pest-plan", out), null);
});

test("markPlanDone: исходные данные не меняются", () => {
  markPlanDone("lab-plan", lab, "2026-10-17");
  assert.equal(lab.lastDate, "2026-01-01");
});
