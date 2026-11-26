import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import ts from "typescript";

import { rowKeyForTaskSubmission } from "./row-key";
import type { JournalAdapter } from "./types";

/**
 * Группа D аудита перезаписи (2026-11-26): адаптеры TasksFlow, которые пишут
 * строки в `JournalDocument.config`.
 *
 *  - «прочитал → поменял → записал» — под блокировкой документа
 *    (`withDocumentConfigLock`): две одновременные отправки сохраняют обе;
 *  - бракераж / скоропорт / охлаждение: вторая отправка задачи — новая
 *    строка, подписанная строка не переписывается;
 *  - выполнение задачи без значений (pull, вебхук) не стирает строку.
 *
 * Модуль адаптера грузится как есть, база и блокировка — в памяти.
 */

type Config = Record<string, unknown>;
type Store = { templateCode: string; config: Config; directWrites: number; lookupsInLock?: number };
type LockedDoc = {
  id: string;
  organizationId: string;
  buildingId: string | null;
  config: unknown;
  status: string;
  verifierUserId: string | null;
  responsibleUserId: string | null;
  templateCode: string;
};
type LockOut = { config?: unknown; data?: unknown; result: unknown } | null;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function environment(store: Store) {
  let chain: Promise<unknown> = Promise.resolve();
  let inLock = false;
  const withDocumentConfigLock = (documentId: string, mutate: (doc: LockedDoc, tx: unknown) => Promise<LockOut>) => {
    const run = chain.then(async () => {
      await tick();
      inLock = true;
      const out = await mutate(
        {
          id: documentId,
          organizationId: "org-1",
          buildingId: null,
          config: clone(store.config),
          status: "active",
          verifierUserId: null,
          responsibleUserId: null,
          templateCode: store.templateCode,
        },
        {}
      ).finally(() => {
        inLock = false;
      });
      if (!out) return null;
      await tick();
      if (out.config !== undefined) store.config = clone(out.config) as Config;
      return out.result;
    });
    chain = run.catch(() => undefined);
    return run;
  };
  const db = {
    journalDocument: {
      // Снимок берётся сразу: два параллельных вызова без блокировки читают
      // один и тот же конфиг — как в базе.
      findUnique: async () => {
        const snapshot = { id: "doc-1", organizationId: "org-1", config: clone(store.config), template: { code: store.templateCode } };
        await tick();
        return snapshot;
      },
      update: async ({ data }: { data: { config?: unknown } }) => {
        await tick();
        store.directWrites += 1;
        if (data.config !== undefined) store.config = clone(data.config) as Config;
        return {};
      },
    },
    room: { findMany: async () => [] },
  };
  // Запрос сотрудника в пул из транзакции с блокировкой при пачке отправок
  // ждал бы второго соединения — считаем такие вызовы.
  const findTaskEmployee = async ({ employeeId }: { employeeId: string | null }) => {
    if (inLock) store.lookupsInLock = (store.lookupsInLock ?? 0) + 1;
    return employeeId ? { id: employeeId, name: `Сотрудник ${employeeId}`, positionTitle: "Повар" } : null;
  };
  return {
    "@/lib/db": { db },
    "@/lib/document-config-lock": { withDocumentConfigLock },
    "@/lib/journal-roster-db": { findTaskEmployee },
  } as Record<string, unknown>;
}

function loadAdapter(file: string, source: string, exportName: string, mocks: Record<string, unknown>): JournalAdapter {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const execute = vm.runInThisContext(`(function(require, module, exports) { ${compiled}\n})`, { filename: file });
  const local = createRequire(path.resolve(file));
  const fixtureModule = { exports: {} as Record<string, unknown> };
  execute((id: string) => (id in mocks ? mocks[id] : local(id)), fixtureModule, fixtureModule.exports);
  const adapter = fixtureModule.exports[exportName] as JournalAdapter | undefined;
  assert.ok(adapter, `${file}: нет экспорта ${exportName}`);
  return adapter;
}

const TODAY = "2026-11-26";
const rows = (config: Config, key = "rows") => (Array.isArray(config[key]) ? (config[key] as Config[]) : []);

type Fixture = {
  name: string;
  file: string;
  source: string;
  exportName: string;
  templateCode: string;
  config: Config;
  calls: Array<{ rowKey: string; values?: Record<string, string | number | boolean | null>; completed?: boolean }>;
  check: (config: Config) => void;
};

const employee = (id: string) => `employee-${id}`;

const FIXTURES: Fixture[] = [
  {
    name: "входной контроль",
    file: "src/lib/tasksflow-adapters/acceptance.ts",
    source: readFileSync("src/lib/tasksflow-adapters/acceptance.ts", "utf8"),
    exportName: "acceptanceAdapter",
    templateCode: "incoming_control",
    config: { rows: [] },
    calls: [
      { rowKey: employee("u1"), values: { productName: "Молоко" } },
      { rowKey: employee("u2"), values: { productName: "Сыр" } },
    ],
    check: (config) => assert.deepEqual(rows(config).map((row) => row.productName).sort(), ["Молоко", "Сыр"]),
  },
  {
    name: "аварии",
    file: "src/lib/tasksflow-adapters/accident-journal.ts",
    source: readFileSync("src/lib/tasksflow-adapters/accident-journal.ts", "utf8"),
    exportName: "accidentJournalAdapter",
    templateCode: "accident_journal",
    config: { rows: [] },
    calls: [
      { rowKey: employee("u1"), values: { locationName: "Цех 1" } },
      { rowKey: employee("u2"), values: { locationName: "Цех 2" } },
    ],
    check: (config) => assert.deepEqual(rows(config).map((row) => row.locationName).sort(), ["Цех 1", "Цех 2"]),
  },
  {
    name: "план аудита",
    file: "src/lib/tasksflow-adapters/audit-plan.ts",
    source: readFileSync("src/lib/tasksflow-adapters/audit-plan.ts", "utf8"),
    exportName: "auditPlanAdapter",
    templateCode: "audit_plan",
    config: { columns: [{ id: "auditor", title: "Аудитор" }], rows: [{ id: "a1", values: {} }, { id: "a2", values: {} }] },
    calls: [
      { rowKey: "audit-a1", values: { checked: true, comment: "первый" } },
      { rowKey: "audit-a2", values: { checked: true, comment: "второй" } },
    ],
    check: (config) =>
      assert.deepEqual(
        rows(config).map((row) => [row.id, row.checked, (row.values as Config).auditor]),
        [["a1", true, "первый"], ["a2", true, "второй"]]
      ),
  },
  {
    name: "протокол аудита",
    file: "src/lib/tasksflow-adapters/audit-protocol.ts",
    source: readFileSync("src/lib/tasksflow-adapters/audit-protocol.ts", "utf8"),
    exportName: "auditProtocolAdapter",
    templateCode: "audit_protocol",
    config: { rows: [{ id: "x1", note: "" }, { id: "x2", note: "" }] },
    calls: [
      { rowKey: "protocol-x1", values: { result: "yes" } },
      { rowKey: "protocol-x2", values: { result: "no" } },
    ],
    check: (config) => assert.deepEqual(rows(config).map((row) => [row.id, row.result]), [["x1", "yes"], ["x2", "no"]]),
  },
  {
    name: "отчёт аудита",
    file: "src/lib/tasksflow-adapters/audit-report.ts",
    source: readFileSync("src/lib/tasksflow-adapters/audit-report.ts", "utf8"),
    exportName: "auditReportAdapter",
    templateCode: "audit_report",
    config: { findings: [] },
    calls: [
      { rowKey: employee("u1"), values: { nonConformity: "Первое" } },
      { rowKey: employee("u2"), values: { nonConformity: "Второе" } },
    ],
    check: (config) => assert.deepEqual(rows(config, "findings").map((row) => row.nonConformity).sort(), ["Второе", "Первое"]),
  },
  {
    name: "поломки",
    file: "src/lib/tasksflow-adapters/breakdown-history.ts",
    source: readFileSync("src/lib/tasksflow-adapters/breakdown-history.ts", "utf8"),
    exportName: "breakdownHistoryAdapter",
    templateCode: "breakdown_history",
    config: { rows: [] },
    calls: [
      { rowKey: employee("u1"), values: { equipmentName: "Печь" } },
      { rowKey: employee("u2"), values: { equipmentName: "Миксер" } },
    ],
    check: (config) => assert.deepEqual(rows(config).map((row) => row.equipmentName).sort(), ["Миксер", "Печь"]),
  },
  {
    name: "жалобы",
    file: "src/lib/tasksflow-adapters/complaint-register.ts",
    source: readFileSync("src/lib/tasksflow-adapters/complaint-register.ts", "utf8"),
    exportName: "complaintRegisterAdapter",
    templateCode: "complaint_register",
    config: { rows: [] },
    calls: [
      { rowKey: employee("u1"), values: { applicantName: "Иванов" } },
      { rowKey: employee("u2"), values: { applicantName: "Петров" } },
    ],
    check: (config) => assert.equal(rows(config).length, 2),
  },
  {
    name: "дезсредства",
    file: "src/lib/tasksflow-adapters/disinfectant-usage.ts",
    source: readFileSync("src/lib/tasksflow-adapters/disinfectant-usage.ts", "utf8"),
    exportName: "disinfectantUsageAdapter",
    templateCode: "disinfectant_usage",
    config: { receipts: [] },
    calls: [
      { rowKey: employee("u1"), values: { disinfectantName: "Хлор" } },
      { rowKey: employee("u2"), values: { disinfectantName: "Спирт" } },
    ],
    check: (config) => assert.deepEqual(rows(config, "receipts").map((row) => row.disinfectantName).sort(), ["Спирт", "Хлор"]),
  },
  {
    name: "калибровка",
    file: "src/lib/tasksflow-adapters/equipment-calibration.ts",
    source: readFileSync("src/lib/tasksflow-adapters/equipment-calibration.ts", "utf8"),
    exportName: "equipmentCalibrationAdapter",
    templateCode: "equipment_calibration",
    config: { rows: [{ id: "e1", lastCalibrationDate: "", note: "" }, { id: "e2", lastCalibrationDate: "", note: "" }] },
    calls: [
      { rowKey: "equipment-e1", values: { lastCalibrationDate: "2026-11-01" } },
      { rowKey: "equipment-e2", values: { lastCalibrationDate: "2026-11-02" } },
    ],
    check: (config) =>
      assert.deepEqual(rows(config).map((row) => row.lastCalibrationDate), ["2026-11-01", "2026-11-02"]),
  },
  {
    name: "ТО оборудования",
    file: "src/lib/tasksflow-adapters/equipment-maintenance.ts",
    source: readFileSync("src/lib/tasksflow-adapters/equipment-maintenance.ts", "utf8"),
    exportName: "equipmentMaintenanceAdapter",
    templateCode: "equipment_maintenance",
    config: { rows: [{ id: "r1", equipmentName: "Печь" }, { id: "r2", equipmentName: "Миксер" }] },
    calls: [{ rowKey: "r1" }, { rowKey: "r2" }],
    check: (config) => {
      for (const row of rows(config)) {
        assert.ok(Object.values(row.fact as Config).includes("✓"), String(row.id));
      }
    },
  },
  {
    name: "стеклянные предметы",
    file: "src/lib/tasksflow-adapters/glass-list.ts",
    source: readFileSync("src/lib/tasksflow-adapters/glass-list.ts", "utf8"),
    exportName: "glassListAdapter",
    templateCode: "glass_items_list",
    config: { rows: [{ id: "g1", quantity: "1" }, { id: "g2", quantity: "1" }] },
    calls: [
      { rowKey: "glass-g1", values: { quantity: "5" } },
      { rowKey: "glass-g2", values: { quantity: "7" } },
    ],
    check: (config) => assert.deepEqual(rows(config).map((row) => [row.id, row.quantity]), [["g1", "5"], ["g2", "7"]]),
  },
  {
    name: "интенсивное охлаждение",
    file: "src/lib/tasksflow-adapters/intensive-cooling.ts",
    source: readFileSync("src/lib/tasksflow-adapters/intensive-cooling.ts", "utf8"),
    exportName: "intensiveCoolingAdapter",
    templateCode: "intensive_cooling",
    config: { rows: [] },
    calls: [
      { rowKey: rowKeyForTaskSubmission("intensive_cooling", employee("u1"), 1), values: { dishName: "Суп", productionTime: "10:00" } },
      { rowKey: rowKeyForTaskSubmission("intensive_cooling", employee("u2"), 1), values: { dishName: "Рагу", productionTime: "11:00" } },
    ],
    check: (config) => assert.deepEqual(rows(config).map((row) => row.dishName).sort(), ["Рагу", "Суп"]),
  },
  {
    name: "металлопримеси",
    file: "src/lib/tasksflow-adapters/metal-impurity.ts",
    source: readFileSync("src/lib/tasksflow-adapters/metal-impurity.ts", "utf8"),
    exportName: "metalImpurityAdapter",
    templateCode: "metal_impurity",
    config: { rows: [], materials: [], suppliers: [] },
    calls: [
      { rowKey: employee("u1"), values: { impurityCharacteristic: "стружка" } },
      { rowKey: employee("u2"), values: { impurityCharacteristic: "проволока" } },
    ],
    check: (config) => assert.deepEqual(rows(config).map((row) => row.impurityCharacteristic).sort(), ["проволока", "стружка"]),
  },
  {
    name: "СИЗ",
    file: "src/lib/tasksflow-adapters/ppe-issuance.ts",
    source: readFileSync("src/lib/tasksflow-adapters/ppe-issuance.ts", "utf8"),
    exportName: "ppeIssuanceAdapter",
    templateCode: "ppe_issuance",
    config: { rows: [] },
    calls: [
      { rowKey: employee("u1"), values: { maskCount: 2 } },
      { rowKey: employee("u2"), values: { maskCount: 3 } },
    ],
    check: (config) => assert.deepEqual(rows(config).map((row) => row.recipientUserId).sort(), ["u1", "u2"]),
  },
  {
    name: "списание",
    file: "src/lib/tasksflow-adapters/product-writeoff.ts",
    source: readFileSync("src/lib/tasksflow-adapters/product-writeoff.ts", "utf8"),
    exportName: "productWriteoffAdapter",
    templateCode: "product_writeoff",
    config: { rows: [] },
    calls: [
      { rowKey: rowKeyForTaskSubmission("product_writeoff", employee("u1"), 1), values: { productName: "Хлеб" } },
      { rowKey: rowKeyForTaskSubmission("product_writeoff", employee("u2"), 1), values: { productName: "Сметана" } },
    ],
    check: (config) => assert.deepEqual(rows(config).map((row) => row.productName).sort(), ["Сметана", "Хлеб"]),
  },
  {
    name: "обучение персонала",
    file: "src/lib/tasksflow-adapters/staff-training.ts",
    source: readFileSync("src/lib/tasksflow-adapters/staff-training.ts", "utf8"),
    exportName: "staffTrainingAdapter",
    templateCode: "staff_training",
    config: { rows: [] },
    calls: [
      { rowKey: employee("u1"), values: { instructorName: "Анна" } },
      { rowKey: employee("u2"), values: { instructorName: "Борис" } },
    ],
    check: (config) => assert.deepEqual(rows(config).map((row) => row.instructorName).sort(), ["Анна", "Борис"]),
  },
  {
    name: "прослеживаемость",
    file: "src/lib/tasksflow-adapters/traceability.ts",
    source: readFileSync("src/lib/tasksflow-adapters/traceability.ts", "utf8"),
    exportName: "traceabilityAdapter",
    templateCode: "traceability_test",
    config: { rows: [] },
    calls: [
      { rowKey: employee("u1"), values: { productName: "Котлеты" } },
      { rowKey: employee("u2"), values: { productName: "Тефтели" } },
    ],
    check: (config) => assert.equal(rows(config).length, 2),
  },
  {
    name: "план обучения",
    file: "src/lib/tasksflow-adapters/training-plan.ts",
    source: readFileSync("src/lib/tasksflow-adapters/training-plan.ts", "utf8"),
    exportName: "trainingPlanAdapter",
    templateCode: "training_plan",
    config: { topics: [{ id: "t1", name: "Санминимум" }], rows: [{ id: "p1", cells: {} }, { id: "p2", cells: {} }] },
    calls: [
      { rowKey: "position-p1-topic-t1", values: { plannedDate: "2026-12-01" } },
      { rowKey: "position-p2-topic-t1", values: { plannedDate: "2026-12-02" } },
    ],
    check: (config) =>
      assert.deepEqual(
        rows(config).map((row) => ((row.cells as Record<string, Config>).t1 ?? {}).date),
        ["2026-12-01", "2026-12-02"]
      ),
  },
  {
    name: "уборка (матрица пар)",
    file: "src/lib/tasksflow-adapters/cleaning.ts",
    source: readFileSync("src/lib/tasksflow-adapters/cleaning.ts", "utf8"),
    exportName: "cleaningAdapter",
    templateCode: "cleaning",
    config: { cleaningMode: "pairs", matrix: {} },
    calls: [{ rowKey: "pair-1" }, { rowKey: "pair-2" }],
    check: (config) => {
      const matrix = config.matrix as Record<string, Record<string, string>>;
      assert.ok(matrix["pair-1"]?.[TODAY], "pair-1");
      assert.ok(matrix["pair-2"]?.[TODAY], "pair-2");
    },
  },
];

for (const fixture of FIXTURES) {
  test(`${fixture.name}: две одновременные отправки сохраняют обе, запись — под блокировкой документа`, async () => {
    const store: Store = { templateCode: fixture.templateCode, config: clone(fixture.config), directWrites: 0 };
    const adapter = loadAdapter(fixture.file, fixture.source, fixture.exportName, environment(store));
    const results = await Promise.all(
      fixture.calls.map((call) =>
        adapter.applyRemoteCompletion({
          documentId: "doc-1",
          rowKey: call.rowKey,
          completed: call.completed ?? true,
          todayKey: TODAY,
          values: call.values,
        })
      )
    );
    assert.deepEqual(results, fixture.calls.map(() => true));
    assert.equal(store.directWrites, 0, "конфиг пишется только под блокировкой документа");
    assert.equal(store.lookupsInLock ?? 0, 0, "сотрудник ищется до блокировки");
    fixture.check(store.config);
  });
}

const BRAKERAGE = [
  {
    name: "бракераж готовой продукции",
    file: "src/lib/tasksflow-adapters/finished-product.ts",
    exportName: "finishedProductAdapter",
    templateCode: "finished_product",
    nameKey: "productName",
    values: (name: string) => ({ productName: name, productionTime: "12:00", organoleptic: "отлично", releaseAllowed: "yes" }),
  },
  {
    name: "скоропорт",
    file: "src/lib/tasksflow-adapters/perishable-rejection.ts",
    exportName: "perishableRejectionAdapter",
    templateCode: "perishable_rejection",
    nameKey: "productName",
    values: (name: string) => ({ productName: name }),
  },
  {
    name: "интенсивное охлаждение",
    file: "src/lib/tasksflow-adapters/intensive-cooling.ts",
    exportName: "intensiveCoolingAdapter",
    templateCode: "intensive_cooling",
    nameKey: "dishName",
    values: (name: string) => ({ dishName: name, productionTime: "12:00" }),
  },
] as const;

const BRAKERAGE_SOURCES: Record<string, string> = {
  "src/lib/tasksflow-adapters/finished-product.ts": readFileSync("src/lib/tasksflow-adapters/finished-product.ts", "utf8"),
  "src/lib/tasksflow-adapters/perishable-rejection.ts": readFileSync("src/lib/tasksflow-adapters/perishable-rejection.ts", "utf8"),
  "src/lib/tasksflow-adapters/intensive-cooling.ts": readFileSync("src/lib/tasksflow-adapters/intensive-cooling.ts", "utf8"),
};

for (const journal of BRAKERAGE) {
  test(`${journal.name}: блюдо B той же задачей — новая строка, подписанная строка A не меняется`, async () => {
    const store: Store = { templateCode: journal.templateCode, config: { rows: [] }, directWrites: 0 };
    const adapter = loadAdapter(journal.file, BRAKERAGE_SOURCES[journal.file], journal.exportName, environment(store));
    const taskKey = "employee-u1";
    assert.equal(
      await adapter.applyRemoteCompletion({
        documentId: "doc-1",
        rowKey: rowKeyForTaskSubmission(journal.templateCode, taskKey, 1000),
        completed: true,
        todayKey: TODAY,
        values: journal.values("Блюдо A"),
      }),
      true
    );
    // Комиссия подписала строку A.
    const signed = rows(store.config);
    assert.equal(signed.length, 1);
    signed[0].signatures = [{ userId: "chair", name: "Председатель", role: "", signedAt: "2026-11-26T10:00:00.000Z", method: "session" }];
    store.config = { ...store.config, rows: signed };
    const before = clone(signed[0]);

    assert.equal(
      await adapter.applyRemoteCompletion({
        documentId: "doc-1",
        rowKey: rowKeyForTaskSubmission(journal.templateCode, taskKey, 2000),
        completed: true,
        todayKey: TODAY,
        values: journal.values("Блюдо B"),
      }),
      true
    );
    const after = rows(store.config);
    assert.equal(after.length, 2);
    const rowA = after.find((row) => row.id === before.id);
    assert.ok(rowA, "строка A на месте");
    assert.equal(rowA[journal.nameKey], "Блюдо A");
    assert.deepEqual(rowA.signatures, before.signatures);
    const rowB = after.find((row) => row.id !== before.id);
    assert.ok(rowB);
    assert.equal(rowB[journal.nameKey], "Блюдо B");
    assert.ok(!Array.isArray(rowB.signatures) || rowB.signatures.length === 0, "у строки B нет чужих подписей");
  });

  test(`${journal.name}: выполнение задачи без значений (pull, вебхук) не стирает строку`, async () => {
    const legacy = { rows: [{ id: "legacy", [journal.nameKey]: "Блюдо A", sourceRowKey: "employee-u1" }] };
    const store: Store = { templateCode: journal.templateCode, config: clone(legacy), directWrites: 0 };
    const adapter = loadAdapter(journal.file, BRAKERAGE_SOURCES[journal.file], journal.exportName, environment(store));
    const changed = await adapter.applyRemoteCompletion({ documentId: "doc-1", rowKey: "employee-u1", completed: true, todayKey: TODAY });
    assert.equal(changed, false);
    const empty = await adapter.applyRemoteCompletion({ documentId: "doc-1", rowKey: "employee-u1", completed: true, todayKey: TODAY, values: {} });
    assert.equal(empty, false);
    assert.deepEqual(store.config, legacy);
  });
}

test("интенсивное охлаждение: форма задачи открывается пустой, строка с ключом задачи не подставляется", async () => {
  const legacy = { rows: [{ id: "legacy", dishName: "Борщ", startTemperature: "80", sourceRowKey: "employee-u1" }] };
  const store: Store = { templateCode: "intensive_cooling", config: clone(legacy), directWrites: 0 };
  const adapter = loadAdapter(
    "src/lib/tasksflow-adapters/intensive-cooling.ts",
    BRAKERAGE_SOURCES["src/lib/tasksflow-adapters/intensive-cooling.ts"],
    "intensiveCoolingAdapter",
    environment(store)
  );
  const form = await adapter.getTaskForm?.({ documentId: "doc-1", rowKey: "employee-u1" });
  assert.ok(form);
  assert.equal(form.submitLabel, "Сохранить замер");
  assert.equal(form.fields.find((field) => field.key === "dishName")?.defaultValue, undefined);
});

for (const fixture of FIXTURES.filter((item) => ["план аудита", "протокол аудита", "план обучения"].includes(item.name))) {
  test(`${fixture.name}: выполнение задачи без значений не сбрасывает строку`, async () => {
    const filled = clone(fixture.config);
    const store: Store = { templateCode: fixture.templateCode, config: clone(filled), directWrites: 0 };
    const adapter = loadAdapter(fixture.file, fixture.source, fixture.exportName, environment(store));
    await adapter.applyRemoteCompletion({ documentId: "doc-1", rowKey: fixture.calls[0].rowKey, completed: true, todayKey: TODAY, values: fixture.calls[0].values });
    const written = clone(store.config);
    const changed = await adapter.applyRemoteCompletion({ documentId: "doc-1", rowKey: fixture.calls[0].rowKey, completed: true, todayKey: TODAY });
    assert.equal(changed, false);
    // Подтверждение задачи в TasksFlow без формы приходит с `values: {}`.
    const empty = await adapter.applyRemoteCompletion({ documentId: "doc-1", rowKey: fixture.calls[0].rowKey, completed: true, todayKey: TODAY, values: {} });
    assert.equal(empty, false);
    assert.deepEqual(store.config, written);
  });
}
