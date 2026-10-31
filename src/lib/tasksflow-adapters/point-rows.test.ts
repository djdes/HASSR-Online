import assert from "node:assert/strict";
import test from "node:test";

import { rowsForDocumentPoint, withPointRows } from "./point-rows";
import type { JournalAdapter } from "./types";

// Аудит 2026-10-31: «Отправить всем» слало «Гигиена · Точка 2» каждому
// сотруднику организации — строки адаптеров собирались по всей организации.

test("строки документа точки: сотрудники другой точки убраны, строки без исполнителя остаются", () => {
  const rows = [
    { rowKey: "employee-anna", label: "Анна", responsibleUserId: "anna" },
    { rowKey: "employee-boris", label: "Борис", responsibleUserId: "boris" },
    { rowKey: "shared", label: "Общая строка", responsibleUserId: null },
  ];
  const atPoint = (userId: string) => userId !== "boris";
  assert.deepEqual(
    rowsForDocumentPoint(rows, atPoint).map((row) => row.rowKey),
    ["employee-anna", "shared"],
  );
});

test("обёртка реестра: остальные методы адаптера те же, обёртка одна на адаптер", () => {
  const adapter = {
    meta: { templateCode: "x", label: "X" },
    scheduleForRow: () => ({ weekDays: [1] }),
    listDocumentsForOrg: async () => [],
    syncDocument: async () => ({ created: 0, updated: 0, deleted: 0, errors: [] }),
    applyRemoteCompletion: async () => false,
  } as unknown as JournalAdapter;
  const wrapped = withPointRows(adapter);
  assert.equal(withPointRows(adapter), wrapped);
  assert.equal(wrapped.meta, adapter.meta);
  assert.equal(wrapped.syncDocument, adapter.syncDocument);
  assert.notEqual(wrapped.listDocumentsForOrg, adapter.listDocumentsForOrg);
});
