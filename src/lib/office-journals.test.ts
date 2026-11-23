import assert from "node:assert/strict";
import test from "node:test";

import { documentPointProblem, documentTargetIds, officeJournalTarget } from "@/lib/office-journals";

const office = { id: "o", kind: "office", sortOrder: 0, name: "Офис" };

test("журнал офиса — на единственный объект", () => {
  assert.equal(officeJournalTarget([office, { id: "p1", kind: "point", sortOrder: 5, name: "Кафе" }]), "p1");
});

test("объектов несколько — на первый по списку: порядок объектов, затем название", () => {
  const buildings = [
    office,
    { id: "p2", kind: "point", sortOrder: 1, name: "Цех" },
    { id: "p3", kind: "point", sortOrder: 0, name: "Склад" },
    { id: "p1", kind: "point", sortOrder: 0, name: "Кафе" },
  ];
  assert.equal(officeJournalTarget(buildings), "p1");
  // Вид не задан — объект (как в базе по умолчанию).
  assert.equal(officeJournalTarget([office, { id: "x", sortOrder: 0, name: "Без вида" }]), "x");
});

test("объектов нет — переносить некуда", () => {
  assert.equal(officeJournalTarget([office]), null);
  assert.equal(officeJournalTarget([]), null);
});

test("документы раздаются только объектам: офис — не объект", () => {
  const p1 = { id: "p1", kind: "point" };
  const p2 = { id: "p2" };
  assert.deepEqual(documentTargetIds(true, [office, p1, p2]), ["p1", "p2"]);
  assert.deepEqual(documentTargetIds(true, [office, p1]), ["p1"]);
  // Без деления по объектам или объект один — один общий документ, как раньше.
  assert.deepEqual(documentTargetIds(false, [office, p1, p2]), [null]);
  assert.deepEqual(documentTargetIds(true, [p1]), [null]);
  assert.deepEqual(documentTargetIds(true, []), [null]);
});

test("новый документ журнала — только на объекте", () => {
  const p1 = { id: "p1", name: "Кафе", address: null };
  const officeOption = { id: "o", name: "Офис", address: null, kind: "office" };
  const enabled = { enabled: true, buildings: [officeOption, p1], organizationView: false, activeBuilding: p1 };
  // Выбран объект — всё в порядке.
  assert.equal(documentPointProblem(enabled, null), null);
  assert.equal(documentPointProblem(enabled, "p1"), null);
  // «Выберите объект» (офис или вся организация) без объекта — нужен объект.
  assert.equal(documentPointProblem({ ...enabled, organizationView: true, activeBuilding: officeOption }, null), "point_required");
  assert.equal(documentPointProblem({ ...enabled, organizationView: true, activeBuilding: p1 }, null), "point_required");
  // Явно офис — тоже нет; явно объект — да.
  assert.equal(documentPointProblem({ ...enabled, organizationView: true, activeBuilding: officeOption }, "o"), "point_required");
  assert.equal(documentPointProblem({ ...enabled, organizationView: true, activeBuilding: officeOption }, "p1"), null);
  // Чужой или неизвестный объект.
  assert.equal(documentPointProblem(enabled, "zzz"), "not_found");
  // Объекты выключены — как раньше, без требований.
  assert.equal(documentPointProblem({ enabled: false, buildings: [], organizationView: true, activeBuilding: null }, null), null);
});

test("перенос журналов офиса — на выкладке, один раз, не за флагом legacy-сидов", async () => {
  const { readFileSync } = await import("node:fs");
  const deploy = readFileSync(".github/workflows/deploy.yml", "utf8");
  const step = deploy.indexOf("npx tsx prisma/seed-office-journals-to-points-2026-11.ts 2>&1");
  assert.ok(step > 0, "шаг есть");
  assert.ok(step > deploy.indexOf("prisma/seed-repair-inherited-org-brand-2026-11.ts"), "после починки фирменного стиля");
  assert.ok(step < deploy.indexOf('if [ "${RUN_LEGACY_DATA_SEEDS:-0}" = "1" ]'), "не за флагом legacy-сидов");
  const seed = readFileSync("prisma/seed-office-journals-to-points-2026-11.ts", "utf8");
  assert.match(seed, /once:office-journals-to-points:v1/);
  assert.match(seed, /--dry-run/);
});
