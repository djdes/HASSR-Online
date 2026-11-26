import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

import ts from "typescript";

import { mintTaskFillToken } from "./task-fill-token";
import { extractEmployeeId } from "./tasksflow-adapters/row-key";

/**
 * Группа D (аудит перезаписи 2026-11-26): форма задачи TasksFlow в строчном
 * журнале (бракераж, скоропорт, охлаждение…) — каждая отправка новая строка.
 * Раньше оба маршрута отдавали адаптеру ключ задачи `employee-<id>`, и вторая
 * отправка той же задачей переписывала первую строку (вместе с подписями).
 */

const require = createRequire(import.meta.url);
const compile = (source: string) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;

type Route = { POST: (request: Request, ctx?: unknown) => Promise<Response> };

function load(source: string, mocks: Record<string, unknown>): Route {
  const execute = vm.runInThisContext(`(function(require, module, exports) { ${compile(source)}\n})`);
  const fixtureModule = { exports: {} as Route };
  execute((id: string) => (id in mocks ? mocks[id] : require(id)), fixtureModule, fixtureModule.exports);
  return fixtureModule.exports;
}

function recorder() {
  const rowKeys: string[] = [];
  const adapter = {
    async applyRemoteCompletion(input: { rowKey: string }) {
      rowKeys.push(input.rowKey);
      return true;
    },
  };
  return { rowKeys, adapter };
}

const link = (journalCode: string) => ({
  id: "link-1",
  tasksflowTaskId: 51,
  journalCode,
  journalDocumentId: "doc-1",
  rowKey: "employee-user1",
  remoteStatus: "active",
  integration: { id: "integration-1", webhookSecret: "secret", organizationId: "org-1" },
});

function taskFillRoute(journalCode: string, taskScope: string) {
  const { rowKeys, adapter } = recorder();
  const route = load(readFileSync("src/app/api/task-fill/[taskId]/route.ts", "utf8"), {
    "@/lib/db": {
      db: {
        tasksFlowTaskLink: { findMany: async () => [link(journalCode)], update: async () => ({}) },
        journalTemplate: { findFirst: async () => ({ id: "template-1", taskScope }) },
        organization: { findUnique: async () => ({ requireAdminForJournalEdit: false }) },
        formFillTiming: { create: async () => ({}) },
      },
    },
    "@/lib/org-trial.server": { orgLockedResponse: async () => null },
    "@/lib/tasksflow-adapters": { getAdapter: () => adapter },
    "@/lib/tasksflow-client": {
      TasksFlowError: class extends Error {},
      tasksflowClientFor: () => ({ completeTask: async () => ({}) }),
    },
  });
  const submit = (values: Record<string, unknown>) =>
    route.POST(
      new Request("http://fixture/api/task-fill/51", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: mintTaskFillToken(51, "secret"), values }),
      }),
      { params: Promise.resolve({ taskId: "51" }) }
    );
  return { rowKeys, submit };
}

function completeRoute(journalCode: string) {
  const { rowKeys, adapter } = recorder();
  const route = load(readFileSync("src/app/api/integrations/tasksflow/complete/route.ts", "utf8"), {
    "@/lib/db": {
      db: {
        auditLog: { findFirst: async () => null, create: async () => ({}) },
        tasksFlowTaskLink: { update: async () => ({}) },
      },
    },
    "@/lib/tasksflow-auth": {
      extractTasksFlowBearer: () => "tfk_key",
      getMatchingTasksFlowIntegrations: async () => [link(journalCode).integration],
      findTaskLinkForAuthorizedIntegrations: async () => ({ integration: link(journalCode).integration, link: link(journalCode) }),
    },
    "@/lib/tasksflow-adapters": { getAdapter: () => adapter },
    "@/lib/tasksflow-claim-mirror": { syncTasksFlowCompletionToClaim: async () => undefined },
  });
  const submit = (values: Record<string, unknown>) =>
    route.POST(
      new Request("http://fixture/api/integrations/tasksflow/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer tfk_key" },
        body: JSON.stringify({ taskId: 51, isCompleted: true, values }),
      })
    );
  return { rowKeys, submit };
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 3));

test("страница задачи: две отправки бракеража одной задачей — две разные строки того же сотрудника", async () => {
  const fixture = taskFillRoute("finished_product", "shared");
  assert.equal((await fixture.submit({ productName: "Блюдо A" })).status, 200);
  await pause();
  assert.equal((await fixture.submit({ productName: "Блюдо B" })).status, 200);
  assert.equal(fixture.rowKeys.length, 2);
  const [first, second] = fixture.rowKeys;
  assert.notEqual(first, second);
  for (const key of fixture.rowKeys) {
    assert.ok(key.startsWith("employee-user1#"), key);
    assert.equal(extractEmployeeId(key), "user1");
  }
});

test("страница задачи: персональный журнал получает ключ задачи как есть", async () => {
  const fixture = taskFillRoute("hygiene", "personal");
  assert.equal((await fixture.submit({ status: "healthy" })).status, 200);
  assert.deepEqual(fixture.rowKeys, ["employee-user1"]);
});

test("complete из TasksFlow: строчный журнал — новая строка на каждую отправку, остальные — ключ как есть", async () => {
  const fixture = completeRoute("intensive_cooling");
  assert.equal((await fixture.submit({ dishName: "Суп" })).status, 200);
  await pause();
  assert.equal((await fixture.submit({ dishName: "Рагу" })).status, 200);
  assert.equal(fixture.rowKeys.length, 2);
  assert.notEqual(fixture.rowKeys[0], fixture.rowKeys[1]);
  assert.ok(fixture.rowKeys.every((key) => extractEmployeeId(key) === "user1"));

  const personal = completeRoute("hygiene");
  assert.equal((await personal.submit({ status: "healthy" })).status, 200);
  assert.deepEqual(personal.rowKeys, ["employee-user1"]);
});

test("complete из TasksFlow: повтор того же запроса до записи дедупа попадает в ту же строку", async () => {
  // TasksFlow повторяет запрос через 30 с; первый ещё идёт (ждёт блокировку
  // документа) — отметки дедупа нет. Ключ строки — от содержимого запроса,
  // поэтому повтор обновляет ту же строку, а не дописывает вторую.
  const fixture = completeRoute("finished_product");
  assert.equal((await fixture.submit({ productName: "Суп" })).status, 200);
  await pause();
  assert.equal((await fixture.submit({ productName: "Суп" })).status, 200);
  assert.equal(fixture.rowKeys.length, 2);
  assert.equal(fixture.rowKeys[0], fixture.rowKeys[1]);
  assert.ok(fixture.rowKeys[0].startsWith("employee-user1#"));
});
