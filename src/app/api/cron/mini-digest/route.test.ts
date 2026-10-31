import assert from "node:assert/strict";
import test from "node:test";

import { runMiniDigestCron } from "@/app/api/cron/mini-digest/route";

const REQUEST_NOW = new Date("2026-04-20T06:30:00.000Z");
const MINI_APP_BASE_URL = "https://wesetup.ru/mini";

test("runMiniDigestCron syncs each organization once and sends only staff digests with exact obligation CTA", async () => {
  const syncCalls: Array<{ organizationId: string; now: Date }> = [];
  const listCalls: Array<{ userId: string; now: Date }> = [];
  const notifyCalls: Array<{
    userId: string;
    text: string;
    action:
      | {
          label: string;
          miniAppUrl: string;
        }
      | undefined;
    opts:
      | {
          delivery?: { kind?: string | null; dedupeKey?: string | null } | null;
          policy?: { skipOnRerun?: boolean; now?: Date };
        }
      | undefined;
  }> = [];

  const result = await runMiniDigestCron(
    {
      miniAppBaseUrl: MINI_APP_BASE_URL,
      now: REQUEST_NOW,
    },
    {
      listLinkedTelegramUsers: async () => [
        {
          id: "staff_1",
          name: "Ivan",
          role: "cook",
          isRoot: false,
          organizationId: "org_1",
        },
        {
          id: "staff_2",
          name: "Oleg",
          role: "waiter",
          isRoot: false,
          organizationId: "org_1",
        },
        {
          id: "staff_3",
          name: "Anna",
          role: "cook",
          isRoot: false,
          organizationId: "org_2",
        },
      ],
      listOrganizationsByIds: async (organizationIds) =>
        organizationIds.map((organizationId) => ({
          id: organizationId,
          name: organizationId === "org_1" ? "Org 1" : "Org 2",
        })),
      syncDailyJournalObligationsForOrganization: async (organizationId, now) => {
        if (!now) {
          throw new Error("expected request-scoped now for organization sync");
        }
        syncCalls.push({ organizationId, now });
      },
      listOpenJournalObligationsForUser: async (userId, now) => {
        if (!now) {
          throw new Error("expected request-scoped now for staff lookup");
        }
        listCalls.push({ userId, now });
        if (userId !== "staff_1") {
          return [];
        }

        return [
          {
            id: "obl_1",
            journalCode: "incoming_control",
            targetPath: "/mini/journals/incoming_control/new",
            template: { name: "Incoming control", description: null },
          },
          {
            id: "obl_2",
            journalCode: "hygiene",
            targetPath: "/mini/journals/hygiene",
            template: { name: "Hygiene", description: "Shift" },
          },
        ];
      },
      getManagerObligationSummary: async () => ({
        total: 0,
        pending: 0,
        done: 0,
        employeesWithPending: 0,
      }),
      notifyEmployee: async (userId, text, action, opts) => {
        notifyCalls.push({ userId, text, action, opts });
      },
    }
  );

  assert.deepEqual(syncCalls, [
    { organizationId: "org_1", now: REQUEST_NOW },
    { organizationId: "org_2", now: REQUEST_NOW },
  ]);
  assert.deepEqual(listCalls, [
    { userId: "staff_1", now: REQUEST_NOW },
    { userId: "staff_2", now: REQUEST_NOW },
    { userId: "staff_3", now: REQUEST_NOW },
  ]);
  assert.equal(notifyCalls.length, 1);
  assert.equal(notifyCalls[0]?.userId, "staff_1");
  assert.match(notifyCalls[0]?.text ?? "", /Открыто задач: 2/);
  assert.deepEqual(notifyCalls[0]?.action, {
    label: "Открыть задачу",
    miniAppUrl: "https://wesetup.ru/mini/o/obl_1",
  });
  assert.deepEqual(notifyCalls[0]?.opts, {
    delivery: {
      organizationId: "org_1",
      kind: "digest.staff",
      dedupeKey: "telegram-digest:staff:2026-04-20:staff_1",
    },
    policy: {
      skipOnRerun: true,
      now: REQUEST_NOW,
    },
    // Дайджест приходит утром и живёт в чате весь день: «отложить» уносит
    // напоминание на потом, «обновить» перечитывает задачи, не дожидаясь
    // следующего крона. Без них человек листает историю чата.
    addSnoozeButton: true,
    addRefreshButton: true,
  });
  assert.deepEqual(result, {
    ok: true,
    checkedUsers: 3,
    organizationsChecked: 2,
    notifiedStaff: 1,
    notifiedManagers: 0,
    notified: 1,
  });
});

test("runMiniDigestCron sends manager and root digests once per organization with rerun-safe metadata", async () => {
  const summaryCalls: Array<{ organizationId: string; now: Date }> = [];
  const notifyCalls: Array<{
    userId: string;
    text: string;
    action:
      | {
          label: string;
          miniAppUrl: string;
        }
      | undefined;
    opts:
      | {
          delivery?: { kind?: string | null; dedupeKey?: string | null } | null;
          policy?: { skipOnRerun?: boolean; now?: Date };
        }
      | undefined;
  }> = [];

  const result = await runMiniDigestCron(
    {
      miniAppBaseUrl: MINI_APP_BASE_URL,
      now: REQUEST_NOW,
    },
    {
      listLinkedTelegramUsers: async () => [
        {
          id: "manager_1",
          name: "Olga",
          role: "manager",
          isRoot: false,
          organizationId: "org_1",
        },
        {
          id: "root_1",
          name: "Root",
          role: "manager",
          isRoot: true,
          organizationId: "org_1",
        },
        {
          id: "manager_2",
          name: "Petr",
          role: "manager",
          isRoot: false,
          organizationId: "org_2",
        },
      ],
      listOrganizationsByIds: async () => [
        { id: "org_1", name: "Kitchen 21" },
        { id: "org_2", name: "Kitchen 22" },
      ],
      syncDailyJournalObligationsForOrganization: async () => undefined,
      listOpenJournalObligationsForUser: async () => [],
      getManagerObligationSummary: async (organizationId, now) => {
        if (!now) {
          throw new Error("expected request-scoped now for manager summary");
        }
        summaryCalls.push({ organizationId, now });
        if (organizationId === "org_1") {
          return {
            total: 10,
            pending: 4,
            done: 6,
            employeesWithPending: 2,
          };
        }
        return {
          total: 0,
          pending: 0,
          done: 0,
          employeesWithPending: 0,
        };
      },
      notifyEmployee: async (userId, text, action, opts) => {
        notifyCalls.push({ userId, text, action, opts });
      },
    }
  );

  assert.deepEqual(summaryCalls, [
    { organizationId: "org_1", now: REQUEST_NOW },
    { organizationId: "org_2", now: REQUEST_NOW },
  ]);
  assert.equal(notifyCalls.length, 2);
  assert.deepEqual(
    notifyCalls.map((call) => call.userId),
    ["manager_1", "root_1"]
  );
  assert.match(notifyCalls[0]?.text ?? "", /Открыто: 4/);
  assert.deepEqual(notifyCalls[0]?.action, {
    label: "Открыть кабинет",
    miniAppUrl: MINI_APP_BASE_URL,
  });
  assert.deepEqual(notifyCalls[0]?.opts, {
    delivery: {
      organizationId: "org_1",
      kind: "digest.manager",
      dedupeKey: "telegram-digest:manager:2026-04-20:org_1",
    },
    policy: {
      skipOnRerun: true,
      now: REQUEST_NOW,
    },
  });
  assert.equal(notifyCalls[0]?.text, notifyCalls[1]?.text);
  assert.deepEqual(result, {
    ok: true,
    checkedUsers: 3,
    organizationsChecked: 2,
    notifiedStaff: 0,
    notifiedManagers: 2,
    notified: 2,
  });
});

test("руководитель одной точки получает сводку своей точки, руководство на всю сеть — общую", async () => {
  const summaryCalls: Array<{ organizationId: string; buildingId: string | null }> = [];
  const notifyCalls: Array<{ userId: string; text: string }> = [];
  await runMiniDigestCron(
    { miniAppBaseUrl: MINI_APP_BASE_URL, now: REQUEST_NOW },
    {
      listLinkedTelegramUsers: async () => [
        { id: "owner", name: "Owner", role: "manager", isRoot: false, organizationId: "org_1", buildingIds: [] },
        { id: "point_head", name: "Anna", role: "manager", isRoot: false, organizationId: "org_1", buildingIds: ["b-2"] },
        // Висящая удалённая точка не делает сводку точечной.
        { id: "stale", name: "Old", role: "manager", isRoot: false, organizationId: "org_1", buildingIds: ["gone"] },
      ],
      listOrganizationsByIds: async () => [{ id: "org_1", name: "Кафе" }],
      syncDailyJournalObligationsForOrganization: async () => undefined,
      listOpenJournalObligationsForUser: async () => [],
      listOrganizationPoints: async () => [
        { id: "b-1", name: "Точка 1" },
        { id: "b-2", name: "Точка 2" },
      ],
      getManagerObligationSummary: async (organizationId, _now, _overrides, buildingId = null) => {
        summaryCalls.push({ organizationId, buildingId });
        return buildingId === "b-2"
          ? { total: 3, pending: 1, done: 2, employeesWithPending: 1 }
          : { total: 10, pending: 4, done: 6, employeesWithPending: 2 };
      },
      notifyEmployee: async (userId, text) => {
        notifyCalls.push({ userId, text });
      },
    }
  );
  assert.deepEqual(summaryCalls, [
    { organizationId: "org_1", buildingId: null },
    { organizationId: "org_1", buildingId: "b-2" },
  ]);
  const byUser = new Map(notifyCalls.map((call) => [call.userId, call.text]));
  assert.match(byUser.get("owner") ?? "", /Открыто: 4/);
  assert.match(byUser.get("point_head") ?? "", /Кафе · Точка 2/);
  assert.match(byUser.get("point_head") ?? "", /Открыто: 1/);
  assert.match(byUser.get("stale") ?? "", /Открыто: 4/);
});

test("runMiniDigestCron isolates sync failures so one broken organization does not stop the rest", async () => {
  const notifyCalls: string[] = [];

  const result = await runMiniDigestCron(
    {
      miniAppBaseUrl: MINI_APP_BASE_URL,
      now: REQUEST_NOW,
    },
    {
      listLinkedTelegramUsers: async () => [
        {
          id: "staff_bad",
          name: "Bad",
          role: "cook",
          isRoot: false,
          organizationId: "org_bad",
        },
        {
          id: "staff_ok",
          name: "Good",
          role: "cook",
          isRoot: false,
          organizationId: "org_ok",
        },
      ],
      listOrganizationsByIds: async () => [
        { id: "org_bad", name: "Broken Org" },
        { id: "org_ok", name: "Healthy Org" },
      ],
      syncDailyJournalObligationsForOrganization: async (organizationId) => {
        if (organizationId === "org_bad") {
          throw new Error("database offline");
        }
      },
      listOpenJournalObligationsForUser: async (userId) =>
        userId === "staff_ok"
          ? [
              {
                id: "obl_ok",
                journalCode: "incoming_control",
                targetPath: "/mini/journals/incoming_control/new",
                template: { name: "Incoming control", description: null },
              },
            ]
          : [],
      getManagerObligationSummary: async () => ({
        total: 0,
        pending: 0,
        done: 0,
        employeesWithPending: 0,
      }),
      notifyEmployee: async (userId) => {
        notifyCalls.push(userId);
      },
    }
  );

  assert.deepEqual(notifyCalls, ["staff_ok"]);
  assert.deepEqual(result, {
    ok: true,
    checkedUsers: 2,
    organizationsChecked: 2,
    notifiedStaff: 1,
    notifiedManagers: 0,
    notified: 1,
  });
});

test("runMiniDigestCron isolates manager summary failures so other organizations still get manager digests", async () => {
  const notifyCalls: string[] = [];

  const result = await runMiniDigestCron(
    {
      miniAppBaseUrl: MINI_APP_BASE_URL,
      now: REQUEST_NOW,
    },
    {
      listLinkedTelegramUsers: async () => [
        {
          id: "manager_bad",
          name: "Broken",
          role: "manager",
          isRoot: false,
          organizationId: "org_bad",
        },
        {
          id: "manager_ok",
          name: "Healthy",
          role: "manager",
          isRoot: false,
          organizationId: "org_ok",
        },
      ],
      listOrganizationsByIds: async () => [
        { id: "org_bad", name: "Broken Org" },
        { id: "org_ok", name: "Healthy Org" },
      ],
      syncDailyJournalObligationsForOrganization: async () => undefined,
      listOpenJournalObligationsForUser: async () => [],
      getManagerObligationSummary: async (organizationId) => {
        if (organizationId === "org_bad") {
          throw new Error("summary failed");
        }
        return {
          total: 3,
          pending: 1,
          done: 2,
          employeesWithPending: 1,
        };
      },
      notifyEmployee: async (userId) => {
        notifyCalls.push(userId);
      },
    }
  );

  assert.deepEqual(notifyCalls, ["manager_ok"]);
  assert.deepEqual(result, {
    ok: true,
    checkedUsers: 2,
    organizationsChecked: 2,
    notifiedStaff: 0,
    notifiedManagers: 1,
    notified: 1,
  });
});

test("runMiniDigestCron isolates staff obligation lookup failures so one user does not stop the rest", async () => {
  const notifyCalls: string[] = [];

  const result = await runMiniDigestCron(
    {
      miniAppBaseUrl: MINI_APP_BASE_URL,
      now: REQUEST_NOW,
    },
    {
      listLinkedTelegramUsers: async () => [
        {
          id: "staff_bad",
          name: "Broken",
          role: "cook",
          isRoot: false,
          organizationId: "org_1",
        },
        {
          id: "staff_ok",
          name: "Healthy",
          role: "cook",
          isRoot: false,
          organizationId: "org_1",
        },
      ],
      listOrganizationsByIds: async () => [{ id: "org_1", name: "Kitchen 21" }],
      syncDailyJournalObligationsForOrganization: async () => undefined,
      listOpenJournalObligationsForUser: async (userId) => {
        if (userId === "staff_bad") {
          throw new Error("lookup failed");
        }

        return [
          {
            id: "obl_ok",
            journalCode: "incoming_control",
            targetPath: "/mini/journals/incoming_control/new",
            template: { name: "Incoming control", description: null },
          },
        ];
      },
      getManagerObligationSummary: async () => ({
        total: 0,
        pending: 0,
        done: 0,
        employeesWithPending: 0,
      }),
      notifyEmployee: async (userId) => {
        notifyCalls.push(userId);
      },
    }
  );

  assert.deepEqual(notifyCalls, ["staff_ok"]);
  assert.deepEqual(result, {
    ok: true,
    checkedUsers: 2,
    organizationsChecked: 1,
    notifiedStaff: 1,
    notifiedManagers: 0,
    notified: 1,
  });
});
