import assert from "node:assert/strict";
import test from "node:test";

import { loadTelegramStartHome } from "@/lib/bot/start-home";

test("loadTelegramStartHome returns unlinked for chats without a linked user", async () => {
  const home = await loadTelegramStartHome(
    {
      chatId: "777",
      miniAppBaseUrl: "https://wesetup.ru/mini",
    },
    {
      findLinkedUserByChatId: async () => null,
    }
  );

  assert.deepEqual(home, { kind: "unlinked" });
});

test("loadTelegramStartHome gives staff the next open obligation url and reuses one request timestamp", async () => {
  const syncCalls: Date[] = [];
  const listCalls: Date[] = [];

  const home = await loadTelegramStartHome(
    {
      chatId: "777",
      miniAppBaseUrl: "https://wesetup.ru/mini",
    },
    {
      findLinkedUserByChatId: async () => ({
        id: "user_1",
        name: "Ivan",
        role: "cook",
        isRoot: false,
        organizationId: "org_1",
        permissionsJson: null,
        jobPosition: {
          categoryKey: "staff",
          permissionsJson: null,
        },
      }),
      syncDailyJournalObligationsForUser: async (args) => {
        if (!args.now) {
          throw new Error("expected request-scoped now for staff sync");
        }
        syncCalls.push(args.now);
        return [];
      },
      listOpenJournalObligationsForUser: async (_userId, now) => {
        if (!now) {
          throw new Error("expected request-scoped now for staff reads");
        }
        listCalls.push(now);
        return [
          {
            id: "obl_1",
            journalCode: "incoming_control",
            targetPath: "/mini/journals/incoming_control/new",
            template: { name: "Incoming control", description: null },
          },
        ];
      },
      syncDailyJournalObligationsForOrganization: async () => undefined,
      getManagerObligationSummary: async () => ({
        total: 0,
        pending: 0,
        done: 0,
        employeesWithPending: 0,
      }),
      getUserPermissions: async () => new Set(["journals.fill", "journals.view"]),
      getManagerScope: async () => null,
      getManagerPointScope: async () => null,
    }
  );

  assert.equal(home.kind, "staff");
  if (home.kind !== "staff") {
    throw new Error("expected staff home");
  }

  assert.equal(syncCalls.length, 1);
  assert.equal(listCalls.length, 1);
  assert.equal(syncCalls[0], listCalls[0]);
  assert.equal(home.nextAction?.label, "Incoming control");
  assert.equal(home.nextAction?.journalCode, "incoming_control");
  assert.equal(home.buttonUrl, "https://wesetup.ru/mini/o/obl_1");
});

test("loadTelegramStartHome gives managers a summary and reuses one request timestamp", async () => {
  const syncCalls: Date[] = [];
  const summaryCalls: Date[] = [];

  const home = await loadTelegramStartHome(
    {
      chatId: "888",
      miniAppBaseUrl: "https://wesetup.ru/mini",
    },
    {
      findLinkedUserByChatId: async () => ({
        id: "user_2",
        name: "Olga",
        role: "manager",
        isRoot: false,
        organizationId: "org_1",
        permissionsJson: null,
        jobPosition: {
          categoryKey: "management",
          permissionsJson: null,
        },
      }),
      syncDailyJournalObligationsForUser: async () => [],
      listOpenJournalObligationsForUser: async () => [],
      syncDailyJournalObligationsForOrganization: async (_organizationId, now) => {
        if (!now) {
          throw new Error("expected request-scoped now for manager sync");
        }
        syncCalls.push(now);
      },
      getManagerObligationSummary: async (_organizationId, now) => {
        if (!now) {
          throw new Error("expected request-scoped now for manager summary");
        }
        summaryCalls.push(now);
        return {
          total: 10,
          pending: 4,
          done: 6,
          employeesWithPending: 2,
        };
      },
      getUserPermissions: async () =>
        new Set(["dashboard.view", "staff.manage", "journals.fill"]),
      getManagerScope: async () => null,
      getManagerPointScope: async () => null,
    }
  );

  assert.equal(home.kind, "manager");
  if (home.kind !== "manager") {
    throw new Error("expected manager home");
  }

  assert.equal(syncCalls.length, 1);
  assert.equal(summaryCalls.length, 1);
  assert.equal(syncCalls[0], summaryCalls[0]);
  assert.deepEqual(home.summary, {
    total: 10,
    pending: 4,
    done: 6,
    employeesWithPending: 2,
  });
  assert.equal(home.buttonUrl, "https://wesetup.ru/mini");
});

test("loadTelegramStartHome filters obligations by manager scope assignableJournalCodes", async () => {
  const home = await loadTelegramStartHome(
    {
      chatId: "777",
      miniAppBaseUrl: "https://wesetup.ru/mini",
    },
    {
      findLinkedUserByChatId: async () => ({
        id: "user_1",
        name: "Ivan",
        role: "cook",
        isRoot: false,
        organizationId: "org_1",
        permissionsJson: null,
        jobPosition: {
          categoryKey: "staff",
          permissionsJson: null,
        },
      }),
      syncDailyJournalObligationsForUser: async () => [],
      listOpenJournalObligationsForUser: async () => [
        {
          id: "obl_1",
          journalCode: "incoming_control",
          targetPath: "/mini/journals/incoming_control/new",
          template: { name: "Incoming control", description: null },
        },
        {
          id: "obl_2",
          journalCode: "hygiene",
          targetPath: "/mini/journals/hygiene/new",
          template: { name: "Hygiene", description: null },
        },
      ],
      syncDailyJournalObligationsForOrganization: async () => undefined,
      getManagerObligationSummary: async () => ({
        total: 0,
        pending: 0,
        done: 0,
        employeesWithPending: 0,
      }),
      getUserPermissions: async () => new Set(["journals.fill", "journals.view"]),
      getManagerScope: async () => ({
        id: "scope_1",
        managerId: "user_1",
        viewMode: "all" as const,
        viewJobPositionIds: [],
        viewUserIds: [],
        assignableJournalCodes: ["hygiene"],
      }),
    }
  );

  assert.equal(home.kind, "staff");
  if (home.kind !== "staff") throw new Error("expected staff home");
  assert.equal(home.nextAction?.journalCode, "hygiene");
  assert.equal(home.buttonUrl, "https://wesetup.ru/mini/o/obl_2");
});

test("loadTelegramStartHome gives readonly mode for users without journals.fill", async () => {
  const home = await loadTelegramStartHome(
    {
      chatId: "999",
      miniAppBaseUrl: "https://wesetup.ru/mini",
    },
    {
      findLinkedUserByChatId: async () => ({
        id: "user_3",
        name: "Auditor",
        role: "cook",
        isRoot: false,
        organizationId: "org_1",
        permissionsJson: ["journals.view"],
        jobPosition: {
          categoryKey: "staff",
          permissionsJson: null,
        },
      }),
      syncDailyJournalObligationsForUser: async () => [],
      listOpenJournalObligationsForUser: async () => [],
      syncDailyJournalObligationsForOrganization: async () => undefined,
      getManagerObligationSummary: async () => ({
        total: 0,
        pending: 0,
        done: 0,
        employeesWithPending: 0,
      }),
      getUserPermissions: async () => new Set(["journals.view"]),
      getManagerScope: async () => null,
      getManagerPointScope: async () => null,
    }
  );

  assert.equal(home.kind, "readonly");
  if (home.kind !== "readonly") {
    throw new Error("expected readonly home");
  }
  assert.equal(home.buttonUrl, "https://wesetup.ru/mini");
});

test("loadTelegramStartHome: руководитель точки получает сводку только по своим точкам", async () => {
  const scoped: unknown[] = [];
  const home = await loadTelegramStartHome(
    { chatId: "889", miniAppBaseUrl: "https://wesetup.ru/mini" },
    {
      findLinkedUserByChatId: async () => ({
        id: "user_point",
        name: "Ирина",
        role: "manager",
        isRoot: false,
        organizationId: "org_1",
        permissionsJson: null,
        jobPosition: { categoryKey: "management", permissionsJson: null },
      }),
      syncDailyJournalObligationsForOrganization: async () => undefined,
      getManagerObligationSummary: async () => {
        throw new Error("org-wide summary must not be used for a point manager");
      },
      getManagerPointScope: async () => ({ points: ["A"], orgBuildingIds: ["A", "B"] }),
      scopedManagerObligationSummary: async (_org, _now, scope) => {
        scoped.push(scope);
        return { total: 3, pending: 1, done: 2, employeesWithPending: 1 };
      },
      getUserPermissions: async () => new Set(["dashboard.view", "staff.manage"]),
      getManagerScope: async () => null,
    }
  );
  assert.equal(home.kind, "manager");
  assert.deepEqual(scoped, [{ points: ["A"], orgBuildingIds: ["A", "B"] }]);
  if (home.kind === "manager") assert.equal(home.summary.total, 3);
});
