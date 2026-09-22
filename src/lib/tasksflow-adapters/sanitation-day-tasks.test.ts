import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyTaskCompletion,
  gcCompleteIdempotencyKey,
  gcCreateIdempotencyKey,
  gcDeleteIdempotencyKey,
  gcRowKey,
  gcTaskTitle,
  isGeneralCleaningDatePlanned,
  nextOpenCleaning,
  parseGcRowKey,
  planGeneralCleaningTasks,
  type GcPlanInput,
} from "@/lib/tasksflow-adapters/sanitation-day-tasks";
import { normalizeSanitationDayConfig } from "@/lib/sanitation-day-document";

const TODAY = "2026-09-25"; // пятница

const config = normalizeSanitationDayConfig({
  year: 2026,
  responsibleEmployeeId: "resp",
  rows: [
    {
      id: "r1",
      roomId: "R1",
      roomName: "Кухня",
      cleanings: [
        { planned: "2026-09-18", done: "2026-09-18", doneSource: "manual" },
        { planned: "2026-09-25", done: null },
        { planned: "2026-10-02", done: null },
      ],
    },
    {
      id: "r2",
      roomId: "R2",
      roomName: "Склад",
      cleanings: [{ planned: "2026-09-25", done: null }],
    },
    {
      id: "r3",
      roomName: "Без связи",
      cleanings: [{ planned: "2026-09-25", done: null }],
    },
  ],
});

function input(overrides: Partial<GcPlanInput> = {}): GcPlanInput {
  return {
    documentId: "doc1",
    documentTitle: "График ген. уборок — 2026 год",
    integrationId: "int1",
    baseUrl: "https://wesetup.ru",
    todayKey: TODAY,
    config,
    rooms: new Map([
      ["R1", { cleanerUserIds: ["cleaner"], verifierUserIds: ["boss"], requirePhoto: true }],
      ["R2", { cleanerUserIds: [], verifierUserIds: ["resp"], requirePhoto: false }],
    ]),
    responsibleUserId: "resp",
    tfUserIdByWesetupId: new Map([
      ["cleaner", 11],
      ["boss", 22],
      ["resp", 33],
    ]),
    links: [],
    ...overrides,
  };
}

describe("ключи", () => {
  it("rowKey задачи на дату и обратно", () => {
    assert.equal(gcRowKey("r1", "2026-09-25"), "gc::r1::2026-09-25");
    assert.deepEqual(parseGcRowKey("gc::row-room-a::b::2026-09-25"), {
      rowId: "row-room-a::b",
      dateKey: "2026-09-25",
    });
    assert.equal(parseGcRowKey("r1"), null);
    assert.equal(parseGcRowKey("gc::r1::25.09"), null);
  });

  it("ключи идемпотентности outbox", () => {
    assert.equal(gcCreateIdempotencyKey("d", "r1", "2026-09-25"), "gc-create::d::r1::2026-09-25");
    assert.equal(gcDeleteIdempotencyKey("d", 5), "gc-delete::d::5");
    assert.equal(gcCompleteIdempotencyKey("d", 5), "gc-complete::d::5");
  });

  it("название задачи", () => {
    assert.equal(gcTaskTitle("Кухня", "2026-09-25"), "Генеральная уборка · Кухня · 25.09 (пт)");
    assert.equal(
      gcTaskTitle("Кухня", "2026-09-25", "Точка 2"),
      "Генеральная уборка · Кухня · 25.09 (пт) · Точка 2",
    );
  });
});

describe("planGeneralCleaningTasks", () => {
  it("задача на сегодня: уборщик помещения, проверяющий, разовая", () => {
    const plan = planGeneralCleaningTasks(input());
    assert.equal(plan.create.length, 2);
    const kitchen = plan.create[0];
    assert.equal(kitchen.rowKey, "gc::r1::2026-09-25");
    assert.equal(kitchen.idempotencyKey, "gc-create::doc1::r1::2026-09-25");
    assert.equal(kitchen.assigneeUserId, "cleaner");
    assert.equal(kitchen.task.workerId, 11);
    assert.equal(kitchen.task.verifierWorkerId, 22);
    assert.equal(kitchen.task.isRecurring, false);
    assert.equal(kitchen.task.requiresPhoto, true);
    assert.equal(kitchen.task.title, "Генеральная уборка · Кухня · 25.09 (пт)");
    const link = JSON.parse(kitchen.task.journalLink as string);
    assert.deepEqual(link, {
      kind: "wesetup-general_cleaning",
      baseUrl: "https://wesetup.ru",
      integrationId: "int1",
      documentId: "doc1",
      rowKey: "gc::r1::2026-09-25",
      label: "Генеральная уборка · Кухня · 25.09 (пт)",
      isFreeText: false,
      bonusAmountKopecks: 0,
      taskScope: "personal",
      siblingVisibility: false,
    });
    // Склад без уборщика — ответственный документа; проверяющий тот же
    // человек — без самопроверки.
    const storage = plan.create[1];
    assert.equal(storage.assigneeUserId, "resp");
    assert.equal(storage.task.workerId, 33);
    assert.equal(storage.task.verifierWorkerId, undefined);
    // Строка без связи с помещением задач не получает.
    assert.deepEqual(plan.skippedNoRoom, ["r3"]);
  });

  it("уже созданная, выполненная и не сегодняшняя — не создаются", () => {
    const plan = planGeneralCleaningTasks(
      input({
        todayKey: "2026-09-18",
      }),
    );
    assert.equal(plan.create.length, 0);
    const linked = planGeneralCleaningTasks(
      input({
        links: [{ id: "l1", rowKey: "gc::r1::2026-09-25", tasksflowTaskId: 101, remoteStatus: "active" }],
      }),
    );
    assert.deepEqual(linked.create.map((c) => c.rowKey), ["gc::r2::2026-09-25"]);
  });

  it("исполнитель без TasksFlow — пропуск с причиной", () => {
    const plan = planGeneralCleaningTasks(input({ tfUserIdByWesetupId: new Map([["resp", 33]]) }));
    assert.deepEqual(plan.skippedNoLink, ["gc::r1::2026-09-25"]);
    assert.deepEqual(plan.create.map((c) => c.rowKey), ["gc::r2::2026-09-25"]);
  });

  it("дату убрали из плана — задачу удаляем; выполненную в TF — не трогаем", () => {
    const plan = planGeneralCleaningTasks(
      input({
        links: [
          { id: "l1", rowKey: "gc::r1::2026-09-24", tasksflowTaskId: 101, remoteStatus: "active" },
          { id: "l2", rowKey: "gc::r1::2026-09-23", tasksflowTaskId: 102, remoteStatus: "completed" },
          { id: "l3", rowKey: "verifier-summary:doc1", tasksflowTaskId: 103, remoteStatus: "active", kind: "verifier" },
          { id: "l4", rowKey: "r1", tasksflowTaskId: 104, remoteStatus: "active" },
        ],
      }),
    );
    assert.deepEqual(plan.remove, [
      { linkId: "l1", rowKey: "gc::r1::2026-09-24", taskId: 101, idempotencyKey: "gc-delete::doc1::101" },
    ]);
  });

  it("руководитель отметил в журнале — задачу закрываем в TF", () => {
    const plan = planGeneralCleaningTasks(
      input({
        links: [
          { id: "l1", rowKey: "gc::r1::2026-09-18", tasksflowTaskId: 101, remoteStatus: "active" },
          { id: "l2", rowKey: "gc::r1::2026-09-25", tasksflowTaskId: 102, remoteStatus: "active" },
        ],
      }),
    );
    assert.deepEqual(plan.complete, [
      { linkId: "l1", rowKey: "gc::r1::2026-09-18", taskId: 101, idempotencyKey: "gc-complete::doc1::101" },
    ]);
    assert.deepEqual(plan.remove, []);
    // Отметка пришла из самой задачи или задача уже закрыта — ничего.
    const taskDone = normalizeSanitationDayConfig({
      year: 2026,
      rows: [{ id: "r1", roomId: "R1", roomName: "Кухня", cleanings: [{ planned: "2026-09-18", done: "2026-09-18", doneSource: "task" }] }],
    });
    assert.deepEqual(
      planGeneralCleaningTasks(
        input({
          config: taskDone,
          links: [{ id: "l1", rowKey: "gc::r1::2026-09-18", tasksflowTaskId: 101, remoteStatus: "active" }],
        }),
      ).complete,
      [],
    );
  });
});

describe("isGeneralCleaningDatePlanned / nextOpenCleaning", () => {
  it("дата в плане и не выполнена", () => {
    assert.equal(isGeneralCleaningDatePlanned(config, "r1", "2026-09-25"), true);
    assert.equal(isGeneralCleaningDatePlanned(config, "r1", "2026-09-18"), false);
    assert.equal(isGeneralCleaningDatePlanned(config, "r1", "2026-09-26"), false);
    assert.equal(isGeneralCleaningDatePlanned(config, "zzz", "2026-09-25"), false);
  });

  it("ближайшая открытая уборка строки", () => {
    assert.equal(nextOpenCleaning(config.rows[0], TODAY)?.planned, "2026-09-25");
    assert.equal(nextOpenCleaning(config.rows[0], "2026-09-26")?.planned, "2026-10-02");
    assert.equal(nextOpenCleaning(config.rows[0], "2026-10-03"), null);
  });
});

describe("applyTaskCompletion", () => {
  it("задача на дату закрывает ровно эту уборку днём выполнения", () => {
    const result = applyTaskCompletion(config, {
      rowKey: "gc::r1::2026-09-25",
      doneKey: "2026-09-26",
      completed: true,
    });
    assert.equal(result.changed, true);
    const slot = result.config.rows[0].cleanings.find((c) => c.id === "p:2026-09-25")!;
    assert.equal(slot.done, "2026-09-26");
    assert.equal(slot.doneSource, "task");
    // Повтор — без изменений.
    assert.equal(
      applyTaskCompletion(result.config, { rowKey: "gc::r1::2026-09-25", doneKey: "2026-09-26", completed: true }).changed,
      false,
    );
    // Отмена в TF снимает только отметку задачи.
    const undone = applyTaskCompletion(result.config, {
      rowKey: "gc::r1::2026-09-25",
      doneKey: "2026-09-26",
      completed: false,
    });
    assert.equal(undone.config.rows[0].cleanings.find((c) => c.id === "p:2026-09-25")!.done, null);
    assert.equal(
      applyTaskCompletion(config, { rowKey: "gc::r1::2026-09-18", doneKey: TODAY, completed: false }).changed,
      false,
    );
  });

  it("дату успели убрать из плана — выполнение остаётся внеплановым", () => {
    const result = applyTaskCompletion(config, {
      rowKey: "gc::r1::2026-09-24",
      doneKey: "2026-09-24",
      completed: true,
    });
    assert.ok(result.config.rows[0].cleanings.some((c) => c.id === "u:2026-09-24" && c.doneSource === "task"));
  });

  it("QR по строке: ближайшая прошедшая открытая, иначе будущая в пределах недели, иначе внеплановая", () => {
    const today = applyTaskCompletion(config, { rowKey: "r1", doneKey: TODAY, completed: true });
    assert.equal(today.config.rows[0].cleanings.find((c) => c.id === "p:2026-09-25")!.done, TODAY);
    const early = applyTaskCompletion(config, { rowKey: "r1", doneKey: "2026-09-23", completed: true });
    assert.equal(early.config.rows[0].cleanings.find((c) => c.id === "p:2026-09-25")!.done, "2026-09-23");
    const nothingNear = applyTaskCompletion(config, { rowKey: "r1", doneKey: "2026-09-10", completed: true });
    assert.ok(nothingNear.config.rows[0].cleanings.some((c) => c.id === "u:2026-09-10"));
    // Второе сканирование в тот же день — без изменений.
    assert.equal(applyTaskCompletion(today.config, { rowKey: "r1", doneKey: TODAY, completed: true }).changed, false);
    // Отмена снимает отметку этого дня.
    const undone = applyTaskCompletion(today.config, { rowKey: "r1", doneKey: TODAY, completed: false });
    assert.equal(undone.config.rows[0].cleanings.find((c) => c.id === "p:2026-09-25")!.done, null);
  });

  it("чужая строка или год — без изменений", () => {
    assert.equal(applyTaskCompletion(config, { rowKey: "zzz", doneKey: TODAY, completed: true }).changed, false);
    assert.equal(applyTaskCompletion(config, { rowKey: "r1", doneKey: "2027-01-05", completed: true }).changed, false);
  });
});
