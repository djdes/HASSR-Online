import type { GglApplication } from "@/lib/seo/gogetlinks-applications";
import { parseGglPersonalThreadKey } from "@/lib/seo/gogetlinks-personal-chat";
import {
  type GglPlannedSlotDto,
  type GglThreadDto,
  parseSlotDonorMetrics,
} from "./types";

export interface ThreadDonorIdentity {
  donorDomain: string | null;
  donorSiteId: number | null;
  gglCampaignId: number | null;
}

function normalizeDomain(domain: string | null | undefined): string | null {
  const trimmed = domain?.trim().toLowerCase().replace(/^www\./, "") ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function formatPlacementTypeLabel(format: string | null | undefined): string {
  switch (format) {
    case "context":
      return "Контекстная ссылка";
    case "note":
      return "Короткая заметка";
    case "article":
    default:
      return "Статья";
  }
}

export function extractThreadDonorIdentity(
  thread: GglThreadDto,
  slots: readonly GglPlannedSlotDto[] = [],
): ThreadDonorIdentity {
  const personal = parseGglPersonalThreadKey(thread.gglThreadKey);
  const rawDomain = thread.donorDomain ?? thread.order?.donorDomain ?? null;
  const normalizedDomain = normalizeDomain(rawDomain);

  let donorSiteId = personal?.siteId ?? null;
  const gglCampaignId = personal?.campaignId ?? thread.campaign?.gglCampaignId ?? null;

  if (!donorSiteId && normalizedDomain) {
    const matchingSlot = slots.find(
      (s) =>
        s.donorSiteId !== null &&
        normalizeDomain(s.donorDomain) === normalizedDomain,
    );
    if (matchingSlot?.donorSiteId) {
      donorSiteId = matchingSlot.donorSiteId;
    }
  }

  return {
    donorDomain: rawDomain?.trim() || null,
    donorSiteId,
    gglCampaignId,
  };
}

export function findMatchingSlotForDonor(params: {
  slots: readonly GglPlannedSlotDto[];
  donorSiteId?: number | null;
  donorDomain?: string | null;
}): GglPlannedSlotDto | null {
  const { slots, donorSiteId, donorDomain } = params;
  if (slots.length === 0) return null;

  const normDomain = normalizeDomain(donorDomain);
  const candidates = slots.filter((s) => {
    if (donorSiteId && s.donorSiteId === donorSiteId) return true;
    if (normDomain && normalizeDomain(s.donorDomain) === normDomain) return true;
    return false;
  });

  if (candidates.length === 0) return null;

  return (
    candidates.find((s) => s.status === "pending_approval") ??
    candidates.find((s) => s.status !== "skipped") ??
    candidates[0] ??
    null
  );
}

export function synthesizeApplicationFromSlotOrThread(params: {
  thread?: GglThreadDto | null;
  slot?: GglPlannedSlotDto | null;
  campaignId: number;
  donorSiteId?: number | null;
  donorDomain?: string | null;
}): GglApplication | null {
  const { thread, slot, campaignId } = params;
  const siteId =
    params.donorSiteId ??
    slot?.donorSiteId ??
    (thread ? parseGglPersonalThreadKey(thread.gglThreadKey)?.siteId ?? null : null);
  const domain =
    (params.donorDomain ?? slot?.donorDomain ?? thread?.donorDomain ?? thread?.order?.donorDomain)?.trim() ||
    null;

  if (!siteId || !domain) return null;

  const metrics = slot ? parseSlotDonorMetrics(slot.donorMetricsJson) : null;
  const priceRub =
    slot?.estimatedPriceRub ??
    slot?.maxPriceRub ??
    thread?.order?.priceRub ??
    null;
  const placementType = formatPlacementTypeLabel(slot?.placementFormat);

  const badges: string[] = [];
  if (slot) {
    badges.push("Подобрано планировщиком из каталога GGL");
  } else if (thread) {
    badges.push("Площадка из активного диалога с вебмастером");
  }

  return {
    id: `synth_${campaignId}_${siteId}`,
    campaignId,
    siteId,
    domain: domain.replace(/^www\./i, ""),
    siteUrl: `https://${domain.replace(/^https?:\/\//i, "")}`,
    placementType,
    priceRub,
    dailyTraffic: metrics?.dailyTraffic ?? null,
    tf: metrics?.tf ?? null,
    cf: metrics?.cf ?? null,
    iks: null,
    trust: metrics?.trust ?? null,
    badges,
  };
}

export function findWebmasterMatchingApplications(params: {
  applications: readonly GglApplication[];
  thread?: GglThreadDto | null;
  donorDomain?: string | null;
  donorSiteId?: number | null;
  slots?: readonly GglPlannedSlotDto[];
  campaignId: number;
}): GglApplication[] {
  const { applications, thread, slots = [], campaignId } = params;
  const identity = thread
    ? extractThreadDonorIdentity(thread, slots)
    : {
        donorDomain: params.donorDomain ?? null,
        donorSiteId: params.donorSiteId ?? null,
        gglCampaignId: campaignId,
      };

  const targetSiteId = params.donorSiteId ?? identity.donorSiteId;
  const targetDomain = normalizeDomain(params.donorDomain ?? identity.donorDomain);

  const matched = applications.filter((a) => {
    if (targetSiteId && a.siteId === targetSiteId) return true;
    if (targetDomain && normalizeDomain(a.domain) === targetDomain) return true;
    return false;
  });

  if (matched.length > 0) return matched;

  const matchingSlot = findMatchingSlotForDonor({
    slots,
    donorSiteId: targetSiteId,
    donorDomain: targetDomain,
  });

  const synthesized = synthesizeApplicationFromSlotOrThread({
    thread,
    slot: matchingSlot,
    campaignId,
    donorSiteId: targetSiteId,
    donorDomain: params.donorDomain ?? identity.donorDomain,
  });

  return synthesized ? [synthesized] : [];
}

export function mergeApplicationsWithThreadDonors(params: {
  applications: readonly GglApplication[];
  threads: readonly GglThreadDto[];
  slots: readonly GglPlannedSlotDto[];
  campaignId: number;
}): GglApplication[] {
  const { applications, threads, slots, campaignId } = params;
  const existingSiteIds = new Set(applications.map((a) => a.siteId));
  const existingDomains = new Set(
    applications
      .map((a) => normalizeDomain(a.domain))
      .filter((d): d is string => Boolean(d)),
  );

  const additions: GglApplication[] = [];

  for (const thread of threads) {
    if (thread.campaign?.isWesetup === false) continue;
    const identity = extractThreadDonorIdentity(thread, slots);
    const normDomain = normalizeDomain(identity.donorDomain);
    if (
      (identity.donorSiteId && existingSiteIds.has(identity.donorSiteId)) ||
      (normDomain && existingDomains.has(normDomain))
    ) {
      continue;
    }

    const matchingSlot = findMatchingSlotForDonor({
      slots,
      donorSiteId: identity.donorSiteId,
      donorDomain: identity.donorDomain,
    });

    const synthesized = synthesizeApplicationFromSlotOrThread({
      thread,
      slot: matchingSlot,
      campaignId,
      donorSiteId: identity.donorSiteId,
      donorDomain: identity.donorDomain,
    });

    if (synthesized) {
      existingSiteIds.add(synthesized.siteId);
      const synthNormDomain = normalizeDomain(synthesized.domain);
      if (synthNormDomain) existingDomains.add(synthNormDomain);
      additions.push(synthesized);
    }
  }

  return additions.length > 0 ? [...additions, ...applications] : [...applications];
}

export function getApplicationThreadPriority(
  app: Pick<GglApplication, "siteId" | "domain">,
  threads: readonly GglThreadDto[],
): { thread: GglThreadDto | null; priorityRank: number } {
  if (threads.length === 0) return { thread: null, priorityRank: 2 };

  const normDomain = normalizeDomain(app.domain);
  const matched =
    threads.find((t) => {
      const personal = parseGglPersonalThreadKey(t.gglThreadKey);
      return personal?.siteId === app.siteId;
    }) ??
    threads.find(
      (t) =>
        normDomain !== null &&
        normalizeDomain(t.donorDomain ?? t.order?.donorDomain) === normDomain,
    ) ??
    null;

  if (!matched) return { thread: null, priorityRank: 2 };
  if (matched.unreadCount > 0 || matched.needsReply) {
    return { thread: matched, priorityRank: 0 };
  }
  return { thread: matched, priorityRank: 1 };
}
