import test from "node:test";
import assert from "node:assert/strict";
import { findSlotWebmasterThread } from "./planner-thread-lookup";
import type { GglThreadDto } from "./types";

function makeThread(overrides: Partial<GglThreadDto> = {}): GglThreadDto {
  return {
    id: "thread-1",
    gglThreadKey: "personal:100:200",
    orderId: null,
    campaignId: "camp-1",
    campaign: null,
    order: null,
    donorDomain: "viarun.ru",
    webmasterLogin: null,
    subject: "viarun.ru",
    unreadCount: 0,
    needsReply: false,
    lastMessageAt: "2026-11-19T13:24:00.000Z",
    lastMessagePreview: "Здравствуйте!",
    createdAt: "2026-11-19T13:24:00.000Z",
    updatedAt: "2026-11-19T13:24:00.000Z",
    ...overrides,
  };
}

test("matches exact personal thread key for campaign and donor site", () => {
  const personal = makeThread({ id: "t-personal", gglThreadKey: "personal:884931:366517" });
  const other = makeThread({ id: "t-other", gglThreadKey: "order:999", donorDomain: "viarun.ru" });

  const matched = findSlotWebmasterThread({
    threads: [other, personal],
    gglCampaignId: 884931,
    campaignId: "camp-1",
    donorSiteId: 366517,
    donorDomain: "viarun.ru",
  });

  assert.equal(matched?.id, "t-personal");
});

test("falls back to same-campaign domain match when personal key differs", () => {
  const sameCampaign = makeThread({
    id: "t-same-camp",
    gglThreadKey: "order:123",
    campaignId: "camp-2",
    donorDomain: "Viarun.ru",
  });
  const otherCampaign = makeThread({
    id: "t-other-camp",
    gglThreadKey: "order:456",
    campaignId: "camp-1",
    donorDomain: "viarun.ru",
  });

  const matched = findSlotWebmasterThread({
    threads: [otherCampaign, sameCampaign],
    gglCampaignId: 884931,
    campaignId: "camp-2",
    donorSiteId: 366517,
    donorDomain: "viarun.ru",
  });

  assert.equal(matched?.id, "t-same-camp");
});

test("falls back to any domain match when campaignId is not matched", () => {
  const domainMatch = makeThread({
    id: "t-domain",
    gglThreadKey: "order:123",
    campaignId: "camp-other",
    donorDomain: "viarun.ru",
  });

  const matched = findSlotWebmasterThread({
    threads: [domainMatch],
    gglCampaignId: 884931,
    campaignId: "camp-1",
    donorSiteId: 366517,
    donorDomain: "viarun.ru",
  });

  assert.equal(matched?.id, "t-domain");
});

test("returns null when no thread matches", () => {
  const other = makeThread({ gglThreadKey: "personal:884931:111111", donorDomain: "other.ru" });

  const matched = findSlotWebmasterThread({
    threads: [other],
    gglCampaignId: 884931,
    campaignId: "camp-1",
    donorSiteId: 366517,
    donorDomain: "viarun.ru",
  });

  assert.equal(matched, null);
});
