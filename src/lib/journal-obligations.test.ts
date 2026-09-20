import assert from "node:assert/strict";
import test from "node:test";

import {
  getJournalObligationById,
  getManagerObligationSummary,
  listOpenJournalObligationsForUser,
  markJournalObligationOpened,
  syncDailyJournalObligationsForOrganization,
  syncDailyJournalObligationsForUser,
} from "@/lib/journal-obligations";

test("syncDailyJournalObligationsForUser creates obligations only for allowed daily journals", async () => {
  const writes: Array<Record<string, unknown>> = [];

  const obligations = await syncDailyJournalObligationsForUser(
    {
      userId: "user_1",
      organizationId: "org_1",
      now: new Date("2026-04-20T08:00:00.000Z"),
    },
    {
      getUserActor: async () => ({ id: "user_1", role: "cook", isRoot: false }),
      isUserOffOn: async () => false,
      getAllowedJournalCodes: async () => [
        "incoming_control",
        "hygiene",
        "accident_journal",
      ],
      getDisabledJournalCodes: async () => new Set<string>(),
      // Сотрудник допущен до всех шаблонов: этот тест не про белый список.
      getEligibleUserIds: async () => new Set(["user_1"]),
      getBuildingTargets: async () => [null],
      listTemplates: async () => [
        {
          id: "tpl_in",
          code: "incoming_control",
          name: "Incoming control",
          description: null,
          isDocument: false,
        },
        {
          id: "tpl_hy",
          code: "hygiene",
          name: "Hygiene",
          description: null,
          isDocument: true,
        },
        {
          id: "tpl_acc",
          code: "accident_journal",
          name: "Accidents",
          description: null,
          isDocument: false,
        },
      ],
      getTemplateTodaySummary: async (_organizationId, templateId) => ({
        filled: templateId === "tpl_in",
        aperiodic: false,
        todayCount: templateId === "tpl_in" ? 1 : 0,
        expectedCount: 1,
        noActiveDocument: false,
        activeDocumentId: templateId === "tpl_hy" ? "doc_7" : null,
      }),
      listExistingDailyObligations: async () => [],
      deleteStaleDailyObligations: async () => undefined,
      saveDailyObligations: async (rows) => {
        writes.push(...rows);
        return rows;
      },
    }
  );

  assert.equal(obligations.length, 2);
  assert.deepEqual(
    writes.map((row) => [row.journalCode, row.status, row.targetPath]),
    [
      ["incoming_control", "done", "/journals/incoming_control/new"],
      ["hygiene", "pending", "/journals/hygiene"],
    ]
  );
});

test("syncDailyJournalObligationsForUser sends incoming_control to the entry form even when template metadata says document", async () => {
  const obligations = await syncDailyJournalObligationsForUser(
    {
      userId: "user_1",
      organizationId: "org_1",
      now: new Date("2026-04-20T08:00:00.000Z"),
    },
    {
      getUserActor: async () => ({ id: "user_1", role: "cook", isRoot: false }),
      isUserOffOn: async () => false,
      getAllowedJournalCodes: async () => ["incoming_control"],
      getDisabledJournalCodes: async () => new Set<string>(),
      getEligibleUserIds: async () => new Set(["user_1"]),
      getBuildingTargets: async () => [null],
      listTemplates: async () => [
        {
          id: "tpl_in",
          code: "incoming_control",
          name: "Incoming control",
          description: null,
          isDocument: true,
        },
      ],
      getTemplateTodaySummary: async () => ({
        filled: false,
        aperiodic: false,
        todayCount: 0,
        expectedCount: 1,
        noActiveDocument: false,
        activeDocumentId: "doc_7",
      }),
      listExistingDailyObligations: async () => [],
      deleteStaleDailyObligations: async () => undefined,
      saveDailyObligations: async (rows) => rows,
    }
  );

  assert.equal(obligations[0]?.targetPath, "/journals/incoming_control/new");
});

test("syncDailyJournalObligationsForUser clears stale sync rows that are no longer eligible", async () => {
  const deletedIds: string[] = [];

  await syncDailyJournalObligationsForUser(
    {
      userId: "user_1",
      organizationId: "org_1",
      now: new Date("2026-04-20T08:00:00.000Z"),
    },
    {
      getUserActor: async () => ({ id: "user_1", role: "cook", isRoot: false }),
      isUserOffOn: async () => false,
      getAllowedJournalCodes: async () => ["hygiene"],
      getDisabledJournalCodes: async () => new Set<string>(),
      getEligibleUserIds: async () => new Set(["user_1"]),
      getBuildingTargets: async () => [null],
      listTemplates: async () => [
        {
          id: "tpl_hy",
          code: "hygiene",
          name: "Hygiene",
          description: null,
          isDocument: true,
        },
      ],
      listExistingDailyObligations: async () => [
        {
          id: "obl_stale",
          dedupeKey: "daily:2026-04-20:incoming_control",
          status: "pending",
          completedAt: null,
        },
        {
          id: "obl_keep",
          dedupeKey: "daily:2026-04-20:hygiene",
          status: "pending",
          completedAt: null,
        },
      ],
      deleteStaleDailyObligations: async (ids) => {
        deletedIds.push(...ids);
      },
      getTemplateTodaySummary: async () => ({
        filled: false,
        aperiodic: false,
        todayCount: 0,
        expectedCount: 1,
        noActiveDocument: false,
        activeDocumentId: "doc_7",
      }),
      saveDailyObligations: async (rows) => rows,
    }
  );

  assert.deepEqual(deletedIds, ["obl_stale"]);
});

test("syncDailyJournalObligationsForUser preserves the original completedAt when a done obligation stays done", async () => {
  const firstCompletedAt = new Date("2026-04-20T06:15:00.000Z");
  const obligations = await syncDailyJournalObligationsForUser(
    {
      userId: "user_1",
      organizationId: "org_1",
      now: new Date("2026-04-20T08:00:00.000Z"),
    },
    {
      getUserActor: async () => ({ id: "user_1", role: "cook", isRoot: false }),
      isUserOffOn: async () => false,
      getAllowedJournalCodes: async () => ["incoming_control"],
      getDisabledJournalCodes: async () => new Set<string>(),
      getEligibleUserIds: async () => new Set(["user_1"]),
      getBuildingTargets: async () => [null],
      listTemplates: async () => [
        {
          id: "tpl_in",
          code: "incoming_control",
          name: "Incoming control",
          description: null,
          isDocument: false,
        },
      ],
      listExistingDailyObligations: async () => [
        {
          id: "obl_done",
          dedupeKey: "daily:2026-04-20:incoming_control",
          status: "done",
          completedAt: firstCompletedAt,
        },
      ],
      deleteStaleDailyObligations: async () => undefined,
      getTemplateTodaySummary: async () => ({
        filled: true,
        aperiodic: false,
        todayCount: 1,
        expectedCount: 1,
        noActiveDocument: false,
        activeDocumentId: null,
      }),
      saveDailyObligations: async (rows) => rows,
    }
  );

  assert.equal(obligations[0]?.completedAt?.toISOString(), firstCompletedAt.toISOString());
});

test("listOpenJournalObligationsForUser scopes to UTC day start", async () => {
  const calls: Array<{ userId: string; dateKey: Date }> = [];

  const rows = await listOpenJournalObligationsForUser(
    "user_1",
    new Date("2026-04-20T09:12:00.000Z"),
    {
      listOpenRows: async (args) => {
        calls.push(args);
        return [
          {
            id: "obl_1",
            journalCode: "hygiene",
            targetPath: "/journals/hygiene",
            template: { name: "Hygiene", description: null },
          },
        ];
      },
    }
  );

  assert.equal(calls[0]?.userId, "user_1");
  assert.equal(calls[0]?.dateKey.toISOString(), "2026-04-20T00:00:00.000Z");
  assert.equal(rows.length, 1);
});

test("listOpenJournalObligationsForUser returns pending obligations ordered by journal name", async () => {
  const rows = await listOpenJournalObligationsForUser(
    "user_1",
    new Date("2026-04-20T09:00:00.000Z"),
    {
      listOpenRows: async () => [
        {
          id: "2",
          journalCode: "hygiene",
          targetPath: "/journals/hygiene",
          template: { name: "Beta", description: "Shift" },
        },
        {
          id: "1",
          journalCode: "incoming_control",
          targetPath: "/journals/incoming_control/new",
          template: { name: "Alpha", description: null },
        },
      ],
    }
  );

  assert.deepEqual(
    rows.map((row) => row.id),
    ["1", "2"]
  );
});

test("getJournalObligationById returns only the caller-owned obligation", async () => {
  const obligation = await getJournalObligationById("obl_1", "user_1", {
    findObligationById: async (id, userId) =>
      id === "obl_1" && userId === "user_1"
        ? {
            id,
            userId,
            targetPath: "/journals/hygiene",
            openedAt: null,
          }
        : null,
  });

  assert.equal(obligation?.targetPath, "/journals/hygiene");
});

test("markJournalObligationOpened delegates to the injected marker", async () => {
  const calls: Array<[string, string]> = [];

  await markJournalObligationOpened("obl_1", "user_1", {
    markOpened: async (id, userId) => {
      calls.push([id, userId]);
    },
  });

  assert.deepEqual(calls, [["obl_1", "user_1"]]);
});

test("syncDailyJournalObligationsForOrganization syncs each active staff user", async () => {
  const calls: Array<{ userId: string; organizationId: string }> = [];

  await syncDailyJournalObligationsForOrganization(
    "org_1",
    new Date("2026-04-20T08:00:00.000Z"),
    {
      listActiveStaffUsers: async () => [
        { id: "user_1", organizationId: "org_1" },
        { id: "user_2", organizationId: "org_1" },
      ],
      getUserActor: async (userId) => ({ id: userId, role: "cook", isRoot: false }),
      isUserOffOn: async () => false,
      getAllowedJournalCodes: async () => ["hygiene"],
      getDisabledJournalCodes: async () => new Set<string>(),
      getEligibleUserIds: async () => new Set(["user_1", "user_2"]),
      getBuildingTargets: async () => [null],
      listTemplates: async () => [
        {
          id: "tpl_hy",
          code: "hygiene",
          name: "Hygiene",
          description: null,
          isDocument: true,
        },
      ],
      getTemplateTodaySummary: async () => ({
        filled: false,
        aperiodic: false,
        todayCount: 0,
        expectedCount: 1,
        noActiveDocument: false,
        activeDocumentId: "doc_7",
      }),
      listExistingDailyObligations: async () => [],
      deleteStaleDailyObligations: async () => undefined,
      saveDailyObligations: async (rows) => {
        calls.push({
          userId: String(rows[0]?.userId),
          organizationId: String(rows[0]?.organizationId),
        });
        return rows;
      },
    }
  );

  assert.deepEqual(
    calls.sort((a, b) => a.userId.localeCompare(b.userId)),
    [
      { userId: "user_1", organizationId: "org_1" },
      { userId: "user_2", organizationId: "org_1" },
    ]
  );
});

test("getManagerObligationSummary counts pending rows and distinct employees", async () => {
  const summary = await getManagerObligationSummary(
    "org_1",
    new Date("2026-04-20T11:00:00.000Z"),
    {
      listSummaryRows: async () => [
        { userId: "user_1", status: "pending" },
        { userId: "user_1", status: "done" },
        { userId: "user_2", status: "pending" },
      ],
    }
  );

  assert.deepEqual(summary, {
    total: 3,
    pending: 2,
    done: 1,
    employeesWithPending: 2,
  });
});

test("syncDailyJournalObligationsForUser skips templates the employee is not eligible for", async () => {
  // Белый список должностей — единственное, что не даёт уборщице получить
  // задачу по фритюру. Без этой проверки регресс в фильтре виден только
  // в проде, и виден он сотруднику.
  const saved: unknown[][] = [];

  await syncDailyJournalObligationsForUser(
    {
      userId: "user_1",
      organizationId: "org_1",
      now: new Date("2026-04-20T08:00:00.000Z"),
    },
    {
      getUserActor: async () => ({ id: "user_1", role: "cook", isRoot: false }),
      isUserOffOn: async () => false,
      getAllowedJournalCodes: async () => ["hygiene", "fryer_oil"],
      getDisabledJournalCodes: async () => new Set<string>(),
      listTemplates: async () => [
        {
          id: "tpl_hy",
          code: "hygiene",
          name: "Hygiene",
          description: null,
          isDocument: true,
        },
        {
          id: "tpl_fry",
          code: "fryer_oil",
          name: "Fryer oil",
          description: null,
          isDocument: true,
        },
      ],
      getEligibleUserIds: async (_organizationId, templateId) =>
        templateId === "tpl_hy" ? new Set(["user_1"]) : new Set(["user_9"]),
      getBuildingTargets: async () => [null],
      listExistingDailyObligations: async () => [],
      deleteStaleDailyObligations: async () => {},
      getTemplateTodaySummary: async () => ({
        filled: false,
        aperiodic: false,
        todayCount: 0,
        expectedCount: 1,
        noActiveDocument: false,
        activeDocumentId: "doc_7",
      }),
      saveDailyObligations: async (rows) => {
        saved.push(rows as unknown[]);
        return rows;
      },
    }
  );

  const codes = (saved[0] ?? []).map(
    (row) => (row as { journalCode?: string }).journalCode
  );
  assert.deepEqual(codes, ["hygiene"]);
});
