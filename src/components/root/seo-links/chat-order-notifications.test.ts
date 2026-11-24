import test from "node:test";
import assert from "node:assert/strict";
import {
  buildChatSystemNotifications,
  buildChatTimeline,
  findThreadMatchingOrders,
} from "./chat-order-notifications";
import type {
  GglMessageDto,
  GglOrderDto,
  GglPlannedSlotDto,
  GglThreadDto,
} from "./types";

function makeThread(overrides: Partial<GglThreadDto> = {}): GglThreadDto {
  return {
    id: "thread-1",
    gglThreadKey: "personal:884931:366517",
    orderId: null,
    campaignId: "camp-1",
    campaign: {
      id: "camp-1",
      gglCampaignId: 884931,
      name: "WeSetup",
      domain: "wesetup.ru",
      isWesetup: true,
    },
    order: null,
    donorDomain: "viarum.ru",
    webmasterLogin: null,
    subject: "viarum.ru",
    unreadCount: 0,
    needsReply: false,
    lastMessageAt: "2026-11-19T13:24:00.000Z",
    lastMessagePreview: "Здравствуйте!",
    createdAt: "2026-11-19T13:24:00.000Z",
    updatedAt: "2026-11-19T13:24:00.000Z",
    ...overrides,
  };
}

function makeOrder(overrides: Partial<GglOrderDto> = {}): GglOrderDto {
  return {
    id: "order-1",
    gglReviewId: 9001,
    campaignId: "camp-1",
    campaign: null,
    donorSiteId: 366517,
    donorDomain: "viarum.ru",
    donorDailyTraffic: 12000,
    donorTfCf: "39 / 59",
    donorTrust: 9,
    placementFormat: "article",
    priceRub: 1101,
    targetUrl: "https://wesetup.ru/zhurnal-haccp",
    anchor: "разработка и журналы хассп для общепита",
    publishedUrl: null,
    articleId: "art-1",
    paidAt: null,
    cancelledAt: null,
    indexedStatus: null,
    status: "pending_webmaster",
    origin: "scheduled_wesetup",
    initiatedByUserId: "u-1",
    initiatedByName: "Олег",
    approvedByUserId: "u-1",
    approvedByName: "Олег",
    approvedAt: "2026-11-24T11:05:00.000Z",
    plannedSlotId: "slot-1",
    createdAt: "2026-11-24T11:05:00.000Z",
    updatedAt: "2026-11-24T11:05:00.000Z",
    ...overrides,
  };
}

function makeSlot(overrides: Partial<GglPlannedSlotDto> = {}): GglPlannedSlotDto {
  return {
    id: "slot-1",
    planId: "plan-1",
    plan: null,
    scheduledDate: "2026-11-17",
    maxPriceRub: 2500,
    estimatedPriceRub: 1101,
    targetUrl: "/zhurnal-haccp",
    targetKeyword: "журналы хассп для общепита",
    sourceSnapshotId: null,
    topvisorPosSnapshot: null,
    selectionReason: null,
    donorSiteId: 366517,
    donorDomain: "viarum.ru",
    donorMetricsJson: null,
    placementFormat: "article",
    anchor: "разработка и журналы хассп для общепита",
    anchorKind: "exact",
    articleId: "art-1",
    article: null,
    briefText: null,
    alternativeDonorsJson: null,
    status: "pending_approval",
    approvedByUserId: null,
    approvedByName: null,
    approvedAt: null,
    createdAt: "2026-11-17T08:00:00.000Z",
    updatedAt: "2026-11-17T08:00:00.000Z",
    ...overrides,
  };
}

test("findThreadMatchingOrders matches orders for personal thread by siteId or domain", () => {
  const thread = makeThread();
  const order = makeOrder();
  const unrelated = makeOrder({
    id: "order-2",
    donorSiteId: 999,
    donorDomain: "other.ru",
  });

  const matched = findThreadMatchingOrders({
    thread,
    orders: [unrelated, order],
  });
  assert.equal(matched.length, 1);
  assert.equal(matched[0]?.id, "order-1");
});

test("buildChatSystemNotifications creates system notification with sent status for order", () => {
  const thread = makeThread();
  const order = makeOrder({ status: "pending_webmaster" });
  const slot = makeSlot({ id: "slot-1", status: "ordered" });

  const notifications = buildChatSystemNotifications({
    thread,
    orders: [order],
    slots: [slot],
  });

  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.kind, "order");
  assert.equal(
    notifications[0]?.title,
    "Заявка отправлена вебмастеру в GoGetLinks",
  );
  assert.equal(notifications[0]?.statusBadge.label, "Ждёт вебмастера");
  assert.equal(notifications[0]?.priceRub, 1101);
});

test("buildChatTimeline interleaves messages and system notifications chronologically", () => {
  const msg1: GglMessageDto = {
    id: "m-1",
    threadId: "thread-1",
    gglMessageId: "1",
    direction: "outbound",
    authorLabel: "Аккаунт GoGetLinks",
    sentByUserId: null,
    sentByName: null,
    body: "Здравствуйте!",
    deliveryStatus: "synced",
    idempotencyKey: null,
    sentAt: "2026-11-19T13:24:00.000Z",
    createdAt: "2026-11-19T13:24:00.000Z",
  };
  const notifications = buildChatSystemNotifications({
    thread: makeThread(),
    orders: [makeOrder({ approvedAt: "2026-11-24T11:05:00.000Z" })],
  });

  const timeline = buildChatTimeline({ messages: [msg1], notifications });
  assert.equal(timeline.length, 2);
  assert.equal(timeline[0]?.type, "message");
  assert.equal(timeline[1]?.type, "system");
});
