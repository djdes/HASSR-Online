import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import ts from "typescript";

/**
 * Внешний API в журнал со строками в `config` (аудит перезаписи 2026-11-26,
 * группа D): документ читается под блокировкой строки в той же транзакции,
 * что и запись, а `data.rows` сливается со строками документа по `id`.
 * Раньше конфиг брался из чтения до транзакции, и `rows` заменял все строки:
 * подписанная комиссией строка, записанная с сайта между чтением и записью,
 * пропадала.
 */

type Config = Record<string, unknown>;
type Row = Record<string, unknown>;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const FILE = "src/lib/external/dispatch.ts";
const SOURCE = readFileSync("src/lib/external/dispatch.ts", "utf8");

function fixture(initial: Config) {
  const store = { config: clone(initial) };
  const log: string[] = [];
  const document = () => ({
    id: "doc-1",
    organizationId: "org-1",
    templateId: "tpl-1",
    buildingId: null,
    title: "Бракераж",
    dateFrom: new Date("2026-11-01T00:00:00.000Z"),
    dateTo: new Date("2026-11-30T00:00:00.000Z"),
    status: "active",
    autoFill: false,
    config: clone(store.config),
  });
  const signedRow: Row = {
    id: "B",
    productName: "Рагу",
    signatures: [{ userId: "chair", name: "Председатель", role: "", signedAt: "2026-11-26T10:00:00.000Z", method: "session" }],
  };
  const db = {
    organization: { findUnique: async () => ({ id: "org-1", name: "Организация" }) },
    journalTemplate: { findUnique: async () => ({ id: "tpl-1", code: "finished_product", name: "Бракераж", fields: [] }) },
    user: {
      findFirst: async () => ({ id: "u1" }),
      findMany: async () => [{ id: "u1", name: "Повар", role: "cook", positionTitle: "Повар", jobPosition: null, buildingIds: [] }],
    },
    building: { findMany: async () => [] },
    room: { findMany: async () => [] },
    journalDocument: {
      findMany: async () => {
        const snapshot = document();
        // Пока внешний запрос идёт к транзакции, комиссия подписала новую
        // строку с сайта.
        store.config = { ...store.config, rows: [...((store.config.rows as Row[]) ?? []), signedRow] };
        log.push("read-outside");
        return [snapshot];
      },
    },
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        $queryRaw: async (strings: TemplateStringsArray) => {
          log.push(strings.join("?").replace(/\s+/g, " ").trim());
          return [];
        },
        journalDocument: {
          findUnique: async () => {
            log.push("read-in-tx");
            return document();
          },
          update: async ({ data }: { data: { config?: unknown } }) => {
            log.push("write");
            if (data.config !== undefined) store.config = clone(data.config) as Config;
            return document();
          },
        },
        journalDocumentEntry: { upsert: async () => ({}) },
      };
      return run(tx);
    },
  };
  const compiled = ts.transpileModule(SOURCE, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const execute = vm.runInThisContext(`(function(require, module, exports) { ${compiled}\n})`, { filename: FILE });
  const local = createRequire(path.resolve(FILE));
  const mocks: Record<string, unknown> = {
    "@/lib/db": { db },
    "@/lib/building-targets": { documentBuildingTargets: async () => [null] },
  };
  const fixtureModule = { exports: {} as Record<string, unknown> };
  execute((id: string) => (id in mocks ? mocks[id] : local(id)), fixtureModule, fixtureModule.exports);
  const dispatch = fixtureModule.exports.dispatchExternalEntries as (params: unknown) => Promise<{ ok: boolean; error?: string }>;
  return { store, log, dispatch };
}

test("строки из внешнего API сливаются по id с прочитанным под блокировкой конфигом", async () => {
  const { store, log, dispatch } = fixture({
    rows: [{ id: "A", productName: "Суп", productionDateTime: "2026-11-26 10:00" }],
  });
  const result = await dispatch({
    organizationId: "org-1",
    journalCode: "finished_product",
    entries: [
      {
        employeeId: "u1",
        date: "2026-11-26",
        data: { rows: [{ id: "A", note: "пересолено" }, { id: "C", productName: "Компот" }] },
      },
    ],
  });
  assert.equal(result.ok, true, result.error);

  const rows = store.config.rows as Row[];
  assert.deepEqual(rows.map((row) => row.id), ["A", "B", "C"]);
  const [a, b, c] = rows;
  assert.equal(a.productName, "Суп", "поля строки, которых нет в запросе, остаются");
  assert.equal(a.note, "пересолено");
  assert.equal(b.productName, "Рагу");
  assert.equal((b.signatures as unknown[]).length, 1, "подпись строки, записанной с сайта, на месте");
  assert.equal(c.productName, "Компот");

  // Чтение для записи — под блокировкой строки документа в транзакции.
  const lock = log.findIndex((entry) => /FOR UPDATE/.test(entry));
  assert.ok(lock >= 0, `нет SELECT … FOR UPDATE: ${log.join(" | ")}`);
  assert.ok(lock < log.indexOf("read-in-tx"), log.join(" | "));
  assert.ok(log.indexOf("read-in-tx") < log.lastIndexOf("write"), log.join(" | "));
});
