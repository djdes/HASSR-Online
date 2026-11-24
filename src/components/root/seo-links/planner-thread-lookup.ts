import { gglPersonalThreadKey } from "@/lib/seo/gogetlinks-personal-chat";
import type { GglThreadDto } from "./types";

export interface FindSlotWebmasterThreadParams {
  threads: readonly GglThreadDto[];
  gglCampaignId?: number | null;
  campaignId?: string | null;
  donorSiteId?: number | null;
  donorDomain?: string | null;
}

/**
 * Finds an existing GoGetLinks thread for a planned slot's donor so the planner
 * can show that the webmaster has already been contacted instead of offering
 * the first-message composer again.
 */
export function findSlotWebmasterThread({
  threads,
  gglCampaignId,
  campaignId,
  donorSiteId,
  donorDomain,
}: FindSlotWebmasterThreadParams): GglThreadDto | null {
  if (threads.length === 0) return null;

  if (gglCampaignId && donorSiteId) {
    const personalKey = gglPersonalThreadKey(gglCampaignId, donorSiteId);
    const exactMatch = threads.find((t) => t.gglThreadKey === personalKey);
    if (exactMatch) return exactMatch;
  }

  const normalizedDomain = donorDomain?.trim().toLowerCase();
  if (!normalizedDomain) return null;

  if (campaignId) {
    const sameCampaignMatch = threads.find(
      (t) =>
        t.campaignId === campaignId &&
        t.donorDomain?.trim().toLowerCase() === normalizedDomain,
    );
    if (sameCampaignMatch) return sameCampaignMatch;
  }

  return (
    threads.find(
      (t) => t.donorDomain?.trim().toLowerCase() === normalizedDomain,
    ) ?? null
  );
}
