import test from "node:test";
import assert from "node:assert/strict";

import { PPK_BLOCKS, type PpkBlockKey } from "./registry";
import {
  computePpkStatuses,
  emptyPpkFacts,
  ppkNextStep,
  ppkProgress,
  type PpkFacts,
  type PpkStatus,
} from "./status";

function facts(patch: Partial<PpkFacts>): PpkFacts {
  return { ...emptyPpkFacts(), ...patch };
}

function statusOf(patch: Partial<PpkFacts>, key: PpkBlockKey): PpkStatus {
  return computePpkStatuses(facts(patch))[key];
}

test("пустые факты: счётные блоки пустые, справочные — info", () => {
  const statuses = computePpkStatuses(emptyPpkFacts());
  for (const block of PPK_BLOCKS) {
    assert.ok(block.key in statuses, `нет статуса у ${block.key}`);
    if (["program", "posters", "storage"].includes(block.key)) {
      assert.equal(statuses[block.key], "info", block.key);
    } else {
      assert.equal(statuses[block.key], "empty", block.key);
    }
  }
});

test("instructions: документ базы знаний → done", () => {
  assert.equal(statusOf({}, "instructions"), "empty");
  assert.equal(statusOf({ knowledgeDocs: 1 }, "instructions"), "done");
});

test("procedures: файл в папке процедур → done", () => {
  assert.equal(statusOf({}, "procedures"), "empty");
  assert.equal(statusOf({ folders: { procedures: 1 } }, "procedures"), "done");
  assert.equal(statusOf({ folders: { storage: 3 } }, "procedures"), "empty");
});

test("orders: согласование ППК → done, любой приказ → started", () => {
  assert.equal(statusOf({}, "orders"), "empty");
  assert.equal(statusOf({ orders: { total: 2, ppkApproval: false } }, "orders"), "started");
  assert.equal(statusOf({ orders: { total: 1, ppkApproval: true } }, "orders"), "done");
});

test("team: один сотрудник → started, двое без руководителя → started, двое с руководителем → done", () => {
  assert.equal(statusOf({ team: { members: 1, hasLeader: true } }, "team"), "started");
  assert.equal(statusOf({ team: { members: 2, hasLeader: false } }, "team"), "started");
  assert.equal(statusOf({ team: { members: 2, hasLeader: true } }, "team"), "done");
  assert.equal(statusOf({ team: { members: 0, hasLeader: false } }, "team"), "empty");
});

test("policy: текст → started, текст и утверждение → done", () => {
  assert.equal(statusOf({}, "policy"), "empty");
  assert.equal(statusOf({ policy: { hasText: true, approved: false } }, "policy"), "started");
  assert.equal(statusOf({ policy: { hasText: true, approved: true } }, "policy"), "done");
  assert.equal(statusOf({ policy: { hasText: false, approved: true } }, "policy"), "empty");
});

test("products: есть продукция → done", () => {
  assert.equal(statusOf({ products: 0 }, "products"), "empty");
  assert.equal(statusOf({ products: 1 }, "products"), "done");
});

test("flowcharts: схема → started, схема с тремя шагами → done", () => {
  assert.equal(statusOf({ flowcharts: { count: 1, maxSteps: 2 } }, "flowcharts"), "started");
  assert.equal(statusOf({ flowcharts: { count: 1, maxSteps: 3 } }, "flowcharts"), "done");
  assert.equal(statusOf({}, "flowcharts"), "empty");
});

test("hazards: опасности → started, все значимые решены → done", () => {
  assert.equal(statusOf({ hazards: { total: 2, significant: 2, significantDecided: 1 } }, "hazards"), "started");
  assert.equal(statusOf({ hazards: { total: 2, significant: 2, significantDecided: 2 } }, "hazards"), "done");
  assert.equal(statusOf({ hazards: { total: 0, significant: 0, significantDecided: 0 } }, "hazards"), "empty");
});

test("control-points: нет значимых опасностей → done", () => {
  assert.equal(statusOf({ hazards: { total: 2, significant: 0, significantDecided: 0 } }, "control-points"), "done");
});

test("control-points: КТК/ОПРК с ответственными и решёнными опасностями → done, без ответственных → started", () => {
  const hazards = { total: 3, significant: 2, significantDecided: 2 };
  assert.equal(
    statusOf({ hazards, controlPoints: { ccpOrOprp: 2, withResponsible: 2 } }, "control-points"),
    "done",
  );
  assert.equal(
    statusOf({ hazards, controlPoints: { ccpOrOprp: 2, withResponsible: 1 } }, "control-points"),
    "started",
  );
  assert.equal(
    statusOf(
      { hazards: { total: 3, significant: 2, significantDecided: 1 }, controlPoints: { ccpOrOprp: 1, withResponsible: 1 } },
      "control-points",
    ),
    "started",
  );
  assert.equal(statusOf({}, "control-points"), "empty");
});

test("audit: записи или проверки → done, включённый журнал сам по себе не «начат»", () => {
  assert.equal(statusOf({ audit: { recentRecords: 0, checklistRuns: 0 } }, "audit"), "empty");
  assert.equal(statusOf({ audit: { recentRecords: 1, checklistRuns: 0 } }, "audit"), "done");
  assert.equal(statusOf({ audit: { recentRecords: 0, checklistRuns: 2 } }, "audit"), "done");
  assert.equal(statusOf({}, "audit"), "empty");
});

test("control-points: все значимые решены без ККТ/ОПП (как ПП или «не требуется») → done", () => {
  assert.equal(
    statusOf(
      { hazards: { total: 3, significant: 2, significantDecided: 2 }, controlPoints: { ccpOrOprp: 0, withResponsible: 0 } },
      "control-points",
    ),
    "done",
  );
  assert.equal(
    statusOf(
      { hazards: { total: 3, significant: 2, significantDecided: 1 }, controlPoints: { ccpOrOprp: 0, withResponsible: 0 } },
      "control-points",
    ),
    "empty",
  );
});

test("floor-plans: полный комплект → done, частичный → started", () => {
  assert.equal(statusOf({ floorPlans: { count: 2, complete: true } }, "floor-plans"), "done");
  assert.equal(statusOf({ floorPlans: { count: 1, complete: false } }, "floor-plans"), "started");
  assert.equal(statusOf({}, "floor-plans"), "empty");
});

test("pest-control и lab: план и договор вместе → done, одно из двух → started", () => {
  assert.equal(statusOf({ pest: { planItems: 2, contract: true } }, "pest-control"), "done");
  assert.equal(statusOf({ pest: { planItems: 2, contract: false } }, "pest-control"), "started");
  assert.equal(statusOf({ pest: { planItems: 0, contract: true } }, "pest-control"), "started");
  assert.equal(statusOf({}, "pest-control"), "empty");
  assert.equal(statusOf({ lab: { planItems: 1, contract: true } }, "lab"), "done");
  assert.equal(statusOf({ lab: { planItems: 0, contract: false } }, "lab"), "empty");
});

test("norm-documents: выбран норматив → done", () => {
  assert.equal(statusOf({}, "norm-documents"), "empty");
  assert.equal(statusOf({ norms: { selected: 1 } }, "norm-documents"), "done");
});

test("ppkProgress считает только готовые и счётные блоки", () => {
  const statuses = computePpkStatuses(emptyPpkFacts());
  const expectedTotal = PPK_BLOCKS.filter((block) => block.ready && block.counted).length;
  assert.deepEqual(ppkProgress(statuses), { done: 0, total: expectedTotal });

  const all = { ...statuses } as Record<PpkBlockKey, PpkStatus>;
  for (const block of PPK_BLOCKS) all[block.key] = "done";
  assert.deepEqual(ppkProgress(all), { done: expectedTotal, total: expectedTotal });

  // Справочные (counted: false) и неготовые блоки не влияют на счётчик.
  const onlyNotCounted = { ...statuses } as Record<PpkBlockKey, PpkStatus>;
  for (const block of PPK_BLOCKS) {
    if (!block.counted || !block.ready) onlyNotCounted[block.key] = "done";
  }
  assert.deepEqual(ppkProgress(onlyNotCounted), { done: 0, total: expectedTotal });
});

test("ppkNextStep: первый неготовый счётный блок, null когда всё готово", () => {
  const statuses = computePpkStatuses(emptyPpkFacts());
  const first = PPK_BLOCKS.find((block) => block.ready && block.counted)!;
  assert.equal(ppkNextStep(statuses)?.key, first.key);

  const all = { ...statuses } as Record<PpkBlockKey, PpkStatus>;
  for (const block of PPK_BLOCKS) all[block.key] = "done";
  assert.equal(ppkNextStep(all), null);
});
