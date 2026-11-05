import assert from "node:assert/strict";
import test from "node:test";
import { PLATFORM_SECTION_KEYS } from "@/lib/platform-access";
import * as cronRouteModule from "@/app/api/cron/gogetlinks/route";
import {
  notifyDelegatedSeoSpecialists,
  runGglCronPass,
  setGglCronDefaultDepsForTests,
  wasGglAlertSentRecently,
} from "@/lib/seo/gogetlinks-cron.server";

test("runGglCronPass routes operational alerts to admins + seo specialists, and low-balance alerts ONLY to platform admins", async () => {
  const adminAlerts: string[] = [];
  const seoSpecialistAlerts: string[] = [];
  const callSequence: string[] = [];

  const result = await runGglCronPass({
    hasConfiguredAccount: async () => true,
    syncCabinet: async () => {
      callSequence.push("syncCabinet");
      return {
        syncedAt: "2026-11-05T10:00:00Z",
        balanceRub: 1200,
        availableRub: 1200,
        blockedRub: 0,
        campaignsCount: 1,
        ordersCount: 3,
        newUnreadThreadIds: ["th_1"],
        newOnCheckOrderIds: ["ord_2"],
        newReplacementOrderIds: [],
      };
    },
    recycleRejected: async () => {
      callSequence.push("recycleRejected");
      return { recycledSlotIds: [] };
    },
    materializeSlots: async () => {
      callSequence.push("materializeSlots");
      return { created: 2 };
    },
    prepareSlots: async () => {
      callSequence.push("prepareSlots");
      return { prepared: 1, skipped: 0 };
    },
    getPendingSlotsSummary: async () => ({
      dueTodayCount: 1,
      next7DaysSumRub: 2700,
      dateKey: "2026-11-05",
    }),
    wasAlertSentRecently: async () => false,
    notifyAdmins: async (text) => {
      adminAlerts.push(text);
      return true;
    },
    notifyDelegatedSeoUsers: async (text) => {
      seoSpecialistAlerts.push(text);
      return true;
    },
  });

  assert.deepEqual(callSequence, [
    "syncCabinet",
    "recycleRejected",
    "materializeSlots",
    "prepareSlots",
  ]);
  assert.equal(result.skipped, false);
  assert.equal(result.synced, true);
  assert.equal(result.operationalAlertsSent, 1);
  assert.equal(result.lowBalanceAlertSent, true);
  assert.equal(seoSpecialistAlerts.length, 1, "seo specialist gets operational alert only");
  assert.doesNotMatch(seoSpecialistAlerts[0], /пополнить баланс/i);
  assert.equal(
    adminAlerts.length,
    2,
    "platform admins get both operational alert and financial low-balance warning",
  );
  assert.match(adminAlerts[1], /1\s?200.*2\s?700/i);
  assert.match(adminAlerts[1], /пополнить баланс/i);
});

test("runGglCronPass enforces overlap guard (already_running) and resets flag in finally after failure", async () => {
  let releaseFirstSync!: () => void;
  const firstSyncGate = new Promise<void>((resolve) => {
    releaseFirstSync = resolve;
  });
  let firstEnteredSync!: () => void;
  const enteredPromise = new Promise<void>((resolve) => {
    firstEnteredSync = resolve;
  });

  const firstRunPromise = runGglCronPass({
    hasConfiguredAccount: async () => true,
    syncCabinet: async () => {
      firstEnteredSync();
      await firstSyncGate;
      return {
        syncedAt: "2026-11-05T10:10:00Z",
        balanceRub: 5000,
        availableRub: 5000,
        blockedRub: 0,
        campaignsCount: 1,
        ordersCount: 1,
        newUnreadThreadIds: [],
        newOnCheckOrderIds: [],
        newReplacementOrderIds: [],
      };
    },
    recycleRejected: async () => ({ recycledSlotIds: [], exhaustedSlotIds: [] }),
    materializeSlots: async () => ({ created: 0 }),
    prepareSlots: async () => ({ prepared: 0, skipped: 0 }),
    getPendingSlotsSummary: async () => ({
      dueTodayCount: 0,
      next7DaysSumRub: 0,
      dateKey: "2026-11-05",
    }),
    wasAlertSentRecently: async () => false,
    notifyAdmins: async () => true,
    notifyDelegatedSeoUsers: async () => true,
  });

  await enteredPromise;

  const overlappingResult = await runGglCronPass({
    hasConfiguredAccount: async () => {
      throw new Error("should not reach hasConfiguredAccount while active");
    },
  });

  assert.deepEqual(overlappingResult, {
    skipped: true,
    reason: "already_running",
    operationalAlertsSent: 0,
    lowBalanceAlertSent: false,
  });

  releaseFirstSync();
  const firstResult = await firstRunPromise;
  assert.equal(firstResult.skipped, false);

  await assert.rejects(
    () =>
      runGglCronPass({
        hasConfiguredAccount: async () => true,
        syncCabinet: async () => {
          throw new Error("transient QRATOR timeout");
        },
      }),
    /transient QRATOR timeout/,
  );

  const recoveryResult = await runGglCronPass({
    hasConfiguredAccount: async () => true,
    syncCabinet: async () => ({
      syncedAt: "2026-11-05T10:20:00Z",
      balanceRub: 5000,
      availableRub: 5000,
      blockedRub: 0,
      campaignsCount: 1,
      ordersCount: 1,
      newUnreadThreadIds: [],
      newOnCheckOrderIds: [],
      newReplacementOrderIds: [],
    }),
    recycleRejected: async () => ({ recycledSlotIds: [], exhaustedSlotIds: [] }),
    materializeSlots: async () => ({ created: 0 }),
    prepareSlots: async () => ({ prepared: 0, skipped: 0 }),
    getPendingSlotsSummary: async () => ({
      dueTodayCount: 0,
      next7DaysSumRub: 0,
      dateKey: "2026-11-05",
    }),
    wasAlertSentRecently: async () => false,
    notifyAdmins: async () => true,
    notifyDelegatedSeoUsers: async () => true,
  });

  assert.equal(recoveryResult.skipped, false);
  assert.equal(recoveryResult.synced, true);
});

test("runGglCronPass skips cleanly with reason no_account when no GglAccount is configured", async () => {
  let syncCalled = false;

  const result = await runGglCronPass({
    hasConfiguredAccount: async () => false,
    syncCabinet: async () => {
      syncCalled = true;
      throw new Error("must not sync without account");
    },
  });

  assert.equal(syncCalled, false);
  assert.deepEqual(result, {
    skipped: true,
    reason: "no_account",
    operationalAlertsSent: 0,
    lowBalanceAlertSent: false,
  });
});

test("24h deduplication suppresses repeated due-today and low-balance alerts, while edge-triggered alerts stay fire-and-forget safe", async () => {
  const adminAlerts: string[] = [];
  const seoAlerts: string[] = [];

  const throttledResult = await runGglCronPass({
    hasConfiguredAccount: async () => true,
    syncCabinet: async () => ({
      syncedAt: "2026-11-05T12:00:00Z",
      balanceRub: 900,
      availableRub: 900,
      blockedRub: 0,
      campaignsCount: 1,
      ordersCount: 4,
      newUnreadThreadIds: [],
      newOnCheckOrderIds: [],
      newReplacementOrderIds: [],
    }),
    recycleRejected: async () => ({ recycledSlotIds: [], exhaustedSlotIds: [] }),
    materializeSlots: async () => ({ created: 0 }),
    prepareSlots: async () => ({ prepared: 0, skipped: 0 }),
    getPendingSlotsSummary: async () => ({
      dueTodayCount: 2,
      next7DaysSumRub: 3000,
      dateKey: "2026-11-05",
    }),
    wasAlertSentRecently: async () => true,
    notifyAdmins: async (text) => {
      adminAlerts.push(text);
      return true;
    },
    notifyDelegatedSeoUsers: async (text) => {
      seoAlerts.push(text);
      return true;
    },
  });

  assert.equal(throttledResult.skipped, false);
  assert.equal(throttledResult.operationalAlertsSent, 0);
  assert.equal(throttledResult.lowBalanceAlertSent, false);
  assert.equal(adminAlerts.length, 0);
  assert.equal(seoAlerts.length, 0);

  // Even if notifyAdmins / notifyDelegatedSeoUsers throw on an edge-triggered replacement/recycle alert,
  // runGglCronPass catches notification failures and still completes cleanly.
  const resilientResult = await runGglCronPass({
    hasConfiguredAccount: async () => true,
    syncCabinet: async () => ({
      syncedAt: "2026-11-05T12:10:00Z",
      balanceRub: 900,
      availableRub: 900,
      blockedRub: 0,
      campaignsCount: 1,
      ordersCount: 4,
      newUnreadThreadIds: [],
      newOnCheckOrderIds: [],
      newReplacementOrderIds: ["ord_rep_1"],
    }),
    recycleRejected: async () => ({
      recycledSlotIds: ["slot_rec_1"],
      exhaustedSlotIds: ["slot_exh_1"],
    }),
    materializeSlots: async () => ({ created: 1 }),
    prepareSlots: async () => ({ prepared: 1, skipped: 0 }),
    getPendingSlotsSummary: async () => ({
      dueTodayCount: 2,
      next7DaysSumRub: 3000,
      dateKey: "2026-11-05",
    }),
    wasAlertSentRecently: async (kind) => kind === "ggl-due-slots",
    notifyAdmins: async () => {
      throw new Error("SMTP connection refused");
    },
    notifyDelegatedSeoUsers: async () => {
      throw new Error("Telegram 502 Bad Gateway");
    },
  });

  assert.equal(resilientResult.skipped, false);
  assert.equal(resilientResult.synced, true);
  assert.equal(resilientResult.operationalAlertsSent, 0);
  assert.equal(resilientResult.lowBalanceAlertSent, false);

  // Verify default TelegramLog 24h query shape
  let capturedWhere: unknown = null;
  const fixedNow = new Date("2026-11-05T15:00:00.000Z");
  const recentlySent = await wasGglAlertSentRecently("ggl-low-balance", "low-balance", fixedNow, {
    telegramLog: {
      findFirst: (async (args: { where?: unknown }) => {
        capturedWhere = args.where ?? null;
        return { id: "tg_log_1" };
      }) as unknown as typeof import("@/lib/db").db.telegramLog.findFirst,
    },
  });

  assert.equal(recentlySent, true);
  assert.ok(capturedWhere);
  const whereRecord = capturedWhere as {
    kind: { in: string[] };
    dedupeKey: string;
    status: { in: string[] };
    createdAt: { gte: Date };
  };
  assert.equal(whereRecord.dedupeKey, "low-balance");
  assert.ok(whereRecord.kind.in.includes("admin:ggl-low-balance"));
  assert.ok(whereRecord.status.in.includes("sent"));
  assert.ok(!whereRecord.status.in.includes("failed"));
  assert.equal(
    whereRecord.createdAt.gte.toISOString(),
    new Date(fixedNow.getTime() - 24 * 60 * 60 * 1000).toISOString(),
  );
});

test("notifyDelegatedSeoSpecialists excludes isRoot and full-section platform admins so admins never get duplicate messages", async () => {
  let capturedUserWhere: unknown = null;
  const telegramSends: Array<{ chatId: string; userId: string | null | undefined }> = [];
  const emailSends: string[] = [];

  const delivered = await notifyDelegatedSeoSpecialists(
    "<b>GoGetLinks · Новые события</b>\nПроверка фильтрации адресатов",
    { kind: "ggl-operational", dedupeKey: "ops:test" },
    {
      prismaClient: {
        user: {
          findMany: (async (args?: { where?: unknown }) => {
            capturedUserWhere = args?.where ?? null;
            return [
              // 1. Superadmin (should be excluded even if DB returned it)
              {
                id: "u_root",
                email: "owner@wesetup.ru",
                contactEmail: null,
                telegramChatId: "1001",
                isRoot: true,
                platformSections: ["seo"],
              },
              // 2. Full-section platform admin preset (already notified by notifyPlatformAdmin!)
              {
                id: "u_full_admin",
                email: "admin@wesetup.ru",
                contactEmail: null,
                telegramChatId: "1002",
                isRoot: false,
                platformSections: [...PLATFORM_SECTION_KEYS],
              },
              // 3. Delegated SEO user sharing env admin Telegram chat (chat skipped, distinct email sent)
              {
                id: "u_seo_shared_chat",
                email: "seo-lead@wesetup.ru",
                contactEmail: null,
                telegramChatId: "9999",
                isRoot: false,
                platformSections: ["seo", "content"],
              },
              // 4. Delegated SEO specialist with own Telegram & synthetic .local login + real contactEmail
              {
                id: "u_seo_specialist",
                email: "staff-seo@org.local",
                contactEmail: "specialist@wesetup.ru",
                telegramChatId: "2001",
                isRoot: false,
                platformSections: ["seo"],
              },
            ];
          }) as unknown as typeof import("@/lib/db").db.user.findMany,
        },
      },
      getAdminChatIds: async () => ["1001", "1002", "9999"],
      getAdminEmails: async () => ["owner@wesetup.ru", "admin@wesetup.ru"],
      sendTelegram: async (chatId, _body, opts) => {
        telegramSends.push({ chatId, userId: opts?.userId });
        return true;
      },
      sendEmail: async (to) => {
        emailSends.push(to);
        return true;
      },
    },
  );

  assert.equal(delivered, true);
  assert.deepEqual(capturedUserWhere, {
    isActive: true,
    archivedAt: null,
    isRoot: false,
    platformSections: { has: "seo" },
  });
  assert.deepEqual(telegramSends, [{ chatId: "2001", userId: "u_seo_specialist" }]);
  assert.deepEqual(emailSends, ["seo-lead@wesetup.ru", "specialist@wesetup.ru"]);
});

test("/api/cron/gogetlinks GET and POST enforce checkCronSecret (401) and return 200 JSON when authorized", async () => {
  const allowedRouteExports = new Set(["runtime", "dynamic", "maxDuration", "GET", "POST"]);
  for (const key of Object.keys(cronRouteModule)) {
    assert.ok(allowedRouteExports.has(key), `unexpected export "${key}" in cron route.ts`);
  }

  const prevSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "ggl-cron-test-secret-42";
  setGglCronDefaultDepsForTests({
    hasConfiguredAccount: async () => false,
  });

  try {
    const unauthGet = await cronRouteModule.GET(
      new Request("http://127.0.0.1:3002/api/cron/gogetlinks"),
    );
    assert.equal(unauthGet.status, 401);

    const unauthPost = await cronRouteModule.POST(
      new Request("http://127.0.0.1:3002/api/cron/gogetlinks", {
        method: "POST",
        headers: { authorization: "Bearer wrong-token" },
      }),
    );
    assert.equal(unauthPost.status, 401);

    const authGet = await cronRouteModule.GET(
      new Request("http://127.0.0.1:3002/api/cron/gogetlinks?secret=ggl-cron-test-secret-42"),
    );
    assert.equal(authGet.status, 200);
    const getBody = (await authGet.json()) as Record<string, unknown>;
    assert.equal(getBody.ok, true);
    assert.equal(getBody.skipped, true);
    assert.equal(getBody.reason, "no_account");

    const authPost = await cronRouteModule.POST(
      new Request("http://127.0.0.1:3002/api/cron/gogetlinks", {
        method: "POST",
        headers: { authorization: "Bearer ggl-cron-test-secret-42" },
      }),
    );
    assert.equal(authPost.status, 200);
    const postBody = (await authPost.json()) as Record<string, unknown>;
    assert.equal(postBody.ok, true);
    assert.equal(postBody.skipped, true);
    assert.equal(postBody.reason, "no_account");
  } finally {
    setGglCronDefaultDepsForTests(null);
    if (prevSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = prevSecret;
    }
  }
});
