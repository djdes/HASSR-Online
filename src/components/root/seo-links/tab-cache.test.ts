import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { GglApplicationsView } from "@/lib/seo/gogetlinks-applications";
import type { GglMessageDto, GglOverviewResponse } from "./types";
import {
  buildThreadCacheFingerprint,
  findCachedApplicationsForDonor,
  getCachedApplicationsUiState,
  getCachedApplicationsView,
  getCachedOverview,
  getCachedThreadMessages,
  invalidateApplicationsCache,
  invalidateOverviewCache,
  invalidateThreadMessagesCache,
  resetSeoLinksTabCache,
  setCachedApplicationsUiState,
  setCachedApplicationsView,
  setCachedOverview,
  setCachedThreadMessages,
  type ThreadCacheKeyInput,
} from "./tab-cache";

function makeApplicationsView(overrides?: Partial<GglApplicationsView>): GglApplicationsView {
  return {
    campaignId: 101,
    campaignName: "WeSetup Main",
    snapshotId: "snap-1",
    snapshot: {
      version: 1,
      campaignId: 101,
      fetchedAt: "2026-11-24T08:00:00.000Z",
      sourceTotal: 2,
      complete: true,
      warning: null,
      applications: [
        {
          id: "101_5001_article",
          campaignId: 101,
          siteId: 5001,
          domain: "food-safety.ru",
          siteUrl: "https://food-safety.ru",
          placementType: "Статья",
          priceRub: 1500,
          dailyTraffic: 1200,
          tf: 18,
          cf: 24,
          iks: 350,
          trust: 7,
          badges: ["В Яндекс.Новостях"],
        },
        {
          id: "101_5002_note",
          campaignId: 101,
          siteId: 5002,
          domain: "horeca-journal.ru",
          siteUrl: "https://horeca-journal.ru",
          placementType: "Заметка",
          priceRub: 900,
          dailyTraffic: 800,
          tf: 14,
          cf: 20,
          iks: 210,
          trust: 6,
          badges: [],
        },
      ],
    },
    cards: [],
    analysis: null,
    ...overrides,
  };
}

function makeThreadKey(overrides?: Partial<ThreadCacheKeyInput>): ThreadCacheKeyInput {
  return {
    id: "thread-1",
    lastMessageAt: "2026-11-24T08:30:00.000Z",
    updatedAt: "2026-11-24T08:30:00.000Z",
    unreadCount: 0,
    needsReply: false,
    order: { status: "in_progress" },
    ...overrides,
  };
}

function makeMessage(overrides?: Partial<GglMessageDto>): GglMessageDto {
  return {
    id: "msg-1",
    threadId: "thread-1",
    gglMessageId: "ggl-msg-1",
    direction: "inbound",
    authorLabel: "webmaster",
    sentByUserId: null,
    sentByName: null,
    body: "Здравствуйте, разместили ссылку",
    deliveryStatus: "delivered",
    idempotencyKey: null,
    sentAt: "2026-11-24T08:30:00.000Z",
    createdAt: "2026-11-24T08:30:00.000Z",
    ...overrides,
  };
}

function makeOverview(includeOtherProjects = false): GglOverviewResponse {
  return {
    includeOtherProjects,
    account: null,
    campaigns: [],
    orders: [],
    threads: [],
    plans: [],
    slots: [],
    articles: [],
    similarwebSnapshots: [],
    metrics: {
      monthSpentRub: 12000,
      monthlyPlanBudgetRub: 30000,
      next7DaysPendingRub: 4500,
      counts: {
        paidOrders: 5,
        inProgressOrders: 2,
        onCheckOrders: 1,
        needsReplacementOrders: 0,
        unreadThreads: 1,
        pendingApprovalSlots: 3,
        otherProjectsCampaignsCount: 0,
        webmasterApplications: 2,
      },
    },
  };
}

describe("seo-links tab-cache", () => {
  beforeEach(() => {
    resetSeoLinksTabCache();
  });

  describe("Applications tab cache", () => {
    it("stores and retrieves cached applications view when signature matches", () => {
      const view = makeApplicationsView();
      setCachedApplicationsView(101, view, {
        expectedCount: 2,
        accountSyncedAt: "2026-11-24T08:00:00.000Z",
      });

      assert.equal(getCachedApplicationsView(101), view);
      assert.equal(
        getCachedApplicationsView(101, {
          expectedCount: 2,
          accountSyncedAt: "2026-11-24T08:00:00.000Z",
        }),
        view,
      );
      assert.equal(getCachedApplicationsView(undefined), null);
    });

    it("uses 'default' campaign key when campaignId is undefined", () => {
      const view = makeApplicationsView();
      setCachedApplicationsView(undefined, view, {
        expectedCount: 2,
        accountSyncedAt: "2026-11-24T08:00:00.000Z",
      });

      assert.equal(
        getCachedApplicationsView(undefined, {
          expectedCount: 2,
          accountSyncedAt: "2026-11-24T08:00:00.000Z",
        }),
        view,
      );
    });

    it("returns null when expectedCount is positive and differs from cached total", () => {
      const view = makeApplicationsView();
      setCachedApplicationsView(101, view, {
        expectedCount: 2,
        accountSyncedAt: "2026-11-24T08:00:00.000Z",
      });

      assert.equal(
        getCachedApplicationsView(101, {
          expectedCount: 3,
          accountSyncedAt: "2026-11-24T08:00:00.000Z",
        }),
        null,
      );

      assert.equal(getCachedApplicationsView(101, { expectedCount: 0 }), view);
      assert.equal(getCachedApplicationsView(101, { expectedCount: null }), view);
    });

    it("returns null when accountSyncedAt differs from stored accountSyncedAt", () => {
      const view = makeApplicationsView();
      setCachedApplicationsView(101, view, {
        expectedCount: 2,
        accountSyncedAt: "2026-11-24T08:00:00.000Z",
      });

      assert.equal(
        getCachedApplicationsView(101, {
          expectedCount: 2,
          accountSyncedAt: "2026-11-24T09:00:00.000Z",
        }),
        null,
      );
    });

    it("stores and retrieves UI state per campaign key", () => {
      assert.equal(getCachedApplicationsUiState(101), null);

      setCachedApplicationsUiState(101, {
        query: "food",
        sort: "price_asc",
        visibleCount: 80,
      });
      setCachedApplicationsUiState(undefined, {
        query: "",
        sort: "verdict",
        visibleCount: 40,
      });

      assert.deepEqual(getCachedApplicationsUiState(101), {
        query: "food",
        sort: "price_asc",
        visibleCount: 80,
      });
      assert.deepEqual(getCachedApplicationsUiState(undefined), {
        query: "",
        sort: "verdict",
        visibleCount: 40,
      });
    });

    it("invalidates specific campaign or all campaigns", () => {
      const view101 = makeApplicationsView({ campaignId: 101 });
      const view202 = makeApplicationsView({
        campaignId: 202,
        snapshot: {
          ...view101.snapshot,
          campaignId: 202,
        },
      });

      setCachedApplicationsView(101, view101);
      setCachedApplicationsView(202, view202);

      invalidateApplicationsCache(101);
      assert.equal(getCachedApplicationsView(101), null);
      assert.equal(getCachedApplicationsView(202), view202);

      invalidateApplicationsCache();
      assert.equal(getCachedApplicationsView(202), null);
    });

    it("finds cached applications for donor by siteId or case-insensitive domain", () => {
      const view = makeApplicationsView();
      setCachedApplicationsView(101, view);

      const bySiteId = findCachedApplicationsForDonor({
        campaignId: 101,
        donorSiteId: 5001,
      });
      assert.equal(bySiteId.length, 1);
      assert.equal(bySiteId[0]?.domain, "food-safety.ru");

      const byDomain = findCachedApplicationsForDonor({
        donorDomain: "  WWW.HORECA-JOURNAL.RU ",
      });
      assert.equal(byDomain.length, 1);
      assert.equal(byDomain[0]?.siteId, 5002);

      const noMatch = findCachedApplicationsForDonor({
        donorDomain: "unknown-site.ru",
        donorSiteId: 9999,
      });
      assert.deepEqual(noMatch, []);
    });
  });

  describe("Chats tab messages cache", () => {
    it("returns cached messages when thread fingerprint is unchanged", () => {
      const thread = makeThreadKey();
      const messages = [makeMessage()];

      setCachedThreadMessages(thread, { messages, refreshError: null });

      const cached = getCachedThreadMessages(thread);
      assert.deepEqual(cached, { messages, refreshError: null });
    });

    it("invalidates automatically when thread fingerprint changes", () => {
      const thread = makeThreadKey();
      const messages = [makeMessage()];

      setCachedThreadMessages(thread, { messages, refreshError: "Временная ошибка GGL" });

      assert.equal(
        getCachedThreadMessages(
          makeThreadKey({ lastMessageAt: "2026-11-24T09:00:00.000Z" }),
        ),
        null,
      );
      assert.equal(
        getCachedThreadMessages(makeThreadKey({ unreadCount: 1 })),
        null,
      );
      assert.equal(
        getCachedThreadMessages(makeThreadKey({ needsReply: true })),
        null,
      );
      assert.equal(
        getCachedThreadMessages(makeThreadKey({ order: { status: "paid" } })),
        null,
      );
      assert.notEqual(
        buildThreadCacheFingerprint(thread),
        buildThreadCacheFingerprint(makeThreadKey({ updatedAt: "2026-11-24T09:10:00.000Z" })),
      );
    });

    it("supports explicit invalidation by threadId or full clear", () => {
      const thread1 = makeThreadKey({ id: "thread-1" });
      const thread2 = makeThreadKey({ id: "thread-2" });

      setCachedThreadMessages(thread1, { messages: [makeMessage({ threadId: "thread-1" })] });
      setCachedThreadMessages(thread2, { messages: [makeMessage({ threadId: "thread-2" })] });

      invalidateThreadMessagesCache("thread-1");
      assert.equal(getCachedThreadMessages(thread1), null);
      assert.notEqual(getCachedThreadMessages(thread2), null);

      invalidateThreadMessagesCache();
      assert.equal(getCachedThreadMessages(thread2), null);
    });
  });

  describe("Overview cache", () => {
    it("caches overview separately by includeOtherProjects flag", () => {
      const mainOnly = makeOverview(false);
      const withOthers = makeOverview(true);

      setCachedOverview(false, mainOnly);
      setCachedOverview(true, withOthers);

      assert.equal(getCachedOverview(false), mainOnly);
      assert.equal(getCachedOverview(true), withOthers);

      invalidateOverviewCache();
      assert.equal(getCachedOverview(false), null);
      assert.equal(getCachedOverview(true), null);
    });
  });
});
