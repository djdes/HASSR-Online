import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildDocumentTaskDeleteCommands } from "@/lib/journal-document-tasks-cleanup";

const args = (links: { integrationId: string; tasksflowTaskId: number }[]) => ({
  organizationId: "org-1",
  journalDocumentId: "doc-1",
  links,
});

describe("buildDocumentTaskDeleteCommands", () => {
  it("на каждую задачу — команда удаления с ключом идемпотентности", () => {
    const got = buildDocumentTaskDeleteCommands(
      args([
        { integrationId: "tf-1", tasksflowTaskId: 11 },
        { integrationId: "tf-1", tasksflowTaskId: 12 },
      ])
    );
    assert.equal(got.length, 2);
    assert.equal(got[0].action, "deleteTask");
    assert.equal(got[0].organizationId, "org-1");
    assert.equal(got[0].idempotencyKey, "doc-delete::doc-1::11");
    assert.deepEqual(got[0].payload, {
      taskId: 11,
      journalDocumentId: "doc-1",
      reason: "document-deleted",
    });
  });

  it("ключи разные у разных задач и одинаковые при повторе удаления", () => {
    const first = buildDocumentTaskDeleteCommands(
      args([{ integrationId: "tf-1", tasksflowTaskId: 11 }])
    );
    const second = buildDocumentTaskDeleteCommands(
      args([{ integrationId: "tf-1", tasksflowTaskId: 11 }])
    );
    assert.equal(first[0].idempotencyKey, second[0].idempotencyKey);
  });

  it("повтор того же taskId в двух строках связи даёт одну команду", () => {
    const got = buildDocumentTaskDeleteCommands(
      args([
        { integrationId: "tf-1", tasksflowTaskId: 11 },
        { integrationId: "tf-1", tasksflowTaskId: 11 },
      ])
    );
    assert.equal(got.length, 1);
  });

  it("битые строки связи пропускаются", () => {
    const got = buildDocumentTaskDeleteCommands(
      args([
        { integrationId: "tf-1", tasksflowTaskId: 0 },
        { integrationId: "tf-1", tasksflowTaskId: -5 },
        { integrationId: "", tasksflowTaskId: 7 },
        { integrationId: "tf-1", tasksflowTaskId: 1.5 },
      ])
    );
    assert.deepEqual(got, []);
  });

  it("несколько интеграций — команда уходит в свою очередь", () => {
    const got = buildDocumentTaskDeleteCommands(
      args([
        { integrationId: "tf-1", tasksflowTaskId: 11 },
        { integrationId: "tf-2", tasksflowTaskId: 12 },
      ])
    );
    assert.deepEqual(
      got.map((command) => command.integrationId),
      ["tf-1", "tf-2"]
    );
  });

  it("документ без задач — пустой список", () => {
    assert.deepEqual(buildDocumentTaskDeleteCommands(args([])), []);
  });
});
