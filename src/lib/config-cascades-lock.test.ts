import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import ts from "typescript";

/**
 * Каскады, которые переписывают `config` многих документов (аудит перезаписи
 * 2026-11-26, группа D): список документов читается заранее, а пока каскад
 * идёт, в документ пишут QR, TasksFlow и сайт. Запись должна считаться от
 * конфига, прочитанного под блокировкой документа, иначе эти правки пропадают.
 */

type Config = Record<string, unknown>;
type Row = Record<string, unknown>;
type LockedDoc = { id: string; organizationId: string; buildingId: string | null; config: unknown; status: string; templateCode: string };
type LockOut = { config?: unknown; data?: Record<string, unknown>; result: unknown } | null;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function load(file: string, source: string, mocks: Record<string, unknown>) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const execute = vm.runInThisContext(`(function(require, module, exports) { ${compiled}\n})`, { filename: file });
  const local = createRequire(path.resolve(file));
  const fixtureModule = { exports: {} as Record<string, unknown> };
  execute((id: string) => (id in mocks ? mocks[id] : local(id)), fixtureModule, fixtureModule.exports);
  return fixtureModule.exports;
}

/** База одного документа: блокировка — через `withDocumentConfigLock`, прямые записи считаются. */
function documentStore(templateCode: string, buildingId: string | null, initial: Config) {
  const store = { config: clone(initial), columns: {} as Record<string, unknown>, directWrites: 0, lockedWrites: 0 };
  const withDocumentConfigLock = async (documentId: string, mutate: (doc: LockedDoc, tx: unknown) => Promise<LockOut>) => {
    const out = await mutate({ id: documentId, organizationId: "org-1", buildingId, config: clone(store.config), status: "active", templateCode }, {});
    if (!out) return null;
    store.lockedWrites += 1;
    if (out.config !== undefined) store.config = clone(out.config) as Config;
    if (out.data) Object.assign(store.columns, clone(out.data));
    return out.result;
  };
  const update = async ({ data }: { data: Record<string, unknown> }) => {
    store.directWrites += 1;
    const { config, ...rest } = data;
    if (config !== undefined) store.config = clone(config) as Config;
    Object.assign(store.columns, clone(rest));
    return {};
  };
  return { store, withDocumentConfigLock, update };
}

test("каскад ответственных: строка, дописанная во время каскада, не теряется", async () => {
  const doc = documentStore("accident_journal", null, { rows: [{ id: "A", locationName: "Цех 1" }] });
  const lateRow: Row = { id: "B", locationName: "Цех 2" };
  const db = {
    journalDocument: {
      findMany: async () => {
        const snapshot = [{ id: "doc-1", config: clone(doc.store.config), buildingId: null, _count: { entries: 0 } }];
        // Пока каскад собирает людей, сотрудник дописал строку по QR.
        doc.store.config = { ...doc.store.config, rows: [...(doc.store.config.rows as Row[]), lateRow] };
        return snapshot;
      },
      update: doc.update,
    },
    organization: { findUnique: async () => ({ journalResponsibleUsersJson: { accident_journal: { main: "u1" } } }) },
    building: { findMany: async () => [] },
    user: {
      findMany: async () => [{ id: "u1", name: "Иванов", role: "manager", positionTitle: "Управляющий", jobPosition: null, buildingIds: [] }],
    },
  };
  const cascade = load("src/lib/journal-responsibles-cascade.ts", readFileSync("src/lib/journal-responsibles-cascade.ts", "utf8"), {
    "@/lib/db": { db },
    "@/lib/document-config-lock": { withDocumentConfigLock: doc.withDocumentConfigLock },
    "@/lib/building-targets": { buildingTargets: async () => [null] },
  });
  const apply = cascade.applyResponsiblesToDocuments as (input: unknown) => Promise<number>;
  const updated = await apply({ organizationId: "org-1", templateId: "tpl-1", journalCode: "accident_journal", positionIds: [], scope: "active-any" });

  assert.equal(updated, 1);
  assert.equal(doc.store.directWrites, 0, "конфиг пишется только под блокировкой документа");
  assert.deepEqual((doc.store.config.rows as Row[]).map((row) => row.id), ["A", "B"]);
  assert.equal(doc.store.config.defaultResponsibleUserId, "u1");
  assert.equal(doc.store.columns.responsibleUserId, "u1");
});

test("строки точки: уборка, отмеченная во время синхронизации, не удаляется вместе со строкой чужой точки", async () => {
  const doc = documentStore("general_cleaning", "p1", {
    rows: [
      { id: "own", roomId: "room-p1" },
      { id: "foreign", roomId: "room-p2" },
    ],
  });
  const db = {
    journalDocument: {
      findMany: async () => {
        const snapshot = [{ id: "doc-1", buildingId: "p1", config: clone(doc.store.config), template: { code: "general_cleaning" } }];
        // Пока синхронизация читает справочники, уборщик отметил уборку в строке.
        const rows = (doc.store.config.rows as Row[]).map((row) =>
          row.id === "foreign" ? { ...row, cleanings: [{ done: true, date: "2026-11-26" }] } : row
        );
        doc.store.config = { ...doc.store.config, rows };
        return snapshot;
      },
      update: doc.update,
    },
    equipment: { findMany: async () => [] },
    room: { findMany: async () => [{ id: "room-p1", buildingId: "p1" }, { id: "room-p2", buildingId: "p2" }] },
    user: { findMany: async () => [] },
  };
  const sync = load("src/lib/point-document-rows-sync.ts", readFileSync("src/lib/point-document-rows-sync.ts", "utf8"), {
    "@/lib/db": { db },
    "@/lib/document-config-lock": { withDocumentConfigLock: doc.withDocumentConfigLock },
    "@/lib/building-targets": { buildingTargets: async () => ["p1", "p2"] },
    "@/lib/uv-document-points": { syncUvDocumentPoints: async () => 0 },
  });
  const run = sync.syncPointDocumentRows as (organizationId: string) => Promise<number>;
  await run("org-1");

  assert.equal(doc.store.directWrites, 0, "конфиг пишется только под блокировкой документа");
  const rows = doc.store.config.rows as Row[];
  assert.deepEqual(rows.map((row) => row.id), ["own", "foreign"]);
  assert.deepEqual(rows[1].cleanings, [{ done: true, date: "2026-11-26" }]);
});

test("строки точки: строка чужой точки без записей по-прежнему убирается", async () => {
  const doc = documentStore("general_cleaning", "p1", {
    rows: [
      { id: "own", roomId: "room-p1" },
      { id: "foreign", roomId: "room-p2" },
    ],
  });
  const db = {
    journalDocument: {
      findMany: async () => [{ id: "doc-1", buildingId: "p1", config: clone(doc.store.config), template: { code: "general_cleaning" } }],
      update: doc.update,
    },
    equipment: { findMany: async () => [] },
    room: { findMany: async () => [{ id: "room-p1", buildingId: "p1" }, { id: "room-p2", buildingId: "p2" }] },
    user: { findMany: async () => [] },
  };
  const sync = load("src/lib/point-document-rows-sync.ts", readFileSync("src/lib/point-document-rows-sync.ts", "utf8"), {
    "@/lib/db": { db },
    "@/lib/document-config-lock": { withDocumentConfigLock: doc.withDocumentConfigLock },
    "@/lib/building-targets": { buildingTargets: async () => ["p1", "p2"] },
    "@/lib/uv-document-points": { syncUvDocumentPoints: async () => 0 },
  });
  const run = sync.syncPointDocumentRows as (organizationId: string) => Promise<number>;
  assert.equal(await run("org-1"), 1);
  assert.equal(doc.store.directWrites, 0);
  assert.deepEqual((doc.store.config.rows as Row[]).map((row) => row.id), ["own"]);
});
