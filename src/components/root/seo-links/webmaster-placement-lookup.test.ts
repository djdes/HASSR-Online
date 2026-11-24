import test from "node:test";
import assert from "node:assert/strict";
import type { GglApplication } from "@/lib/seo/gogetlinks-applications";
import type { GglPlannedSlotDto, GglThreadDto } from "./types";
import {
  extractThreadDonorIdentity,
  findMatchingSlotForDonor,
  findWebmasterMatchingApplications,
  getApplicationThreadPriority,
  mergeApplicationsWithThreadDonors,
} from "./webmaster-placement-lookup";

function makeThread(overrides: Partial<GglThreadDto> = {}): GglThreadDto {
  return {
    id: "thread-viarum",
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
    webmasterLogin: "viarum_wm",
    subject: "viarum.ru",
    unreadCount: 1,
    needsReply: true,
    lastMessageAt: "2026-11-24T08:30:00.000Z",
    lastMessagePreview: "Добрый день! Мы можем разместить в любой рубрике...",
    createdAt: "2026-11-19T13:24:00.000Z",
    updatedAt: "2026-11-24T08:30:00.000Z",
    ...overrides,
  };
}

function makeSlot(overrides: Partial<GglPlannedSlotDto> = {}): GglPlannedSlotDto {
  return {
    id: "slot-viarum",
    planId: "plan-1",
    plan: {
      id: "plan-1",
      name: "Регламент YesBeat",
      kind: "monthly",
      campaignId: "camp-1",
    },
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
    donorMetricsJson: { tf: 39, cf: 59, trust: 9, dailyTraffic: 12000 },
    placementFormat: "article",
    anchor: "разработка и журналы хассп для общепита",
    anchorKind: "exact",
    articleId: "art-1",
    article: {
      id: "art-1",
      gglArticleId: null,
      title: "Система и журналы ХАССП на предприятии общепита",
      announcement: "Разбор цифрового учёта",
      bodyHtml: "<p>Статья со ссылкой</p>",
      anchor: "разработка и журналы хассп для общепита",
      anchorKind: "exact",
      status: "ready",
    },
    briefText: "Разместить ссылку в основном тексте",
    alternativeDonorsJson: null,
    status: "pending_approval",
    approvedByUserId: null,
    approvedByName: null,
    approvedAt: null,
    createdAt: "2026-11-17T00:00:00.000Z",
    updatedAt: "2026-11-17T00:00:00.000Z",
    ...overrides,
  };
}

function makeApp(overrides: Partial<GglApplication> = {}): GglApplication {
  return {
    id: "884931_100_article",
    campaignId: 884931,
    siteId: 100,
    domain: "yar.ru",
    siteUrl: "https://yar.ru",
    placementType: "Статья",
    priceRub: 1044,
    dailyTraffic: 22000,
    tf: 56,
    cf: 49,
    iks: 30,
    trust: 10,
    badges: [],
    ...overrides,
  };
}

test("extractThreadDonorIdentity extracts siteId from personal thread key or matching slot", () => {
  const thread = makeThread();
  const identity = extractThreadDonorIdentity(thread, []);
  assert.equal(identity.donorSiteId, 366517);
  assert.equal(identity.donorDomain, "viarum.ru");
  assert.equal(identity.gglCampaignId, 884931);

  const nonPersonalThread = makeThread({ gglThreadKey: "order:777" });
  const fromSlot = extractThreadDonorIdentity(nonPersonalThread, [makeSlot()]);
  assert.equal(fromSlot.donorSiteId, 366517);
});

test("findWebmasterMatchingApplications returns incoming applications when present and synthesizes from slot/thread when absent", () => {
  const existing = makeApp({ id: "app-viarum", siteId: 366517, domain: "viarum.ru", priceRub: 1101 });
  const matched = findWebmasterMatchingApplications({
    applications: [makeApp(), existing],
    thread: makeThread(),
    slots: [makeSlot()],
    campaignId: 884931,
  });
  assert.equal(matched.length, 1);
  assert.equal(matched[0]?.id, "app-viarum");

  const synthesized = findWebmasterMatchingApplications({
    applications: [makeApp()],
    thread: makeThread(),
    slots: [makeSlot()],
    campaignId: 884931,
  });
  assert.equal(synthesized.length, 1);
  assert.equal(synthesized[0]?.siteId, 366517);
  assert.equal(synthesized[0]?.domain, "viarum.ru");
  assert.equal(synthesized[0]?.priceRub, 1101);
  assert.equal(synthesized[0]?.dailyTraffic, 12000);
});

test("mergeApplicationsWithThreadDonors adds contacted webmaster from thread/slot when missing from incoming snapshot", () => {
  const merged = mergeApplicationsWithThreadDonors({
    applications: [makeApp()],
    threads: [makeThread()],
    slots: [makeSlot()],
    campaignId: 884931,
  });

  assert.equal(merged.length, 2);
  assert.equal(merged[0]?.domain, "viarum.ru");
  assert.equal(merged[0]?.siteId, 366517);
});

test("getApplicationThreadPriority ranks unread/needsReply threads at 0, active threads at 1, and others at 2", () => {
  const threadUnread = makeThread({ unreadCount: 1, needsReply: true });
  const threadRead = makeThread({
    id: "t-read",
    gglThreadKey: "personal:884931:555",
    donorDomain: "posudaguide.ru",
    unreadCount: 0,
    needsReply: false,
  });

  const p0 = getApplicationThreadPriority({ siteId: 366517, domain: "viarum.ru" }, [threadUnread, threadRead]);
  const p1 = getApplicationThreadPriority({ siteId: 555, domain: "posudaguide.ru" }, [threadUnread, threadRead]);
  const p2 = getApplicationThreadPriority({ siteId: 100, domain: "yar.ru" }, [threadUnread, threadRead]);

  assert.equal(p0.priorityRank, 0);
  assert.equal(p1.priorityRank, 1);
  assert.equal(p2.priorityRank, 2);
});

test("findMatchingSlotForDonor prefers pending_approval slot", () => {
  const slot = findMatchingSlotForDonor({
    slots: [makeSlot({ id: "s-skip", status: "skipped" }), makeSlot({ id: "s-pending", status: "pending_approval" })],
    donorDomain: "viarum.ru",
  });
  assert.equal(slot?.id, "s-pending");
});
