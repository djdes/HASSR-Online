import assert from "node:assert/strict";
import test from "node:test";

import { documentPointProblem, documentTargetIds, officeJournalTarget, planOfficeJournalMoves } from "@/lib/office-journals";

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

test("перенос журналов офиса: на выкладке — подсчёт, затем перенос (решение владельца 2026-11-24)", async () => {
  const { readFileSync } = await import("node:fs");
  const deploy = readFileSync(".github/workflows/deploy.yml", "utf8");
  const legacyGate = deploy.indexOf('if [ "${RUN_LEGACY_DATA_SEEDS:-0}" = "1" ]');
  const dryRun = deploy.indexOf("npx tsx prisma/seed-office-journals-to-points-2026-11.ts --dry-run");
  const realRun = deploy.indexOf("npx tsx prisma/seed-office-journals-to-points-2026-11.ts 2>&1");
  // Владелец 2026-11-24: «Переносить при выкладке, дубли оставить на офисе» —
  // разовый перенос, как починка фирменного стиля: сначала подсчёт, затем
  // перенос, оба — на обычной выкладке, не за флагом legacy-досевов.
  assert.ok(dryRun > 0 && dryRun < legacyGate, "подсчёт — на обычной выкладке");
  assert.ok(realRun > dryRun && realRun < legacyGate, "перенос — сразу за подсчётом, на обычной выкладке");
  assert.equal(deploy.split("seed-office-journals-to-points-2026-11.ts").length - 1, 2, "ровно два запуска: подсчёт и перенос");
  const seed = readFileSync("prisma/seed-office-journals-to-points-2026-11.ts", "utf8");
  assert.match(seed, /once:office-journals-to-points:v1/);
  // Лог Actions публичный: без id организаций и офисов.
  assert.doesNotMatch(seed, /move\.organizationId|move\.officeId|move\.targetId \?\?/);
});

test("журналы на объекты: напоминания, задачи TasksFlow, УФ-лампы, сводка и закрытие дня не видят офис", async () => {
  const { readFileSync } = await import("node:fs");
  // Ревью 2026-11-24: эти места раздавали журналы и напоминания и офису —
  // после переноса офис без документов получал бы «всё не заполнено».
  for (const file of [
    "src/app/api/integrations/tasksflow/bulk-assign-today/route.ts",
    "src/app/api/cron/compliance/route.ts",
    "src/lib/uv-document-points.ts",
    "src/app/api/cron/mini-digest/route.ts",
    "src/app/api/cron/auto-close-shifts/route.ts",
    // Проверка 2026-11-24: переход периода по QR (бот MAX, плакаты журналов,
    // отправка по QR) и приёмка по ВСД заводили документы и на офис.
    "src/lib/journal-qr-rollover.ts",
    "src/lib/mercury/process-incoming.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /documentBuildingTargets\(/, file);
    assert.doesNotMatch(source, /[^t]buildingTargets\(/, file);
  }
});

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

test("перенос журналов офиса: без дублей на объекте и без выключенных там журналов", () => {
  const office = [
    // Своего документа у объекта за этот период нет — переносим.
    { id: "manual", key: "cold", dateFrom: day("2026-11-01"), dateTo: day("2026-11-30") },
    // У объекта уже есть такой журнал за пересекающийся период (копия автоматики) — не трогаем.
    { id: "auto-copy", key: "hygiene", dateFrom: day("2026-11-16"), dateTo: day("2026-11-30") },
    // Тот же журнал, но другой период — переносим.
    { id: "october", key: "hygiene", dateFrom: day("2026-10-01"), dateTo: day("2026-10-15") },
    // Журнал выключен на объекте — там его не видно, не переносим.
    { id: "off", key: "fryer", dateFrom: day("2026-11-01"), dateTo: day("2026-11-30") },
    // Без дат (бумажный бланк) — переносим, только если у объекта нет такого журнала вовсе.
    { id: "paper-free", key: "ot_intro", dateFrom: null, dateTo: null },
    { id: "paper-dup", key: "ot_repeat", dateFrom: null, dateTo: null },
  ];
  const target = [
    { key: "hygiene", dateFrom: day("2026-11-16"), dateTo: day("2026-11-30") },
    { key: "ot_repeat", dateFrom: day("2026-01-01"), dateTo: null },
  ];
  const plan = planOfficeJournalMoves(office, target, new Set(["fryer"]));
  assert.deepEqual(plan.move, ["manual", "october", "paper-free"]);
  assert.deepEqual(plan.overlap, ["auto-copy", "paper-dup"]);
  assert.deepEqual(plan.disabled, ["off"]);
});
