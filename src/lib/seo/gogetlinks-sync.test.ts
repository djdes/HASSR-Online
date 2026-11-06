import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

process.env.INTEGRATION_KEY_SECRET ||= "test-secret-at-least-16-chars-long";

import {
  DEFAULT_SIMILARWEB_SNAPSHOTS,
  ensureDefaultSimilarwebSnapshots,
} from "@/lib/seo/similarweb-seed";
import {
  decimalToNumber,
  ensureWesetupCampaign,
  GglSyncError,
  getGglAccountView,
  reconcileSyncedOrder,
  saveGglAccount,
  syncGglCabinet,
} from "@/lib/seo/gogetlinks-sync.server";

const requireCjs = createRequire(import.meta.url);

function loadRouteFixture<T>(file: string, mocks: Record<string, unknown>): T {
  const output = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const fixtureModule = { exports: {} };
  vm.runInNewContext(output, {
    module: fixtureModule,
    exports: fixtureModule.exports,
    console,
    process,
    Date,
    Response,
    Request,
    Headers,
    URL,
    URLSearchParams,
    require: (id: string) => (Object.hasOwn(mocks, id) ? mocks[id] : requireCjs(id)),
  });
  return fixtureModule.exports as T;
}

function createFakeDecimal(val: number) {
  return {
    toNumber: () => val,
    toString: () => val.toFixed(2),
    valueOf: () => val,
  };
}

test("reconcileSyncedOrder preserves Wesetup human attribution on existing order and marks unknown GGL orders external_ggl", () => {
  const brandNew = reconcileSyncedOrder(null, {
    gglReviewId: 99101,
    donorDomain: "restoranoff.ru",
    priceRub: 790,
    targetUrl: "https://wesetup.ru/zhurnal-generalnyh-uborok",
    anchor: "журнал генеральных уборок",
    status: "paid",
    placementFormat: "article",
  });
  assert.equal(brandNew.origin, "external_ggl");
  assert.equal(brandNew.approvedByName, null);

  const existingScheduled = reconcileSyncedOrder(
    {
      id: "ord_1",
      gglReviewId: null,
      origin: "scheduled_wesetup",
      status: "sending",
      donorDomain: "restoranoff.ru",
      targetUrl: "https://wesetup.ru/zhurnal-generalnyh-uborok",
      initiatedByUserId: "u_seo",
      initiatedByName: "Анна SEO",
      approvedByUserId: "u_root",
      approvedByName: "Олег",
    },
    {
      gglReviewId: 99102,
      donorDomain: "restoranoff.ru",
      priceRub: 790,
      targetUrl: "https://wesetup.ru/zhurnal-generalnyh-uborok",
      anchor: "журнал генеральных уборок",
      status: "pending_webmaster",
      placementFormat: "article",
    },
  );
  assert.equal(existingScheduled.origin, "scheduled_wesetup");
  assert.equal(existingScheduled.approvedByName, "Олег");
  assert.equal(existingScheduled.gglReviewId, 99102);
  assert.equal(existingScheduled.status, "pending_webmaster");
});

test("DEFAULT_SIMILARWEB_SNAPSHOTS covers Jul–Sep 2026 audit domains and ensureDefaultSimilarwebSnapshots is idempotent", async () => {
  assert.deepEqual(
    DEFAULT_SIMILARWEB_SNAPSHOTS.map((s) => s.domain),
    ["wesetup.ru", "haccp-online.ru", "checkoffice.ru"],
  );
  const haccp = DEFAULT_SIMILARWEB_SNAPSHOTS.find((s) => s.domain === "haccp-online.ru")!;
  assert.ok(haccp.clusters.every((c) => c.mappedTargetUrl.startsWith("/")));

  const store = new Map<string, Record<string, unknown>>();
  const mockPrisma = {
    seoCompetitorSnapshot: {
      upsert: async (args: {
        where: { domain_periodLabel: { domain: string; periodLabel: string } };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const key = `${args.where.domain_periodLabel.domain}::${args.where.domain_periodLabel.periodLabel}`;
        if (!store.has(key)) {
          store.set(key, { id: `snap_${store.size + 1}`, ...args.create });
        }
        return store.get(key)!;
      },
    },
  };

  const count1 = await ensureDefaultSimilarwebSnapshots(mockPrisma as never);
  const count2 = await ensureDefaultSimilarwebSnapshots(mockPrisma as never);
  assert.equal(count1, 3);
  assert.equal(count2, 3);
  assert.equal(store.size, 3);
});

test("syncGglCabinet keeps campaigns 'closed' when listActiveCampaigns redirects to view_closed on zero-active-campaign account", async () => {
  const persistedCampaigns = new Map<number, Record<string, unknown>>();
  const closedRows = [
    {
      campaignId: "149699",
      campaignUrl: "/campaign/index/id/149699",
      name: "YesBeat",
      domain: "yesbeat.ru",
      siteUrl: "https://yesbeat.ru",
      statusNote: null, // regular user-closed campaign without admin lock text!
      spent: "8 400 р.",
      linksCount: "21",
      requestsCount: "0",
    },
    {
      campaignId: undefined,
      campaignUrl: "/campaign/index/id/146053",
      name: "FonMusic",
      domain: "fonmusic.ru",
      siteUrl: "https://fonmusic.ru",
      statusNote: "Кампания закрыта администратором",
      spent: "15 415 р.",
      linksCount: "42",
      requestsCount: "0",
    },
  ];

  const mockDb = {
    gglAccount: {
      findFirst: async () => ({
        id: "acc_1",
        email: "owner@wesetup.ru",
        defaultCampaignId: null,
      }),
      update: async () => ({}),
    },
    gglCampaign: {
      upsert: async (args: {
        where: { gglCampaignId: number };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const gglId = args.where.gglCampaignId;
        const row = {
          id: `camp_${gglId}`,
          ...(persistedCampaigns.get(gglId) ?? args.create),
          ...args.update,
        };
        persistedCampaigns.set(gglId, row);
        return row;
      },
    },
    gglOrder: {
      findMany: async () => [],
    },
    gglThread: {
      findMany: async () => [],
    },
    gglMessage: {
      findMany: async () => [],
    },
  };

  await syncGglCabinet({
    includeThreads: false,
    prismaClient: mockDb as never,
    readGgl: async (opName) => {
      if (opName === "getAccountBalance") {
        return { balanceRub: 8936.06, availableRub: 8936.06, blockedRub: 0 } as never;
      }
      // Simulate GoGetLinks 302 redirect on GET /campaigns when 0 active campaigns exist:
      if (opName === "listActiveCampaigns") return closedRows as never;
      if (opName === "listClosedCampaigns") return closedRows as never;
      return [] as never;
    },
  });

  assert.equal(persistedCampaigns.size, 2);
  assert.equal(persistedCampaigns.get(149699)?.state, "closed");
  assert.equal(persistedCampaigns.get(149699)?.isWesetup, false);
  assert.equal(persistedCampaigns.get(146053)?.state, "closed");
  assert.equal(persistedCampaigns.get(146053)?.isWesetup, false);
});

test("syncGglCabinet emits delta IDs strictly for isWesetup === true, reconciles in-flight sending orders, and preserves outbound sentByName within 30 min", async () => {
  const now = new Date("2026-11-05T12:10:00.000Z");
  const fiveMinAgo = new Date("2026-11-05T12:05:00.000Z");
  const twoHoursAgo = new Date("2026-11-05T10:00:00.000Z");

  const campaigns = new Map<number, Record<string, unknown>>();
  const orders = new Map<string, Record<string, unknown>>([
    [
      "ord_inflight_ws",
      {
        id: "ord_inflight_ws",
        gglReviewId: null,
        campaignId: "camp_200001",
        donorDomain: "horeca-journal.ru",
        targetUrl: "/zhurnal-generalnyh-uborok",
        anchor: "журнал генеральных уборок",
        placementFormat: "article",
        priceRub: createFakeDecimal(850),
        status: "sending",
        origin: "scheduled_wesetup",
        initiatedByUserId: "u_seo",
        initiatedByName: "Анна SEO",
        approvedByUserId: "u_root",
        approvedByName: "Олег",
        plannedSlotId: "slot_ws_1",
        idempotencyKey: "slot-approve-1",
      },
    ],
  ]);

  const slotUpdates: Array<{ where: unknown; data: unknown }> = [];
  const threads = new Map<string, Record<string, unknown>>();
  const messages = new Map<string, Record<string, unknown>>([
    [
      "msg_sending_recent",
      {
        id: "msg_sending_recent",
        threadId: "th_ws",
        gglMessageId: null,
        direction: "outbound",
        authorLabel: "Анна SEO",
        sentByUserId: "u_seo",
        sentByName: "Анна SEO",
        body: "Добрый день, поправьте анкор, пожалуйста.",
        deliveryStatus: "sending",
        idempotencyKey: "reply-1",
        sentAt: fiveMinAgo,
      },
    ],
    [
      "msg_sending_stale",
      {
        id: "msg_sending_stale",
        threadId: "th_ws",
        gglMessageId: null,
        direction: "outbound",
        authorLabel: "Старый Админ",
        sentByUserId: "u_old",
        sentByName: "Старый Админ",
        body: "Старое сообщение двухчасовой давности",
        deliveryStatus: "sending",
        idempotencyKey: "reply-old",
        sentAt: twoHoursAgo,
      },
    ],
  ]);

  let orderSeq = 1;
  let msgSeq = 1;

  const mockDb = {
    gglAccount: {
      findFirst: async () => ({
        id: "acc_1",
        email: "seo-owner@wesetup.ru",
        defaultCampaignId: 200001,
      }),
      update: async () => ({}),
    },
    gglCampaign: {
      upsert: async (args: {
        where: { gglCampaignId: number };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const gglId = args.where.gglCampaignId;
        const row = {
          id: `camp_${gglId}`,
          ...(campaigns.get(gglId) ?? args.create),
          ...args.update,
        };
        campaigns.set(gglId, row);
        return row;
      },
    },
    gglOrder: {
      findMany: async () => [...orders.values()],
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const existing = orders.get(args.where.id)!;
        const updated = { ...existing, ...args.data, id: String(existing.id) };
        orders.set(updated.id, updated);
        return updated;
      },
      create: async (args: { data: Record<string, unknown> }) => {
        const created = { id: `ord_new_${orderSeq++}`, ...args.data };
        orders.set(created.id, created);
        return created;
      },
    },
    gglPlannedSlot: {
      updateMany: async (args: { where: unknown; data: unknown }) => {
        slotUpdates.push(args);
        return { count: 1 };
      },
    },
    gglThread: {
      findMany: async () => [...threads.values()],
      upsert: async (args: {
        where: { gglThreadKey: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const key = args.where.gglThreadKey;
        const existing = [...threads.values()].find((t) => t.gglThreadKey === key);
        const id = String(existing?.id ?? (key === "7001" ? "th_ws" : `th_${key}`));
        const saved = { id, ...(existing ?? args.create), ...args.update };
        threads.set(id, saved);
        return saved;
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const existing = threads.get(args.where.id)!;
        const saved = { ...existing, ...args.data, id: String(existing.id) };
        threads.set(saved.id, saved);
        return saved;
      },
    },
    gglMessage: {
      findMany: async (args?: { where?: { threadId?: string } }) => {
        const all = [...messages.values()];
        if (args?.where?.threadId) {
          return all.filter((m) => m.threadId === args.where?.threadId);
        }
        return all;
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const existing = messages.get(args.where.id)!;
        const saved = { ...existing, ...args.data, id: String(existing.id) };
        messages.set(saved.id, saved);
        return saved;
      },
      create: async (args: { data: Record<string, unknown> }) => {
        const created = { id: `msg_new_${msgSeq++}`, ...args.data };
        messages.set(created.id, created);
        return created;
      },
    },
  };

  const summary = await syncGglCabinet({
    now,
    prismaClient: mockDb as never,
    readGgl: async (opName, args) => {
      if (opName === "getAccountBalance") {
        return { balanceRub: 10500, availableRub: 9650, blockedRub: 850 } as never;
      }
      if (opName === "listActiveCampaigns") {
        return [
          {
            campaignId: "200001",
            name: "WeSetup",
            domain: "wesetup.ru",
            siteUrl: "https://wesetup.ru",
            spent: "0 р.",
            linksCount: "1",
            requestsCount: "2",
          },
        ] as never;
      }
      if (opName === "listClosedCampaigns") {
        return [
          {
            campaignId: "149699",
            name: "YesBeat",
            domain: "yesbeat.ru",
            siteUrl: "https://yesbeat.ru",
            statusNote: "Кампания закрыта",
            spent: "8 400 р.",
            linksCount: "21",
            requestsCount: "0",
          },
        ] as never;
      }
      if (opName === "listCampaignPaidLinks") {
        return [] as never;
      }
      if (opName === "listReviewsByTab") {
        if (args?.tab === "on_check") {
          return [
            // 1. Matches in-flight sending order on wesetup.ru!
            {
              rowId: "col_row_7001",
              siteCell: "horeca-journal.ru Кампания: WeSetup",
              targetUrl: "https://wesetup.ru/zhurnal-generalnyh-uborok",
              anchor: "журнал генеральных уборок",
              price: "850 Р",
              dailyTraffic: "1200",
              tfCf: "16 / 21",
            },
            // 2. Non-wesetup campaign on_check (MUST NOT leak into delta!)
            {
              rowId: "col_row_8001",
              siteCell: "musicblog.ru Кампания: YesBeat",
              targetUrl: "https://yesbeat.ru/beats",
              anchor: "купить биты",
              price: "300 Р",
            },
          ] as never;
        }
        if (args?.tab === "needs_replacement") {
          return [
            {
              rowId: "col_row_7002",
              siteCell: "sanpin-guide.ru Кампания: WeSetup",
              targetUrl: "https://wesetup.ru/journals-info",
              anchor: "wesetup.ru",
              price: "750 Р",
            },
            {
              rowId: "col_row_8002",
              siteCell: "oldrap.ru Кампания: YesBeat",
              targetUrl: "https://yesbeat.ru/",
              anchor: "yesbeat.ru",
              price: "250 Р",
            },
          ] as never;
        }
        return [] as never;
      }
      if (opName === "listMessageThreads") {
        return [
          {
            threadKey: "7001",
            author: "webmaster_horeca",
            subject: "Обзор #7001 (horeca-journal.ru)",
            date: "05.11.2026",
            unread: "1",
          },
          {
            threadKey: "8002",
            author: "webmaster_music",
            subject: "Замена ссылки (oldrap.ru)",
            date: "05.11.2026",
            unread: "2",
          },
        ] as never;
      }
      if (opName === "getMessageThread") {
        if (args?.threadKey === "7001") {
          return [
            {
              id: "ggl_m_101",
              sender: "seo-owner@wesetup.ru",
              text: "  Добрый день,   поправьте анкор, пожалуйста.\r\n",
              date: "05.11.2026 15:05",
            },
            {
              id: "ggl_m_102",
              sender: "seo-owner@wesetup.ru",
              text: "Старое сообщение двухчасовой давности",
              date: "05.11.2026 13:00",
            },
            {
              id: "ggl_m_103",
              sender: "webmaster_horeca",
              text: "Поправил анкор, проверьте размещение!",
              date: "05.11.2026 15:09",
            },
          ] as never;
        }
        return [
          {
            id: "ggl_m_201",
            sender: "webmaster_music",
            text: "Предлагаю замену на yesbeat",
            date: "05.11.2026 15:00",
          },
        ] as never;
      }
      return [] as never;
    },
  });

  // 1. Deltas contain strictly wesetup.ru records, zero yesbeat.ru records:
  assert.deepEqual(summary.newOnCheckOrderIds, ["ord_inflight_ws"]);
  assert.equal(summary.newReplacementOrderIds.length, 1);
  const wsReplacementOrder = orders.get(summary.newReplacementOrderIds[0])!;
  assert.equal(wsReplacementOrder.campaignId, "camp_200001");
  assert.deepEqual(summary.newUnreadThreadIds, ["th_ws"]);

  // 2. In-flight order reconciled cleanly while preserving human attribution & advancing slot:
  const reconciled = orders.get("ord_inflight_ws")!;
  assert.equal(reconciled.gglReviewId, 7001);
  assert.equal(reconciled.status, "on_check");
  assert.equal(reconciled.origin, "scheduled_wesetup");
  assert.equal(reconciled.initiatedByName, "Анна SEO");
  assert.equal(reconciled.approvedByName, "Олег");
  assert.equal(slotUpdates.length, 1);

  // 3. Outbound message within 30 min matched by normalized body and preserved sentByName:
  const recentMsg = messages.get("msg_sending_recent")!;
  assert.equal(recentMsg.deliveryStatus, "synced");
  assert.equal(recentMsg.gglMessageId, "ggl_m_101");
  assert.equal(recentMsg.sentByUserId, "u_seo");
  assert.equal(recentMsg.sentByName, "Анна SEO");

  // Stale (>30 min) sending message was NOT matched by body:
  const staleMsg = messages.get("msg_sending_stale")!;
  assert.equal(staleMsg.deliveryStatus, "sending");
});

test("/api/root/gogetlinks/account GET masks email & strips secrets, and /api/root/gogetlinks/overview filters isWesetup & converts Decimals", async () => {
  const rawAccount = {
    id: "acc_1",
    email: "seo-team@wesetup.ru",
    passwordEnc: "iv.tag.secret_password_cipher",
    sessionEnc: "iv.tag.secret_cookie_cipher",
    balanceRub: createFakeDecimal(8936.06),
    availableRub: createFakeDecimal(8086.06),
    blockedRub: createFakeDecimal(850),
    defaultCampaignId: 200001,
    allowSeoApproveWithinPlan: false,
    status: "ok",
    lastSyncedAt: new Date("2026-11-05T12:00:00.000Z"),
    lastError: null,
  };

  // Direct helper check:
  const view = await getGglAccountView({
    gglAccount: { findFirst: async () => rawAccount },
  } as never);
  assert.ok(view);
  assert.equal(view.email, "seo…@wesetup.ru");
  assert.equal(view.balanceRub, 8936.06);
  assert.equal("passwordEnc" in view, false);
  assert.equal("sessionEnc" in view, false);

  // Route handler GET check for /api/root/gogetlinks/account:
  const accountRoute = loadRouteFixture<{
    GET: () => Promise<Response>;
  }>("src/app/api/root/gogetlinks/account/route.ts", {
    "@/lib/auth-helpers": {
      requireRoot: async () => ({ user: { id: "u_seo", isRoot: false } }),
      requireSuperRoot: async () => ({ user: { id: "u_root", isRoot: true, name: "Олег" } }),
    },
    "@/lib/seo/gogetlinks-sync.server": {
      getGglAccountView: async () => view,
      saveGglAccount: async () => view,
      ensureWesetupCampaign,
    },
  });
  const accRes = await accountRoute.GET();
  assert.equal(accRes.status, 200);
  const accBodyText = await accRes.text();
  assert.doesNotMatch(accBodyText, /passwordEnc|sessionEnc|secret_password_cipher|secret_cookie_cipher|seo-team@wesetup\.ru/);
  const accJson = JSON.parse(accBodyText);
  assert.equal(accJson.account.email, "seo…@wesetup.ru");
  assert.equal(typeof accJson.account.balanceRub, "number");

  // Route handler GET check for /api/root/gogetlinks/overview:
  let seededSnapshots = 0;
  const allCampaigns = [
    {
      id: "c_ws",
      gglCampaignId: 200001,
      name: "WeSetup",
      domain: "wesetup.ru",
      siteUrl: "https://wesetup.ru",
      isWesetup: true,
      state: "active",
      spentRub: createFakeDecimal(1580.5),
      linksCount: 2,
      requestsCount: 1,
      qualityControl: null,
      statusNote: null,
      targetAnchorsJson: null,
      syncedAt: new Date("2026-11-05T12:00:00.000Z"),
      createdAt: new Date("2026-11-05T10:00:00.000Z"),
      updatedAt: new Date("2026-11-05T12:00:00.000Z"),
    },
    {
      id: "c_yb",
      gglCampaignId: 149699,
      name: "YesBeat",
      domain: "yesbeat.ru",
      siteUrl: "https://yesbeat.ru",
      isWesetup: false,
      state: "closed",
      spentRub: createFakeDecimal(8400),
      linksCount: 21,
      requestsCount: 0,
      qualityControl: null,
      statusNote: "Кампания закрыта",
      targetAnchorsJson: null,
      syncedAt: new Date("2026-11-05T12:00:00.000Z"),
      createdAt: new Date("2026-11-05T10:00:00.000Z"),
      updatedAt: new Date("2026-11-05T12:00:00.000Z"),
    },
  ];
  const allOrders = [
    {
      id: "ord_ws",
      gglReviewId: 901,
      campaignId: "c_ws",
      campaign: allCampaigns[0],
      donorSiteId: 11,
      donorDomain: "horeca.ru",
      donorDailyTraffic: 900,
      donorTfCf: "15 / 20",
      donorTrust: 6,
      placementFormat: "article",
      priceRub: createFakeDecimal(790.25),
      targetUrl: "https://wesetup.ru/journals-info",
      anchor: "журналы хассп",
      publishedUrl: "https://horeca.ru/post-1",
      articleId: null,
      paidAt: new Date("2026-11-04T12:00:00.000Z"),
      cancelledAt: null,
      indexedStatus: null,
      status: "paid",
      origin: "scheduled_wesetup",
      initiatedByUserId: "u_seo",
      initiatedByName: "Анна",
      approvedByUserId: "u_root",
      approvedByName: "Олег",
      approvedAt: new Date("2026-11-03T12:00:00.000Z"),
      plannedSlotId: null,
      idempotencyKey: "k1",
      createdAt: new Date("2026-11-03T12:00:00.000Z"),
      updatedAt: new Date("2026-11-04T12:00:00.000Z"),
    },
    {
      id: "ord_yb",
      gglReviewId: 902,
      campaignId: "c_yb",
      campaign: allCampaigns[1],
      donorSiteId: 12,
      donorDomain: "music.ru",
      donorDailyTraffic: 300,
      donorTfCf: "10 / 12",
      donorTrust: 4,
      placementFormat: "note",
      priceRub: createFakeDecimal(200),
      targetUrl: "https://yesbeat.ru",
      anchor: "yesbeat",
      publishedUrl: "https://music.ru/p1",
      articleId: null,
      paidAt: new Date("2020-05-01T12:00:00.000Z"),
      cancelledAt: null,
      indexedStatus: null,
      status: "paid",
      origin: "external_ggl",
      initiatedByUserId: null,
      initiatedByName: null,
      approvedByUserId: null,
      approvedByName: null,
      approvedAt: null,
      plannedSlotId: null,
      idempotencyKey: "k2",
      createdAt: new Date("2020-05-01T12:00:00.000Z"),
      updatedAt: new Date("2020-05-01T12:00:00.000Z"),
    },
  ];

  const mockOverviewDb = {
    gglAccount: { findFirst: async () => rawAccount },
    gglCampaign: {
      findMany: async (args?: { where?: { isWesetup?: boolean } }) =>
        args?.where?.isWesetup === true ? allCampaigns.filter((c) => c.isWesetup) : allCampaigns,
      count: async (args?: { where?: { isWesetup?: boolean } }) =>
        args?.where?.isWesetup === false ? allCampaigns.filter((c) => !c.isWesetup).length : allCampaigns.length,
    },
    gglOrder: {
      findMany: async (args?: { where?: { campaign?: { isWesetup?: boolean } } }) =>
        args?.where?.campaign?.isWesetup === true ? allOrders.filter((o) => o.campaign.isWesetup) : allOrders,
    },
    gglThread: { findMany: async () => [] },
    gglSchedulePlan: { findMany: async () => [] },
    gglPlannedSlot: { findMany: async () => [] },
    gglArticle: { findMany: async () => [] },
    seoCompetitorSnapshot: {
      findMany: async () =>
        DEFAULT_SIMILARWEB_SNAPSHOTS.map((s, idx) => ({
          id: `snap_${idx}`,
          ...s,
          createdByUserId: null,
          createdAt: new Date("2026-11-05T10:00:00.000Z"),
        })),
    },
  };

  const overviewRoute = loadRouteFixture<{
    GET: (req: Request) => Promise<Response>;
  }>("src/app/api/root/gogetlinks/overview/route.ts", {
    "@/lib/auth-helpers": {
      requireRoot: async () => ({ user: { id: "u_seo", isRoot: false } }),
    },
    "@/lib/db": { db: mockOverviewDb },
    "@/lib/seo/similarweb-seed": {
      ensureDefaultSimilarwebSnapshots: async () => {
        seededSnapshots += 1;
        return 3;
      },
    },
  });

  const defaultRes = await overviewRoute.GET(new Request("https://wesetup.ru/api/root/gogetlinks/overview"));
  const defaultJson = await defaultRes.json();
  assert.equal(seededSnapshots, 1);
  assert.equal(defaultJson.campaigns.length, 1);
  assert.equal(defaultJson.campaigns[0].domain, "wesetup.ru");
  assert.equal(defaultJson.campaigns[0].spentRub, 1580.5);
  assert.equal(defaultJson.orders.length, 1);
  assert.equal(defaultJson.orders[0].priceRub, 790.25);
  assert.equal("passwordEnc" in defaultJson.account, false);

  const archiveRes = await overviewRoute.GET(
    new Request("https://wesetup.ru/api/root/gogetlinks/overview?includeOtherProjects=true"),
  );
  const archiveJson = await archiveRes.json();
  assert.equal(archiveJson.campaigns.length, 2);
  assert.equal(archiveJson.orders.length, 2);
});

test("/api/root/gogetlinks/account PUT encrypts secrets & logs ggl.account.save, and POST ensures wesetup.ru campaign", async () => {
  const auditEvents: Array<Record<string, unknown>> = [];
  const accountHolder: { row: Record<string, unknown> | null } = { row: null };
  const campaignHolder: { row: Record<string, unknown> | null } = { row: null };
  let writeCalledWith: Record<string, unknown> | null = null;

  const mockDb = {
    gglAccount: {
      findFirst: async () => accountHolder.row,
      create: async (args: { data: Record<string, unknown> }) => {
        accountHolder.row = { id: "acc_new", ...args.data };
        return accountHolder.row;
      },
      update: async (args: { data: Record<string, unknown> }) => {
        accountHolder.row = { ...accountHolder.row, ...args.data };
        return accountHolder.row;
      },
    },
    gglCampaign: {
      findFirst: async (args?: { where?: { isWesetup?: boolean } }) => {
        if (!campaignHolder.row) return null;
        if (args?.where?.isWesetup && !campaignHolder.row.isWesetup) return null;
        return campaignHolder.row;
      },
      upsert: async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        campaignHolder.row = {
          id: "camp_ws_new",
          createdAt: new Date("2026-11-05T12:00:00.000Z"),
          updatedAt: new Date("2026-11-05T12:00:00.000Z"),
          ...args.create,
          ...args.update,
        };
        return campaignHolder.row;
      },
    },
  };

  const mockVerify = async () => ({
    cookies: [
      {
        name: "hash",
        value: "live_hash",
        domain: "gogetlinks.net",
        path: "/",
        expires: 2000000000,
        httpOnly: true,
        secure: true,
      },
    ],
    balance: { balanceRub: 5000, availableRub: 4200, blockedRub: 800 },
  });

  const accountRoute = loadRouteFixture<{
    PUT: (req: Request) => Promise<Response>;
    POST: (req: Request) => Promise<Response>;
  }>("src/app/api/root/gogetlinks/account/route.ts", {
    "@/lib/auth-helpers": {
      requireRoot: async () => ({ user: { id: "u_root", isRoot: true, name: "Олег" } }),
      requireSuperRoot: async () => ({ user: { id: "u_root", isRoot: true, name: "Олег" } }),
    },
    "@/lib/audit-helper": {
      audit: async (args: Record<string, unknown>) => {
        auditEvents.push(args);
      },
    },
    "@/lib/seo/gogetlinks-sync.server": {
      decimalToNumber,
      GglSyncError,
      getGglAccountView: () => getGglAccountView(mockDb as never),
      saveGglAccount: (input: Parameters<typeof saveGglAccount>[0], userId: string | null) =>
        saveGglAccount(input, userId, {
          prismaClient: mockDb as never,
          verifyLogin: mockVerify as never,
        }),
      ensureWesetupCampaign: (input: Parameters<typeof ensureWesetupCampaign>[0]) =>
        ensureWesetupCampaign(input, {
          prismaClient: mockDb as never,
          readGgl: async (opName) => {
            if (opName === "listActiveCampaigns" && writeCalledWith) {
              return [
                {
                  campaignId: "200777",
                  name: "WeSetup — ХАССП и СанПиН",
                  domain: "wesetup.ru",
                  siteUrl: "https://wesetup.ru",
                  spent: "0 р.",
                  linksCount: "0",
                  requestsCount: "0",
                },
              ] as never;
            }
            return [] as never;
          },
          writeGgl: async (wInput) => {
            writeCalledWith = wInput as unknown as Record<string, unknown>;
            return { status: "applied" as const, data: { ok: true } as never };
          },
        }),
    },
  });

  const putRes = await accountRoute.PUT(
    new Request("https://wesetup.ru/api/root/gogetlinks/account", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "owner@wesetup.ru",
        password: "SuperSecretPassword123",
        allowSeoApproveWithinPlan: true,
      }),
    }),
  );
  assert.equal(putRes.status, 200);
  const putJson = await putRes.json();
  assert.equal(putJson.account.email, "own…@wesetup.ru");
  assert.equal(putJson.account.allowSeoApproveWithinPlan, true);
  assert.equal("passwordEnc" in putJson.account, false);
  assert.equal("sessionEnc" in putJson.account, false);
  assert.ok(accountHolder.row);
  assert.notEqual(accountHolder.row.passwordEnc, "SuperSecretPassword123");
  assert.match(String(accountHolder.row.passwordEnc), /\./);
  assert.match(String(accountHolder.row.sessionEnc), /\./);
  assert.equal(auditEvents[0]?.action, "ggl.account.save");

  const postRes = await accountRoute.POST(
    new Request("https://wesetup.ru/api/root/gogetlinks/account", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: "ensure-ws-1" }),
    }),
  );
  assert.equal(postRes.status, 200);
  const postJson = await postRes.json();
  assert.ok(writeCalledWith);
  assert.equal(postJson.campaign.gglCampaignId, 200777);
  assert.equal(postJson.account.defaultCampaignId, 200777);
  assert.equal(auditEvents[1]?.action, "ggl.campaign.ensure");
});


test("syncGglCabinet auto-binds active wesetup.ru campaign when defaultCampaignId is null or stale, fetches wesetup paid links last, and pins overall campaign", async () => {
  const paidFetchOrder: string[] = [];
  const pinnedIds: number[] = [];
  let updatedAccountData: Record<string, unknown> | null = null;
  const campaigns = new Map<number, Record<string, unknown>>();

  const mockDb = {
    gglAccount: {
      findFirst: async () => ({
        id: "acc_pin_test",
        email: "seo-owner@wesetup.ru",
        // Stale legacy closed campaign ID should be replaced with active wesetup #884931
        defaultCampaignId: 149699,
      }),
      update: async (args: { data: Record<string, unknown> }) => {
        updatedAccountData = args.data;
        return args.data;
      },
    },
    gglCampaign: {
      upsert: async (args: {
        where: { gglCampaignId: number };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const gglId = args.where.gglCampaignId;
        const row = {
          id: `camp_${gglId}`,
          ...(campaigns.get(gglId) ?? args.create),
          ...args.update,
        };
        campaigns.set(gglId, row);
        return row;
      },
    },
    gglOrder: {
      findMany: async () => [],
      update: async () => ({ id: "ord_1" }),
      create: async () => ({ id: "ord_1" }),
    },
    gglPlannedSlot: {
      updateMany: async () => ({ count: 0 }),
    },
    gglThread: {
      findMany: async () => [],
      upsert: async () => ({ id: "th_1" }),
      update: async () => ({ id: "th_1" }),
    },
    gglMessage: {
      findMany: async () => [],
      create: async () => ({ id: "msg_1" }),
      update: async () => ({ id: "msg_1" }),
    },
  };

  await syncGglCabinet({
    includeThreads: false,
    prismaClient: mockDb as never,
    pinOverallCampaign: async (id) => {
      pinnedIds.push(id);
    },
    readGgl: async (opName, args) => {
      if (opName === "getAccountBalance") {
        return { balanceRub: 8936.06, availableRub: 8936.06, blockedRub: 0 } as never;
      }
      if (opName === "listActiveCampaigns") {
        return [
          {
            campaignId: "884931",
            name: "WeSetup электронные журналы ХАССП",
            domain: "wesetup.ru",
            siteUrl: "https://wesetup.ru",
            spent: "0 Р",
            linksCount: "0",
          },
        ] as never;
      }
      if (opName === "listClosedCampaigns") {
        return [
          {
            campaignId: "149699",
            name: "YESBEAT.RU",
            domain: "yesbeat.ru",
            siteUrl: "https://yesbeat.ru",
            spent: "39 748 Р",
            linksCount: "55",
          },
          {
            campaignId: "4101",
            name: "mp3mail.ru",
            domain: "mp3mail.ru",
            siteUrl: "http://mp3mail.ru",
            spent: "71 Р",
            linksCount: "0",
          },
        ] as never;
      }
      if (opName === "listCampaignPaidLinks") {
        paidFetchOrder.push(String(args?.campaignId));
        return [] as never;
      }
      return [] as never;
    },
  });

  assert.ok(updatedAccountData);
  assert.equal((updatedAccountData as Record<string, unknown>).defaultCampaignId, 884931);
  // Active wesetup.ru campaign #884931 MUST be fetched last so /reviews #in_comp_id stays selected on wesetup.ru
  assert.equal(paidFetchOrder.at(-1), "884931");
  assert.deepEqual(pinnedIds, [884931]);
});
